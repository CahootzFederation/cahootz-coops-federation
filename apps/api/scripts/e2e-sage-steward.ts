/**
 * E2E fixture for Sage's follow-ups, routed alerts, introductions and memory
 * (apps/mobile/e2e/sage-steward.spec.ts). Not part of the product; only the
 * Playwright spec calls it. Every step runs the real service code.
 *
 *   follow-up <ownerEmail> <postId> <title> [--due]
 *     Sage starts following up with the member about their E2E post. With --due
 *     the task is backdated so the next wake handles it. If Sage already follows
 *     the post on its own, that task is used. Prints the task id and title.
 *   wake
 *     Runs one wake-and-wait cycle for the cahootz Commons (tasks only; the
 *     steward's model-backed daily review is not part of this command).
 *   alert <circleId> <runId>
 *     Routes an alert about the circle to its leader (CIRCLE_LEADER), twice, to
 *     show the second is deduplicated. Prints both results.
 *   introduce <needEmail> <helperEmail> <runId>
 *     Offers a consent-first introduction. Prints the suggestion id.
 *   steward-review <runId>
 *     Consolidates memory, then runs the steward's daily review with a fixed
 *     "nothing to do" decision instead of a live model, so the trail shows the
 *     memory Sage read. Prints the trail id.
 *   cleanup <runId> <taskIds,...|-> <circleId|-> <actionId|-> <stewardTrailId|->
 *     Deletes the E2E tasks, alerts, introduction (and its circle), memory and trails.
 *
 * Prints one JSON line prefixed with "E2E_RESULT ". Refuses anything but
 * seeded test accounts and refuses production.
 */
import { db } from "../../../packages/db/index.js";
import { createIntroductionSuggestion } from "../../../packages/trpc/src/services/sage-introductions.js";
import { consolidateSageMemory } from "../../../packages/trpc/src/services/sage-memory.js";
import { routeSageAlert } from "../../../packages/trpc/src/services/sage-responsibility.js";
import { runStewardReview } from "../../../packages/trpc/src/services/sage-steward.js";
import { createSageTask, runSageWakeCycle } from "../../../packages/trpc/src/services/sage-tasks.js";

const TEST_EMAIL_SUFFIX = "@test.cahootz.local";
const COOP_ID = "cahootz";
const DAY_MS = 86_400_000;

function assertSafeEnvironment() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to run the Sage steward fixture in production");
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? "").hostname;
    } catch {
      return "";
    }
  })();
  if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(host) && process.env.E2E_ALLOW_NONLOCAL_DB !== "1") {
    throw new Error(`Refusing to run the Sage steward fixture against non-local database host "${host}"`);
  }
}

function assertRunId(runId: string) {
  if (!/^[a-z0-9-]+$/i.test(runId)) throw new Error(`Invalid run id ${runId}`);
}

async function testUser(email: string) {
  if (!email.endsWith(TEST_EMAIL_SUFFIX)) throw new Error("Only seeded test accounts can be used");
  const user = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) throw new Error(`${email} not found`);
  return user.id;
}

async function followUp(ownerEmail: string, postId: string, title: string, due: boolean) {
  const ownerUserId = await testUser(ownerEmail);
  const post = await db.commonsPost.findUnique({ where: { id: postId }, select: { coopId: true, authorId: true, content: true } });
  if (!post || post.coopId !== COOP_ID || post.authorId !== ownerUserId || !post.content.includes("E2E")) throw new Error("Only the owner's own E2E post can be followed up on");
  const result = await createSageTask({
    coopId: COOP_ID, kind: "FOLLOW_UP", title, ownerUserId, subjectType: "commons_post", subjectId: postId, postId,
    reason: "Sage asked for the delivery details so it can draft a shared-driver proposal.",
    expected: "reply with your delivery days and what you pay now",
    offer: "I can draft the proposal for the Commons to review.", dueInDays: 2,
  });
  // Sage may already be following this post on its own (its reply scheduled a follow-up); the journey uses that task.
  if (result.taskId && due) {
    await db.sageTask.update({ where: { id: result.taskId }, data: { nextWakeAt: new Date(Date.now() - 60_000), createdAt: new Date(Date.now() - 2 * DAY_MS) } });
  }
  const task = result.taskId ? await db.sageTask.findUnique({ where: { id: result.taskId }, select: { title: true, createdBy: true } }) : null;
  return { ...result, title: task?.title ?? null, createdBy: task?.createdBy ?? null };
}

async function alert(circleId: string, runId: string) {
  assertRunId(runId);
  const circle = await db.group.findUnique({ where: { id: circleId }, select: { coopId: true, name: true } });
  if (!circle || circle.coopId !== COOP_ID || !circle.name.startsWith("E2E")) throw new Error("Only an E2E circle can be the subject");
  const input = {
    coopId: COOP_ID, circleId, category: "CIRCLE_LEADER" as const, subjectType: "group", subjectId: circleId,
    severity: "MEDIUM" as const, title: `E2E ${runId} members asking about dues`,
    body: "Several members asked the same question about circle dues and nobody has answered yet.",
    evidence: {
      source: `Three questions about dues in ${circle.name} this week.`,
      quote: `E2E ${runId}: does anyone know when circle dues are collected?`,
      why: "Sage saw repeated unanswered questions that only the circle can settle.",
      recommendation: "Post a short note in the circle explaining when dues are collected.",
    },
  };
  const first = await routeSageAlert(input);
  const second = await routeSageAlert(input);
  return { first, second };
}

