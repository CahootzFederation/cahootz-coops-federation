/**
 * E2E fixture for the approval-gated Sage comment and proposal-draft journey
 * (apps/mobile/e2e/sage-stewardship.spec.ts). Not part of the product; only
 * the Playwright spec calls it.
 *
 *   tsx --import ./dotenv.config.js scripts/e2e-sage-suggestions.ts seed <runId> <circleId> <targetPostId>
 *     Replays two Sage trend outputs over closed windows of the circle through
 *     replayTrendWindow - the real decision path minus the model call, so the
 *     rows, review, audit, alert and decision trail are what the live trend
 *     model produces: a confident comment on <targetPostId>, which Sage
 *     publishes on its own with Auto-reply on, and an organization proposal
 *     draft, which waits for the leader's approval. This makes the approval journey
 *     deterministic; the live-model detection is covered by sage-trend.spec.ts.
 *   tsx --import ./dotenv.config.js scripts/e2e-sage-suggestions.ts repeat <runId> <circleId>
 *     After seed: replays a near-duplicate of the seeded proposal suggestion over a new window, which
 *     Sage skips as a repeat (recorded in the earlier suggestion's audit trail).
 *   tsx --import ./dotenv.config.js scripts/e2e-sage-suggestions.ts seed-pending <runId> <circleId> <targetPostId>
 *     Replays a Sage comment on <targetPostId> that isn't confident enough to post on its own, so it
 *     waits for the circle leader's approval (the suggestion follow-up journey).
 *   tsx --import ./dotenv.config.js scripts/e2e-sage-suggestions.ts cleanup <runId> [circleId]
 *     Deletes those suggestions with their reviews, audit events, drafts,
 *     Sage comments, alerts and decision trails, and the circle's analysis
 *     windows when circleId is given.
 *
 * Prints one JSON line prefixed with "E2E_RESULT ". Refuses anything but
 * seeded test accounts and refuses production.
 */
import { db } from "../../../packages/db/index.js";
import { replayTrendWindow } from "../../../packages/trpc/src/services/sage-trend-agent.js";

const TEST_EMAIL_SUFFIX = "@test.cahootz.local";

function assertSafeEnvironment() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run the Sage suggestion fixture in production");
  }
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? "").hostname;
    } catch {
      return "";
    }
  })();
  if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(host) && process.env.E2E_ALLOW_NONLOCAL_DB !== "1") {
    throw new Error(`Refusing to run the Sage suggestion fixture against non-local database host "${host}"`);
  }
}

function windowId(runId: string, kind: string) {
  if (!/^[a-z0-9-]+$/i.test(runId)) throw new Error(`Invalid run id ${runId}`);
  return `e2e-sage-window-${runId}-${kind}`;
}

async function seed(runId: string, circleId: string, targetPostId: string) {
  const group = await db.group.findUnique({
    where: { id: circleId },
    select: { coopId: true, leaderId: true, leader: { select: { email: true } } },
  });
  if (!group?.leaderId || !group.leader?.email?.endsWith(TEST_EMAIL_SUFFIX)) {
    throw new Error("The circle must exist and be led by a seeded test account");
  }
  const post = await db.commonsPost.findUnique({ where: { id: targetPostId }, select: { circleId: true } });
  if (post?.circleId !== circleId) throw new Error("The target post must belong to the circle");

  // Closed analysis windows covering the circle's last hour, as if Sage had just read them; the
  // suggestion page shows this window's conversation.
  const closedAt = new Date();
  const openedAt = new Date(closedAt.getTime() - 60 * 60 * 1000);
  for (const kind of ["comment", "proposal"]) {
    await db.circleAgentWindow.upsert({
      where: { id: windowId(runId, kind) },
      create: { id: windowId(runId, kind), groupId: circleId, coopId: group.coopId, openedAt, lastMessageAt: closedAt, closedAt, messageCount: 40, status: "CLOSED" },
      update: {},
    });
  }

  await replayTrendWindow(windowId(runId, "comment"), {
    hasSuggestion: true,
    confidence: 0.9,
    capability: "comment_on_post",
    targetPostId,
    title: `E2E ${runId} Sage comment`,
    body: `E2E ${runId}: Book the community room by Thursday; it fills up on weekends.`,
    reason: `E2E ${runId}: Three members asked where the cleanup should meet.`,
  });
  await replayTrendWindow(windowId(runId, "proposal"), {
    hasSuggestion: true,
    confidence: 0.9,
    capability: "draft_proposal",
    title: `E2E ${runId} Shared tool library`,
    body: `E2E ${runId}: Fund a shared tool library for the circle's monthly cleanups.`,
    reason: `E2E ${runId}: Members keep borrowing the same tools for every cleanup.`,
  });

  const actions = await db.commonsAction.findMany({
    where: { sourceId: { in: [windowId(runId, "comment"), windowId(runId, "proposal")] } },
    select: { id: true, sourceId: true },
  });
  const byKind = (kind: string) => actions.find((action) => action.sourceId === windowId(runId, kind))?.id;
  return { commentActionId: byKind("comment"), proposalActionId: byKind("proposal") };
}

