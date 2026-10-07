/**
 * E2E fixtures for Sage turning a member's own offer into a listing or a shop
 * (apps/mobile/e2e/sage-self-offer.spec.ts). Not part of the product; only the Playwright spec calls it.
 *
 *   tsx --import ./dotenv.config.js scripts/e2e-self-offer.ts setup <runId> <memberEmail> <stewardEmail>
 *     Creates a throwaway "E2E Family <runId>" with the steward as its creator and the member as a member.
 *   tsx --import ./dotenv.config.js scripts/e2e-self-offer.ts offer <coopId> <memberEmail> <title>
 *     Posts a self-offer as the member and runs Sage's real post-model path on it with a fixed model
 *     output (no live model call), so Sage invites the member to list it or open a shop.
 *   tsx --import ./dotenv.config.js scripts/e2e-self-offer.ts cleanup <coopId>
 *
 * Prints one JSON line prefixed with "E2E_RESULT ". Refuses anything but seeded test accounts and
 * E2E families, and refuses production.
 */
import { db } from "../../../packages/db/index.js";
import { replayCommonsPost } from "../../../packages/trpc/src/services/commons-action-agent.js";
import { createMembership } from "../../../packages/trpc/src/services/commons-membership.js";
import { createFamilyCommons } from "../../../packages/trpc/src/services/commons-invitations.js";

const TEST_EMAIL_SUFFIX = "@test.cahootz.local";

function assertSafeEnvironment() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to run the self-offer fixture in production");
  const host = (() => {
    try { return new URL(process.env.DATABASE_URL ?? "").hostname; } catch { return ""; }
  })();
  if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(host) && process.env.E2E_ALLOW_NONLOCAL_DB !== "1") {
    throw new Error(`Refusing to run the self-offer fixture against non-local database host "${host}"`);
  }
}

async function testUser(email: string) {
  if (!email.endsWith(TEST_EMAIL_SUFFIX)) throw new Error("Only seeded test accounts can be used");
  const user = await db.user.findUnique({ where: { email }, select: { id: true, email: true, name: true, handle: true, phone: true } });
  if (!user) throw new Error(`No user ${email}`);
  return { ...user, email: user.email ?? email };
}

async function e2eFamily(coopId: string) {
  const config = await db.coopConfig.findFirst({ where: { coopId, isActive: true }, select: { name: true } });
  if (!coopId.startsWith("family-") || !config?.name?.startsWith("E2E Family")) throw new Error("Only E2E families can be used");
}

async function setup(runId: string, memberEmail: string, stewardEmail: string) {
  const [member, steward] = [await testUser(memberEmail), await testUser(stewardEmail)];
  const name = `E2E Family ${runId}`;
  const { coopId } = await createFamilyCommons(db, { user: steward, name });
  await db.$transaction((tx) => createMembership(tx, { coopId, userId: member.id, approvedBy: steward.id, method: "INVITATION" }));
  return { coopId, name };
}

async function offer(coopId: string, memberEmail: string, title: string) {
  await e2eFamily(coopId);
  const member = await testUser(memberEmail);
  // Sage invites a member at most once a month per commons; age this run's earlier invitations out of that window.
  await db.commonsResource.updateMany({ where: { coopId, candidateUserId: member.id }, data: { invitedAt: new Date(Date.now() - 31 * 86400000) } });
  const post = await db.commonsPost.create({ data: {
    coopId, circleId: `general:${coopId}`, authorId: member.id, tag: "Offer",
    title: "Hey family", content: "I'm a master arborist 17 years experiecne let me and my team work for you!",
  }, select: { id: true } });
  const { actionIds } = await replayCommonsPost(post.id, [{
    type: "VERIFY_RESOURCE", summary: "Offers tree care and removal with a crew.",
    resourceKind: "SERVICE", resourceTitle: title, selfOffer: true,
  }]);
  const resource = await db.commonsResource.findFirst({ where: { actionId: { in: actionIds } }, select: { id: true, status: true } });
  return { postId: post.id, resourceId: resource?.id ?? null, status: resource?.status ?? null };
}

async function cleanup(coopId: string) {
  await e2eFamily(coopId);
  const actions = await db.commonsAction.findMany({ where: { coopId }, select: { id: true } });
  await db.$transaction([
    db.knowledgeDocument.deleteMany({ where: { coopId } }),
    db.commonsResource.deleteMany({ where: { coopId } }),
    db.sageDecisionTrail.deleteMany({ where: { coopId } }),
    db.commonsActionAudit.deleteMany({ where: { actionId: { in: actions.map((action) => action.id) } } }),
    db.commonsAction.deleteMany({ where: { coopId } }),
    db.commonsContentScan.deleteMany({ where: { coopId } }),
    db.commonsAgentSetting.deleteMany({ where: { coopId } }),
    // The shop the journey applies for; its application is deleted with it.
    db.store.deleteMany({ where: { coopId } }),
    db.commonsComment.deleteMany({ where: { post: { coopId } } }),
    db.commonsPost.deleteMany({ where: { coopId } }),
    db.group.deleteMany({ where: { coopId } }),
    db.notification.deleteMany({ where: { coopId } }),
    db.userCoopMembership.deleteMany({ where: { coopId } }),
    db.coopConfig.deleteMany({ where: { coopId } }),
  ]);
  return { deleted: coopId };
}

async function main() {
  assertSafeEnvironment();
  const [command, ...args] = process.argv.slice(2);
  const result = command === "setup" && args.length === 3 ? await setup(args[0]!, args[1]!, args[2]!)
    : command === "offer" && args.length === 3 ? await offer(args[0]!, args[1]!, args[2]!)
      : command === "cleanup" && args[0] ? await cleanup(args[0])
        : (() => { throw new Error("Usage: e2e-self-offer.ts setup <runId> <member> <steward> | offer <coopId> <member> <title> | cleanup <coopId>"); })();
  console.log(`E2E_RESULT ${JSON.stringify(result)}`);
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => db.$disconnect());
