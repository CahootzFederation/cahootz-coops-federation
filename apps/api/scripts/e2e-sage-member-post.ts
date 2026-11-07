/**
 * Deterministic fixture for apps/mobile/e2e/sage-member-post.spec.ts. It stands in for the model's
 * propose_post call: it saves Sage's anonymous post proposal for a member and puts Sage's exact ask in
 * their private conversation. Everything after that (the member's "yes", publishing, a reply, the relay)
 * runs through the real app.
 *
 *   tsx --import ./dotenv.config.js scripts/e2e-sage-member-post.ts seed <memberEmail> <runId>
 *   tsx --import ./dotenv.config.js scripts/e2e-sage-member-post.ts post <memberEmail> <runId>
 *     The id of the post Sage published, once the member said yes (null until then).
 *   tsx --import ./dotenv.config.js scripts/e2e-sage-member-post.ts cleanup <memberEmail> <runId> <seededAt>
 *
 * Prints one JSON line prefixed with "E2E_RESULT ". Refuses production and non-local databases.
 */
import { db } from "../../../packages/db/index.js";
import { ensureSageBotUser } from "../../../packages/trpc/src/lib/bot.js";
import { COMMONS_COOP_ID } from "../../../packages/trpc/src/lib/commons.js";
import { openDirectCircle, sendDirectCircleMessage } from "../../../packages/trpc/src/services/direct-circles.js";
import { MEMBER_POST_SOURCE, proposeMemberPost } from "../../../packages/trpc/src/services/sage-member-actions.js";

function assertSafeEnvironment(email: string) {
  if (process.env.NODE_ENV === "production" || !email.endsWith("@test.cahootz.local")) throw new Error("Member post fixture only accepts local test accounts");
  const host = (() => { try { return new URL(process.env.DATABASE_URL ?? "").hostname; } catch { return ""; } })();
  if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(host) && process.env.E2E_ALLOW_NONLOCAL_DB !== "1") {
    throw new Error(`Refusing non-local database host "${host}"`);
  }
}

async function conversation(email: string) {
  const member = await db.user.findUnique({ where: { email }, select: { id: true, name: true, email: true } });
  if (!member) throw new Error(`Test user not found: ${email}`);
  const sage = await ensureSageBotUser(db, COMMONS_COOP_ID);
  const { group } = await openDirectCircle(db, { coopId: COMMONS_COOP_ID, userId: member.id, otherUserId: sage.id });
  return { member, sage, group };
}

async function seed(email: string, runId: string) {
  const { member, sage, group } = await conversation(email);
  const seededAt = new Date();
  const proposal = await proposeMemberPost({
    memberId: member.id, conversationGroupId: group.id, coopId: COMMONS_COOP_ID, tag: "Ask",
    title: `E2E ${runId} weekly shifts wanted`,
    body: `E2E ${runId}: A member with hospitality experience is looking for regular weekly fast-food work.`,
  });
  if (!proposal.ok) throw new Error(`Proposal refused: ${proposal.reason}`);
  await sendDirectCircleMessage(db, { group, sender: sage, content: `I can ask the Commons for you.\n\n${proposal.ask}` });
  return { seededAt: seededAt.toISOString(), actionId: proposal.actionId };
}

async function cleanup(email: string, runId: string, seededAtIso: string) {
  const { member, group } = await conversation(email);
  const seededAt = new Date(seededAtIso);
  const posts = await db.commonsPost.findMany({ where: { classification: "sage_member_post", title: { contains: runId } }, select: { id: true } });
  const postIds = posts.map((post) => post.id);
  const actions = await db.commonsAction.findMany({
    where: { createdAt: { gte: seededAt }, OR: [{ sourceType: MEMBER_POST_SOURCE, sourceAuthorId: member.id }, { type: "CONNECT_MEMBERS", sourceAuthorId: member.id }] },
    select: { id: true },
  });
  const result = {
    tasks: (await db.sageTask.deleteMany({ where: { OR: [{ postId: { in: postIds } }, { sourceActionId: { in: actions.map((action) => action.id) } }] } })).count,
    comments: (await db.commonsComment.deleteMany({ where: { postId: { in: postIds } } })).count,
    posts: (await db.commonsPost.deleteMany({ where: { id: { in: postIds } } })).count,
    actions: (await db.commonsAction.deleteMany({ where: { id: { in: actions.map((action) => action.id) } } })).count,
    messages: (await db.groupComment.deleteMany({ where: { groupId: group.id, createdAt: { gte: seededAt } } })).count,
    trails: (await db.sageDecisionTrail.deleteMany({ where: { circleId: group.id, createdAt: { gte: seededAt } } })).count,
    notifications: (await db.notification.deleteMany({ where: { createdAt: { gte: seededAt }, data: { path: ["groupId"], equals: group.id } } })).count,
  };
  return result;
}

async function publishedPost(runId: string) {
  const post = await db.commonsPost.findFirst({ where: { classification: "sage_member_post", title: { contains: runId } }, select: { id: true, coopId: true } });
  return { postId: post?.id ?? null, coopId: post?.coopId ?? null };
}

async function main() {
  const [command, email, runId, seededAt] = process.argv.slice(2);
  if (!email || !runId) throw new Error("Usage: e2e-sage-member-post.ts seed|post|cleanup <memberEmail> <runId> [seededAt]");
  assertSafeEnvironment(email);
  const result = command === "seed" ? await seed(email, runId)
    : command === "post" ? await publishedPost(runId)
    : command === "cleanup" && seededAt ? await cleanup(email, runId, seededAt) : null;
  if (!result) throw new Error("Usage: e2e-sage-member-post.ts seed|post|cleanup <memberEmail> <runId> [seededAt]");
  console.log(`E2E_RESULT ${JSON.stringify(result)}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
