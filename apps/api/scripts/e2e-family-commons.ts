/**
 * E2E cleanup for the family commons and invitation journeys
 * (apps/mobile/e2e/family-commons.spec.ts). Not part of the product; only
 * the Playwright spec calls it.
 *
 *   tsx --import ./dotenv.config.js scripts/e2e-family-commons.ts cleanup <familyName>
 *     Deletes the named "E2E Family ..." commons (created by a seeded test
 *     account) with its memberships, invitations, requests, posts and alerts.
 *   tsx --import ./dotenv.config.js scripts/e2e-family-commons.ts cleanup-referral <coopId> <inviteeEmail>
 *     Removes the apply-referral fixture state from a normal commons: the
 *     test invitations, the invitee's application and pending membership.
 *
 * Prints one JSON line prefixed with "E2E_RESULT ". Refuses anything but
 * seeded test accounts and E2E-named commons, and refuses production.
 */
import { db } from "../../../packages/db/index.js";

const TEST_EMAIL_SUFFIX = "@test.cahootz.local";

function assertSafeEnvironment() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run the family commons fixture in production");
  }
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? "").hostname;
    } catch {
      return "";
    }
  })();
  if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(host) && process.env.E2E_ALLOW_NONLOCAL_DB !== "1") {
    throw new Error(`Refusing to run the family commons fixture against non-local database host "${host}"`);
  }
}

async function testUserIds() {
  const users = await db.user.findMany({
    where: { email: { endsWith: TEST_EMAIL_SUFFIX } },
    select: { id: true },
  });
  return users.map((user) => user.id);
}

async function cleanupFamily(familyName: string) {
  if (!familyName.startsWith("E2E Family")) throw new Error("Only E2E Family commons can be cleaned up");
  const creators = (await testUserIds()).map((id) => `user:${id}`);
  const configs = await db.coopConfig.findMany({
    where: { name: familyName, createdBy: { in: creators }, joinPolicy: "INVITE_ONLY" },
    select: { coopId: true },
  });
  const coopIds = [...new Set(configs.map((config) => config.coopId))];
  if (coopIds.length === 0) return { deleted: 0 };

  await db.$transaction([
    db.application.deleteMany({ where: { coopId: { in: coopIds } } }),
    db.commonsInvitation.deleteMany({ where: { coopId: { in: coopIds } } }),
    db.commonsComment.deleteMany({ where: { post: { coopId: { in: coopIds } } } }),
    db.commonsPost.deleteMany({ where: { coopId: { in: coopIds } } }),
    db.group.deleteMany({ where: { coopId: { in: coopIds } } }),
    db.notification.deleteMany({ where: { coopId: { in: coopIds } } }),
    db.notification.deleteMany({
      where: {
        type: { startsWith: "COMMONS_" },
        OR: coopIds.map((coopId) => ({ data: { path: ["coopId"], equals: coopId } })),
      },
    }),
    db.userCoopMembership.deleteMany({ where: { coopId: { in: coopIds } } }),
    db.coopConfig.deleteMany({ where: { coopId: { in: coopIds } } }),
  ]);
  return { deleted: coopIds.length, coopIds };
}

async function cleanupReferral(coopId: string, inviteeEmail: string) {
  if (!inviteeEmail.endsWith(TEST_EMAIL_SUFFIX)) throw new Error("Only seeded test accounts can be cleaned up");
  if (!coopId.startsWith("e2e-")) throw new Error("Only E2E commons can be cleaned up");
  const invitee = await db.user.findUnique({ where: { email: inviteeEmail }, select: { id: true } });
  if (!invitee) throw new Error(`No user ${inviteeEmail}`);
  const inviters = await testUserIds();

  const invitations = await db.commonsInvitation.findMany({
    where: { coopId, recipientEmailNormalized: inviteeEmail, inviterId: { in: inviters } },
    select: { id: true },
  });
  const invitationIds = invitations.map((invitation) => invitation.id);
  await db.$transaction([
    db.application.deleteMany({ where: { coopId, userId: invitee.id } }),
    db.userCoopMembership.deleteMany({ where: { coopId, userId: invitee.id, status: { not: "ACTIVE" } } }),
    db.notification.deleteMany({
      where: {
        userId: invitee.id,
        type: "COMMONS_INVITATION",
        OR: invitationIds.map((id) => ({ data: { path: ["invitationId"], equals: id } })),
      },
    }),
    db.commonsInvitation.deleteMany({ where: { id: { in: invitationIds } } }),
  ]);
  return { invitations: invitationIds.length };
}

/**
 * Deletes the throwaway newcomer accounts a run signs up with (so onboarding
 * journeys never touch the shared releaseclick fixtures' state). Their
 * memberships, lounge seats, sessions and alerts go with them.
 */
async function cleanupNewcomers(emails: string[]) {
  for (const email of emails) {
    if (!/^e2e-[a-z0-9-]+@test\.cahootz\.local$/.test(email)) {
      throw new Error(`Only throwaway e2e-…@test.cahootz.local accounts can be deleted, not ${email}`);
    }
  }
  const users = await db.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
  const userIds = users.map((user) => user.id);
  if (userIds.length === 0) return { deleted: 0 };
  await db.$transaction([
    db.session.deleteMany({ where: { userId: { in: userIds } } }),
    db.loginCode.deleteMany({ where: { email: { in: emails } } }),
    db.user.deleteMany({ where: { id: { in: userIds } } }),
  ]);
  return { deleted: userIds.length };
}

async function main() {
  assertSafeEnvironment();
  const [command, first, second, ...rest] = process.argv.slice(2);
  const result =
    command === "cleanup" && first
      ? await cleanupFamily(first)
      : command === "cleanup-referral" && first && second
        ? await cleanupReferral(first, second)
        : command === "cleanup-newcomers" && first
          ? await cleanupNewcomers([first, second, ...rest].filter(Boolean) as string[])
          : (() => {
              throw new Error(
                "Usage: e2e-family-commons.ts cleanup <familyName> | cleanup-referral <coopId> <email> | cleanup-newcomers <email...>",
              );
            })();
  console.log(`E2E_RESULT ${JSON.stringify(result)}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