async function seedPending(runId: string, circleId: string, targetPostId: string) {
  const group = await db.group.findUnique({ where: { id: circleId }, select: { coopId: true, name: true, leader: { select: { email: true } } } });
  if (!group?.name.startsWith("E2E ") || !group.leader?.email?.endsWith(TEST_EMAIL_SUFFIX)) throw new Error("Only E2E circles led by a test account can be used");
  const post = await db.commonsPost.findUnique({ where: { id: targetPostId }, select: { circleId: true } });
  if (post?.circleId !== circleId) throw new Error("The target post must belong to the circle");
  const closedAt = new Date();
  await db.circleAgentWindow.upsert({
    where: { id: windowId(runId, "pending") },
    create: { id: windowId(runId, "pending"), groupId: circleId, coopId: group.coopId, openedAt: new Date(closedAt.getTime() - 60 * 60 * 1000), lastMessageAt: closedAt, closedAt, messageCount: 40, status: "CLOSED" },
    update: {},
  });
  await replayTrendWindow(windowId(runId, "pending"), {
    hasSuggestion: true, confidence: 0.65, capability: "comment_on_post", targetPostId,
    title: `E2E ${runId} Answer the parking question`,
    body: `E2E ${runId}: Park behind the library; the front lot closes at 6.`,
    reason: `E2E ${runId}: Two members asked where to park and nobody answered.`,
  });
  const action = await db.commonsAction.findFirst({ where: { sourceId: windowId(runId, "pending") }, select: { id: true, status: true } });
  return { actionId: action?.id ?? null, status: action?.status ?? null };
}

async function repeat(runId: string, circleId: string) {
  const group = await db.group.findUnique({ where: { id: circleId }, select: { coopId: true, name: true } });
  if (!group?.name.startsWith("E2E ")) throw new Error("Only E2E circles can be used");
  const closedAt = new Date();
  await db.circleAgentWindow.upsert({
    where: { id: windowId(runId, "repeat") },
    create: { id: windowId(runId, "repeat"), groupId: circleId, coopId: group.coopId, openedAt: new Date(closedAt.getTime() - 60 * 60 * 1000), lastMessageAt: closedAt, closedAt, messageCount: 40, status: "CLOSED" },
    update: {},
  });
  await replayTrendWindow(windowId(runId, "repeat"), {
    hasSuggestion: true, confidence: 0.9, capability: "draft_proposal",
    title: `E2E ${runId} shared tool libraries`,
    body: `E2E ${runId}: Fund shared tool libraries for the circle's cleanups.`,
    reason: `E2E ${runId}: The tool library came up again.`,
  });
  return { repeated: true };
}

