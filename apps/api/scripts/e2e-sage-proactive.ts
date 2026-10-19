/**
 * Deterministic fixture for apps/mobile/e2e/sage-proactive.spec.ts: Sage reaching out on its own.
 * Each command sets up the state a real day would produce, then runs the real service that sends the
 * message (the wake loop, the needs sweep). Everything the members do afterwards happens in the app.
 *
 *   promise <emailA> <runId>                 Sage promised A a check-back; it comes due and is sent.
 *   need <emailA> <emailB> <runId>           B's Need post went 49h unanswered; A's profile fits; the sweep asks A.
 *   intro <emailA> <emailB> <runId>          A was introduced to B 5 days ago; Sage asks A whether it helped.
 *   shoutout <runId>                         The Win post Sage published after B agreed, if any.
 *   cleanup <emailA> <emailB> <runId> <since>
 *
 * Prints one JSON line prefixed with "E2E_RESULT ". Refuses production and non-local databases.
 */
import { db } from "../../../packages/db/index.js";
import { ensureSageBotUser } from "../../../packages/trpc/src/lib/bot.js";
import { COMMONS_COOP_ID } from "../../../packages/trpc/src/lib/commons.js";
import { scheduleIntroductionOutcome } from "../../../packages/trpc/src/services/commons-action-tools.js";
import { directKeyFor } from "../../../packages/trpc/src/services/direct-circles.js";
import { createIntroductionSuggestion } from "../../../packages/trpc/src/services/sage-introductions.js";
import { scheduleMemberCheckIn } from "../../../packages/trpc/src/services/sage-proactive.js";
import { claimDueTasks, wakeTask } from "../../../packages/trpc/src/services/sage-tasks.js";
import { askHelpersForUnansweredNeeds } from "../../../packages/trpc/src/services/sage-unanswered-needs.js";

const DAY_MS = 86_400_000;

function assertSafeEnvironment(emails: string[]) {
  if (process.env.NODE_ENV === "production" || emails.some((email) => !email.endsWith("@test.cahootz.local"))) {
    throw new Error("Proactive fixture only accepts local test accounts");
  }
  const host = (() => { try { return new URL(process.env.DATABASE_URL ?? "").hostname; } catch { return ""; } })();
  if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(host) && process.env.E2E_ALLOW_NONLOCAL_DB !== "1") {
    throw new Error(`Refusing non-local database host "${host}"`);
  }
}

async function user(email: string) {
  const found = await db.user.findUnique({ where: { email }, select: { id: true, name: true, handle: true, skills: true } });
  if (!found) throw new Error(`Test user not found: ${email}`);
  return found;
}

/** A short word unique to this run, so profile matching only finds this run's post. */
const skillWord = (runId: string) => `zz${runId.replace(/[^a-z0-9]/gi, "").slice(-8).toLowerCase()}fix`;

async function wakeNow(taskId: string) {
  await db.sageTask.update({ where: { id: taskId }, data: { dueAt: new Date(Date.now() - 60_000), nextWakeAt: new Date(Date.now() - 60_000) } });
  const [claimed] = await claimDueTasks({ taskIds: [taskId] });
  if (!claimed) throw new Error("Could not claim the task");
  return wakeTask(claimed);
}

async function promise(emailA: string, runId: string) {
  const a = await user(emailA);
  const about = `how the interview went (E2E ${runId})`;
  const scheduled = await scheduleMemberCheckIn({ memberId: a.id, coopId: COMMONS_COOP_ID, about, days: 2 });
  if (!scheduled.ok) throw new Error(scheduled.reason);
  // Made two days ago, so nothing A said before today counts as already keeping it.
  await db.sageTask.update({ where: { id: scheduled.taskId }, data: { createdAt: new Date(Date.now() - 60_000) } });
  return { woke: await wakeNow(scheduled.taskId), expected: `Checking back like I promised: how the interview went (E2E ${runId})?` };
}

async function need(emailA: string, emailB: string, runId: string) {
  const [a, b] = await Promise.all([user(emailA), user(emailB)]);
  const word = skillWord(runId);
  await db.user.update({ where: { id: a.id }, data: { skills: [...a.skills, word] } });
  const post = await db.commonsPost.create({
    data: {
      coopId: COMMONS_COOP_ID, circleId: `general:${COMMONS_COOP_ID}`, authorId: b.id, tag: "Need",
      title: `E2E ${runId} need help with ${word}`, content: `E2E ${runId}: Is anyone able to help with ${word} this week?`,
      createdAt: new Date(Date.now() - 49 * 3_600_000),
    },
  });
  const result = await askHelpersForUnansweredNeeds(COMMONS_COOP_ID, new Date(), { postIds: [post.id] });
  return { postId: post.id, title: post.title, ...result };
}

