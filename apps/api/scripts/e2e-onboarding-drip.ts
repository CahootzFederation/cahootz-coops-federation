/**
 * E2E fixture for the new-member drip journey (apps/mobile/e2e/onboarding-drip.spec.ts).
 * Not part of the product; only the Playwright spec calls it.
 *
 *   tsx --import ./dotenv.config.js scripts/e2e-onboarding-drip.ts prepare <email>
 *     Backdates <email>'s Cahootz membership so the day 1 step is due, marks
 *     them quiet since signup, clears any earlier drip state, then runs the
 *     real drip for that one member.
 *   tsx --import ./dotenv.config.js scripts/e2e-onboarding-drip.ts cleanup <email> <joinedAtIso|null>
 *     Restores the original joinedAt and removes drip rows and drip alerts.
 *
 * Prints one JSON line prefixed with "E2E_RESULT ". Refuses to touch anything
 * but seeded test accounts, and refuses production.
 */
import { db } from "../../../packages/db/index.js";
import { runOnboardingDrip } from "../../../packages/trpc/src/services/onboarding-drip.js";
import { ONBOARDING_DRIP_NOTIFICATION_TYPE } from "../../../packages/trpc/src/services/onboarding-drip-config.js";

const COOP_ID = "cahootz";
const HOUR = 60 * 60 * 1000;

function assertSafeTarget(email: string) {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to run the drip fixture in production");
  if (!email.endsWith("@test.cahootz.local")) throw new Error("The drip fixture only touches seeded test accounts");
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? "").hostname;
    } catch {
      return "";
    }
  })();
  if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(host) && process.env.E2E_ALLOW_NONLOCAL_DB !== "1") {
    throw new Error(`Refusing to run the drip fixture against non-local database host "${host}"`);
  }
}

async function membershipFor(email: string) {
  const user = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) throw new Error(`No user ${email}; run seed:test-users first`);
  const membership = await db.userCoopMembership.findUnique({
    where: { userId_coopId: { userId: user.id, coopId: COOP_ID } },
    select: { id: true, joinedAt: true },
  });
  if (!membership) throw new Error(`${email} has no ${COOP_ID} membership`);
  return { userId: user.id, membership };
}

async function clearDripState(userId: string) {
  await db.onboardingDripSend.deleteMany({ where: { userId, coopId: COOP_ID } });
  await db.notification.deleteMany({ where: { userId, type: ONBOARDING_DRIP_NOTIFICATION_TYPE } });
}

async function prepare(email: string) {
  const { userId, membership } = await membershipFor(email);
  await clearDripState(userId);
  const now = new Date();
  const joinedAt = new Date(now.getTime() - 25 * HOUR);
  await db.userCoopMembership.update({ where: { id: membership.id }, data: { joinedAt } });
  // Last seen during the signup session, i.e. before the day 1 quiet threshold.
  await db.user.update({ where: { id: userId }, data: { lastActiveAt: new Date(joinedAt.getTime() + 30 * 60 * 1000) } });
  const summary = await runOnboardingDrip(db, { now, userIds: [userId], coopId: COOP_ID });
  const send = await db.onboardingDripSend.findUnique({
    where: { userId_coopId_step: { userId, coopId: COOP_ID, step: 1 } },
  });
  const notification = send?.notificationId
    ? await db.notification.findUnique({ where: { id: send.notificationId } })
    : null;
  return {
    originalJoinedAt: membership.joinedAt?.toISOString() ?? null,
    summary,
    send,
    notification: notification && { id: notification.id, title: notification.title, body: notification.body, data: notification.data },
  };
}

async function cleanup(email: string, originalJoinedAt: string) {
  const { userId, membership } = await membershipFor(email);
  await clearDripState(userId);
  await db.userCoopMembership.update({
    where: { id: membership.id },
    data: { joinedAt: originalJoinedAt === "null" ? null : new Date(originalJoinedAt) },
  });
  return { restored: true };
}

async function main() {
  const [command, email, extra] = process.argv.slice(2);
  if (!email) throw new Error("Usage: e2e-onboarding-drip.ts prepare|cleanup <email> [joinedAtIso]");
  assertSafeTarget(email);
  const result =
    command === "prepare"
      ? await prepare(email)
      : command === "cleanup" && extra
        ? await cleanup(email, extra)
        : (() => {
            throw new Error(`Unknown command ${command}`);
          })();
  console.log(`E2E_RESULT ${JSON.stringify(result)}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