async function cleanup(runId: string, circleId?: string) {
  const windowIds = [windowId(runId, "comment"), windowId(runId, "proposal"), windowId(runId, "repeat"), windowId(runId, "pending")];
  const circleWindowIds = circleId
    ? (await db.circleAgentWindow.findMany({ where: { groupId: circleId }, select: { id: true } })).map((window) => window.id)
    : [];
  if (circleId) {
    const group = await db.group.findUnique({ where: { id: circleId }, select: { name: true } });
    if (group && !group.name.startsWith("E2E ")) throw new Error("Only E2E circles can be cleaned up");
  }
  const actions = await db.commonsAction.findMany({
    // Includes anything the live trend model suggested in the E2E circle (e.g. after "Analyze now").
    where: { OR: [{ sourceId: { in: windowIds } }, ...(circleId ? [{ circleId, sourceType: "circle_trend" }] : [])] },
    select: { id: true },
  });
  const actionIds = actions.map((action) => action.id);
  const extraCleanup = [
    db.sageDecisionTrail.deleteMany({ where: { OR: [{ sourceId: { in: windowIds } }, ...(circleId ? [{ circleId }] : [])] } }),
    db.commonsContentScan.deleteMany({ where: { sourceId: { in: [...windowIds, ...circleWindowIds] } } }),
    db.circleAgentWindow.deleteMany({ where: { OR: [{ id: { in: windowIds } }, ...(circleId ? [{ groupId: circleId }] : [])] } }),
  ];
  if (actionIds.length === 0) {
    await db.$transaction(extraCleanup);
    return { deleted: 0 };
  }
  const executed = await db.commonsActionAudit.findMany({
    where: { actionId: { in: actionIds }, eventType: { in: ["ACTION_EXECUTED", "AUTO_PUBLISHED"] } },
    select: { metadata: true },
  });
  const commentIds = executed
    .map((event) => event.metadata as { resultEntityType?: string; resultEntityId?: string } | null)
    .filter((result) => result?.resultEntityType === "CommonsComment")
    .map((result) => result!.resultEntityId!);
  const drafts = await db.commonsProposalDraft.findMany({ where: { actionId: { in: actionIds } }, select: { id: true } });
  const draftIds = drafts.map((draft) => draft.id);
  // Sage's follow-ups on these suggestions, their reminders and trails.
  const tasks = await db.sageTask.findMany({ where: { sourceActionId: { in: actionIds } }, select: { id: true } });
  const taskIds = tasks.map((task) => task.id);
  await db.$transaction([
    db.notification.deleteMany({ where: { OR: taskIds.map((id) => ({ data: { path: ["taskId"], equals: id } })) } }),
    db.sageDecisionTrail.deleteMany({ where: { sourceId: { in: taskIds } } }),
    db.sageTask.deleteMany({ where: { id: { in: taskIds } } }),
    db.notification.deleteMany({
      where: {
        OR: [
          ...actionIds.map((id) => ({ data: { path: ["actionId"], equals: id } })),
          ...draftIds.map((id) => ({ data: { path: ["draftId"], equals: id } })),
          ...commentIds.map((id) => ({ data: { path: ["commentId"], equals: id } })),
        ],
      },
    }),
    db.commonsComment.deleteMany({ where: { id: { in: commentIds } } }),
    db.commonsProposalDraft.deleteMany({ where: { id: { in: draftIds } } }),
    db.commonsAction.deleteMany({ where: { id: { in: actionIds } } }),
    ...extraCleanup,
  ]);
  return { deleted: actionIds.length };
}

async function main() {
  assertSafeEnvironment();
  const [command, first, second, third] = process.argv.slice(2);
  // cleanup takes an optional circleId as its second argument
  const result =
    command === "seed" && first && second && third
      ? await seed(first, second, third)
      : command === "seed-pending" && first && second && third
        ? await seedPending(first, second, third)
      : command === "repeat" && first && second
        ? await repeat(first, second)
      : command === "cleanup" && first
        ? await cleanup(first, second)
        : (() => {
            throw new Error("Usage: e2e-sage-suggestions.ts seed <runId> <circleId> <targetPostId> | cleanup <runId> [circleId]");
          })();
  console.log(`E2E_RESULT ${JSON.stringify(result)}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