async function intro(emailA: string, emailB: string, runId: string) {
  const [a, b] = await Promise.all([user(emailA), user(emailB)]);
  const created = await createIntroductionSuggestion({
    coopId: COMMONS_COOP_ID, needUserId: a.id, helperUserId: b.id, needSummary: `E2E ${runId} a ride to the clinic`, reason: "E2E fixture",
  });
  if (!created.created || !created.actionId) throw new Error(`Introduction refused: ${created.reason}`);
  // Both said yes and the private circle exists (the existing introduction journey covers that part).
  await db.commonsActionReview.updateMany({ where: { actionId: created.actionId }, data: { status: "APPROVED", respondedAt: new Date() } });
  const action = await db.commonsAction.update({ where: { id: created.actionId }, data: { status: "APPROVED", reviewedAt: new Date(Date.now() - 5 * DAY_MS) } });
  const participants = await db.commonsActionParticipant.findMany({ where: { actionId: action.id } });
  const task = await scheduleIntroductionOutcome(action, participants);
  if (!task?.taskId) throw new Error(`Could not schedule the introduction check: ${task?.reason}`);
  return { introActionId: action.id, woke: await wakeNow(task.taskId), helperName: b.name || b.handle };
}

async function shoutout(runId: string, since: string) {
  const post = await db.commonsPost.findFirst({
    where: { classification: "sage_shout_out", createdAt: { gte: new Date(since) } }, orderBy: { createdAt: "desc" }, select: { id: true, title: true },
  });
  return { postId: post?.id ?? null, title: post?.title ?? null, runId };
}

async function cleanup(emailA: string, emailB: string, runId: string, sinceIso: string) {
  const [a, b] = await Promise.all([user(emailA), user(emailB)]);
  const since = new Date(sinceIso);
  const sage = await ensureSageBotUser(db, COMMONS_COOP_ID);
  const groups = await db.group.findMany({
    where: { directKey: { in: [directKeyFor(COMMONS_COOP_ID, sage.id, a.id), directKeyFor(COMMONS_COOP_ID, sage.id, b.id)] } }, select: { id: true },
  });
  const posts = await db.commonsPost.findMany({
    where: { OR: [{ title: { contains: runId } }, { classification: "sage_shout_out", createdAt: { gte: since } }] }, select: { id: true },
  });
  const postIds = posts.map((post) => post.id);
  const actions = await db.commonsAction.findMany({
    where: { createdAt: { gte: since }, sourceAuthorId: { in: [a.id, b.id] }, sourceType: { in: ["sage_introduction", "sage_conversation_ask"] } }, select: { id: true },
  });
  const actionIds = actions.map((action) => action.id);
  const tasks = await db.sageTask.findMany({ where: { createdAt: { gte: since }, ownerUserId: { in: [a.id, b.id] } }, select: { id: true } });
  const result = {
    trails: (await db.sageDecisionTrail.deleteMany({ where: { sourceType: "sage_task", sourceId: { in: tasks.map((task) => task.id) } } })).count,
    tasks: (await db.sageTask.deleteMany({ where: { id: { in: tasks.map((task) => task.id) } } })).count,
    observations: (await db.aIObservation.deleteMany({ where: { systemKey: { in: actionIds.map((id) => `help-outcome:${id}`) } } })).count,
    audits: (await db.auditLog.deleteMany({ where: { OR: [{ resourceId: { in: postIds } }, { action: "SAGE_PROACTIVE_LIMITED", resourceId: { in: [a.id, b.id] }, occurredAt: { gte: since } }] } })).count,
    comments: (await db.commonsComment.deleteMany({ where: { postId: { in: postIds } } })).count,
    posts: (await db.commonsPost.deleteMany({ where: { id: { in: postIds } } })).count,
    actions: (await db.commonsAction.deleteMany({ where: { id: { in: actionIds } } })).count,
    messages: (await db.groupComment.deleteMany({ where: { groupId: { in: groups.map((group) => group.id) }, createdAt: { gte: since } } })).count,
    notifications: (await db.notification.deleteMany({ where: { userId: { in: [a.id, b.id] }, createdAt: { gte: since } } })).count,
  };
  const word = skillWord(runId);
  const freshA = await user(emailA);
  await db.user.update({ where: { id: a.id }, data: { skills: freshA.skills.filter((skill) => skill !== word) } });
  return result;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const emails = args.filter((arg) => arg.includes("@"));
  assertSafeEnvironment(emails);
  const [first, second, third, fourth] = args;
  const result =
    command === "promise" && first && second ? await promise(first, second)
      : command === "need" && first && second && third ? await need(first, second, third)
        : command === "intro" && first && second && third ? await intro(first, second, third)
          : command === "shoutout" && first && second ? await shoutout(first, second)
            : command === "cleanup" && first && second && third && fourth ? await cleanup(first, second, third, fourth)
              : null;
  if (!result) throw new Error("Usage: e2e-sage-proactive.ts promise|need|intro|shoutout|cleanup ...");
  console.log(`E2E_RESULT ${JSON.stringify(result)}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