async function introduce(needEmail: string, helperEmail: string, runId: string) {
  assertRunId(runId);
  return createIntroductionSuggestion({
    coopId: COOP_ID, needUserId: await testUser(needEmail), helperUserId: await testUser(helperEmail),
    needSummary: `E2E ${runId} help setting up bookkeeping`, reason: "One member asked for bookkeeping help; another lists bookkeeping as a skill.",
  });
}

async function stewardReview(runId: string) {
  assertRunId(runId);
  await consolidateSageMemory(COOP_ID);
  // The steward runs at most once every 20 hours; a review dated a day ahead isn't blocked by today's.
  const reviewAt = new Date(Date.now() + 21 * 3_600_000);
  const result = await runStewardReview(COOP_ID, reviewAt, async () => ({ summary: `E2E ${runId}: nothing needs action`, actions: [] }));
  const trail = await db.sageDecisionTrail.findFirst({ where: { coopId: COOP_ID, agent: "steward" }, orderBy: { createdAt: "desc" }, select: { id: true } });
  return { ...result, trailId: trail?.id ?? null };
}

async function cleanup(runId: string, taskIdsArg: string | undefined, circleId: string | undefined, actionId: string | undefined, stewardTrailId: string | undefined) {
  assertRunId(runId);
  const taskIds = (taskIdsArg ?? "").split(",").filter((id) => id && id !== "-");
  const tasks = taskIds.length ? await db.sageTask.findMany({ where: { id: { in: taskIds }, coopId: COOP_ID }, select: { id: true } }) : [];
  const ids = tasks.map((task) => task.id);
  const alerts = await db.sageAlert.findMany({ where: { coopId: COOP_ID, title: { contains: `E2E ${runId}` } }, select: { id: true } });
  const alertIds = alerts.map((row) => row.id);
  const action = actionId && actionId !== "-"
    ? await db.commonsAction.findFirst({ where: { id: actionId, coopId: COOP_ID, sourceType: "sage_introduction", summary: { contains: `E2E ${runId}` } }, select: { id: true } })
    : null;

  for (const id of [...ids, ...alertIds, ...(action ? [action.id] : [])]) {
    await db.notification.deleteMany({ where: { OR: [{ data: { path: ["taskId"], equals: id } }, { data: { path: ["alertId"], equals: id } }, { data: { path: ["actionId"], equals: id } }] } });
  }
  const sourceIds = [...ids, ...alertIds, ...(circleId && circleId !== "-" ? [circleId] : [])];
  await db.sageDecisionTrail.deleteMany({ where: { coopId: COOP_ID, sourceId: { in: sourceIds } } });
  if (stewardTrailId && stewardTrailId !== "-") await db.sageDecisionTrail.deleteMany({ where: { id: stewardTrailId, coopId: COOP_ID, agent: "steward" } });
  const memorySources = [...ids, ...(action ? [action.id] : [])];
  if (memorySources.length) {
    const memories = await db.aIObservation.findMany({ where: { generatedByAgentKey: "sage-memory" }, select: { id: true, sources: true } });
    const stale = memories.filter((row) => JSON.stringify(row.sources ?? []).match(new RegExp(memorySources.join("|")))).map((row) => row.id);
    if (stale.length) await db.aIObservation.deleteMany({ where: { id: { in: stale } } });
  }
  if (ids.length) await db.sageTask.deleteMany({ where: { id: { in: ids } } });
  if (alertIds.length) await db.sageAlert.deleteMany({ where: { id: { in: alertIds } } });
  if (action) {
    const introCircles = await db.group.findMany({ where: { coopId: COOP_ID, name: "Introduction", purpose: { contains: `E2E ${runId}` } }, select: { id: true } });
    for (const circle of introCircles) {
      await db.groupMember.deleteMany({ where: { groupId: circle.id } });
      await db.group.delete({ where: { id: circle.id } });
    }
    await db.sageDecisionTrail.deleteMany({ where: { actionIds: { has: action.id } } });
    await db.commonsAction.delete({ where: { id: action.id } });
  }
  return { tasks: ids.length, alerts: alertIds.length, introduction: Boolean(action) };
}

async function main() {
  assertSafeEnvironment();
  const [command, first, second, third, fourth, fifth] = process.argv.slice(2);
  const result = command === "follow-up" && first && second && third
    ? await followUp(first, second, third, fourth === "--due")
    : command === "wake"
      ? await runSageWakeCycle(COOP_ID, "MANUAL")
      : command === "alert" && first && second
        ? await alert(first, second)
        : command === "introduce" && first && second && third
          ? await introduce(first, second, third)
          : command === "steward-review" && first
            ? await stewardReview(first)
            : command === "cleanup" && first
              ? await cleanup(first, second, third, fourth, fifth)
              : null;
  if (!result) throw new Error("Usage: e2e-sage-steward.ts follow-up|wake|alert|introduce|steward-review|cleanup ...");
  console.log(`E2E_RESULT ${JSON.stringify(result)}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
