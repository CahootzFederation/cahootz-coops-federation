/** Deterministic local fixture for apps/mobile/e2e/sage-weekly-outreach.spec.ts. */
import { db } from "../../../packages/db/index.js";
import { assignedOutreachAt, isoWeekKey, runWeeklySageOutreach } from "../../../packages/trpc/src/services/sage-weekly-outreach.js";

const TEST_EMAIL_SUFFIX = "@test.cahootz.local";

function assertSafeEnvironment(email: string) {
  if (process.env.NODE_ENV === "production" || !email.endsWith(TEST_EMAIL_SUFFIX)) throw new Error("Weekly outreach fixture only accepts local test accounts");
  const host = (() => { try { return new URL(process.env.DATABASE_URL ?? "").hostname; } catch { return ""; } })();
  if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(host) && process.env.E2E_ALLOW_NONLOCAL_DB !== "1") {
    throw new Error(`Refusing non-local database host "${host}"`);
  }
}

async function target(email: string) {
  const user = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) throw new Error(`Test user not found: ${email}`);
  const anchor = new Date();
  const now = new Date(assignedOutreachAt(user.id, anchor).getTime() + 60_000);
  return { user, now, systemKey: `sage-weekly:${user.id}:${isoWeekKey(now)}` };
}

async function cleanup(email: string) {
  const { systemKey } = await target(email);
  const comment = await db.groupComment.findUnique({ where: { systemKey }, select: { id: true, groupId: true, createdAt: true } });
  if (!comment) return { deleted: 0 };
  await db.$transaction([
    db.notification.deleteMany({ where: { type: "DIRECT_MESSAGE", createdAt: { gte: comment.createdAt }, data: { path: ["groupId"], equals: comment.groupId } } }),
    // The check-in and the follow-up conversation the spec adds after it.
    db.groupComment.deleteMany({ where: { groupId: comment.groupId, createdAt: { gte: comment.createdAt } } }),
  ]);
  return { deleted: 1 };
}

async function seed(email: string) {
  await cleanup(email);
  const { user, now, systemKey } = await target(email);
  const summary = await runWeeklySageOutreach({
    now, userIds: [user.id],
    ignoreRecentConversation: true, generateWithModel: false,
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  const comment = await db.groupComment.findUnique({ where: { systemKey }, select: { groupId: true, content: true } });
  if (!comment || summary.sent !== 1) throw new Error(`Weekly outreach was not delivered: ${JSON.stringify(summary)}`);
  return { ...summary, ...comment };
}

/** Sage's latest reply after the check-in, so the spec can assert it is visible in the conversation. */
async function followup(email: string) {
  const { systemKey } = await target(email);
  const comment = await db.groupComment.findUnique({ where: { systemKey }, select: { groupId: true, authorId: true, createdAt: true } });
  if (!comment) throw new Error("No check-in to follow up on");
  const reply = await db.groupComment.findFirst({
    where: { groupId: comment.groupId, authorId: comment.authorId, createdAt: { gt: comment.createdAt } },
    orderBy: { createdAt: "desc" }, select: { content: true },
  });
  return { content: reply?.content ?? null };
}

async function main() {
  const [command, email] = process.argv.slice(2);
  if (!email) throw new Error("Usage: e2e-sage-weekly-outreach.ts seed|cleanup|followup <test-email>");
  assertSafeEnvironment(email);
  const result = command === "seed" ? await seed(email) : command === "cleanup" ? await cleanup(email)
    : command === "followup" ? await followup(email) : null;
  if (!result) throw new Error("Usage: e2e-sage-weekly-outreach.ts seed|cleanup|followup <test-email>");
  console.log(`E2E_RESULT ${JSON.stringify(result)}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
