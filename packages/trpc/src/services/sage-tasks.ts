import { db, type SageTask } from "@repo/db";

import { createNotificationAndPush } from "./push-notification-service.js";
import { DecisionTrail } from "./sage-decision-trail.js";

/**
 * Sage's task ledger and the wake-and-wait loop (Cadence).
 *
 * A task is something Sage is waiting on: an answer it asked for, a promise it made ("Once you've done
 * that, I can..."), or a deadline. Tasks are created by code from Sage's own replies, never invented by
 * a model. When a task is due, the wake loop verifies the outcome from app data (not from anyone's
 * word), then either closes it, sends one gentle reminder, or gives up. Sage doesn't nag.
 */

export const FOLLOW_UP_MIN_DAYS = 1;
export const FOLLOW_UP_MAX_DAYS = 14;
export const FOLLOW_UP_DEFAULT_DAYS = 3;
export const DISMISS_COOLDOWN_DAYS = 30;
export const STALE_DRAFT_DAYS = 7;
const LEASE_MS = 10 * 60 * 1000;
const DAY_MS = 86_400_000;
const REMINDER_GRACE_DAYS = 3;
const WAKE_BATCH = 50;

export type SageTaskKind = "FOLLOW_UP" | "REVIEW_STALE_DRAFT" | "DEADLINE_REMINDER";
export type SageTaskSubject = "commons_post" | "proposal_draft" | "proposal" | "event";

export interface CreateTaskInput {
  coopId: string;
  circleId?: string | null;
  kind: SageTaskKind;
  title: string;
  reason: string;
  expected?: string;
  offer?: string;
  ownerUserId: string;
  subjectType: SageTaskSubject;
  subjectId: string;
  postId?: string | null;
  sourceActionId?: string | null;
  dueInDays?: number;
  createdBy?: "SAGE" | "SYSTEM";
}

export function clampFollowUpDays(days: number | undefined): number {
  if (!days || !Number.isFinite(days)) return FOLLOW_UP_DEFAULT_DAYS;
  return Math.min(FOLLOW_UP_MAX_DAYS, Math.max(FOLLOW_UP_MIN_DAYS, Math.round(days)));
}

/**
 * Creates a task unless one is already open for the same subject and owner, the owner dismissed the
 * same kind of task for this subject in the last 30 days, or the owner isn't an active member.
 */
export async function createSageTask(input: CreateTaskInput, now = new Date()): Promise<{ created: boolean; taskId?: string; reason?: string }> {
  const membership = await db.userCoopMembership.findUnique({
    where: { userId_coopId: { userId: input.ownerUserId, coopId: input.coopId } }, select: { status: true },
  });
  if (membership?.status !== "ACTIVE") return { created: false, reason: "The member isn't active in this Commons" };

  const open = await db.sageTask.findFirst({
    where: { subjectType: input.subjectType, subjectId: input.subjectId, ownerUserId: input.ownerUserId, status: "OPEN" },
    select: { id: true },
  });
  if (open) return { created: false, taskId: open.id, reason: "Sage is already following this" };

  const dismissed = await db.sageTask.findFirst({
    where: {
      subjectType: input.subjectType, subjectId: input.subjectId, ownerUserId: input.ownerUserId, kind: input.kind,
      status: "DISMISSED", updatedAt: { gte: new Date(now.getTime() - DISMISS_COOLDOWN_DAYS * DAY_MS) },
    },
    select: { id: true },
  });
  if (dismissed) return { created: false, reason: "The member dismissed this recently" };

  const dueAt = new Date(now.getTime() + clampFollowUpDays(input.dueInDays) * DAY_MS);
  const task = await db.sageTask.create({
    data: {
      coopId: input.coopId, circleId: input.circleId ?? null, kind: input.kind,
      title: input.title.slice(0, 160), reason: input.reason.slice(0, 1000),
      expected: input.expected?.slice(0, 600), offer: input.offer?.slice(0, 400),
      ownerUserId: input.ownerUserId, subjectType: input.subjectType, subjectId: input.subjectId,
      postId: input.postId ?? null, sourceActionId: input.sourceActionId ?? null,
      dueAt, nextWakeAt: dueAt, createdBy: input.createdBy ?? "SAGE",
      events: { create: { eventType: "CREATED", detail: input.reason.slice(0, 500) } },
    },
    select: { id: true },
  });
  return { created: true, taskId: task.id };
}

// ── Verifying outcomes ───────────────────────────────────────────────────────

export interface TaskCheck {
  resolved: boolean;
  /** Why the task is done, or why it no longer applies. */
  outcome?: string;
  /** True when the subject is gone or over, so there's nothing left to remind about. */
  moot?: boolean;
}

/** Decides from app data alone whether what Sage was waiting for has happened. */
export async function checkTaskOutcome(task: Pick<SageTask, "kind" | "subjectType" | "subjectId" | "ownerUserId" | "postId" | "createdAt">, now = new Date()): Promise<TaskCheck> {
  if (task.subjectType === "commons_post") {
    const postId = task.postId ?? task.subjectId;
    const post = await db.commonsPost.findUnique({ where: { id: postId }, select: { id: true } });
    if (!post) return { resolved: true, moot: true, outcome: "The post was deleted" };
    if (task.ownerUserId) {
      const reply = await db.commonsComment.findFirst({
        where: { postId, authorId: task.ownerUserId, createdAt: { gt: task.createdAt } }, select: { id: true },
      });
      if (reply) return { resolved: true, outcome: "The member replied in the thread" };
      const threadActions = await db.commonsAction.findMany({ where: { sourcePostId: postId }, select: { id: true } });
      const draft = threadActions.length
        ? await db.commonsProposalDraft.findFirst({
            where: { authorId: task.ownerUserId, createdAt: { gt: task.createdAt }, actionId: { in: threadActions.map((action) => action.id) } },
            select: { id: true },
          })
        : null;
      if (draft) return { resolved: true, outcome: "A proposal draft was created from the thread" };
    }
    return { resolved: false };
  }
  if (task.subjectType === "proposal_draft") {
    const draft = await db.commonsProposalDraft.findUnique({ where: { id: task.subjectId }, select: { submittedAt: true } });
    if (!draft) return { resolved: true, moot: true, outcome: "The draft was deleted" };
    if (draft.submittedAt) return { resolved: true, outcome: "The draft was submitted" };
    return { resolved: false };
  }
  if (task.subjectType === "proposal") {
    const proposal = await db.proposal.findUnique({ where: { id: task.subjectId }, select: { status: true, votingEndsAt: true } });
    if (!proposal) return { resolved: true, moot: true, outcome: "The proposal no longer exists" };
    if (proposal.status !== "VOTABLE") return { resolved: true, outcome: `Voting is over (${proposal.status.toLowerCase()})` };
    if (proposal.votingEndsAt && proposal.votingEndsAt <= now) return { resolved: true, moot: true, outcome: "The voting window closed" };
    return { resolved: false };
  }
  if (task.subjectType === "event") {
    const event = await db.event.findUnique({ where: { id: task.subjectId }, select: { startAt: true } });
    if (!event) return { resolved: true, moot: true, outcome: "The event was removed" };
    if (event.startAt <= now) return { resolved: true, moot: true, outcome: "The event has started" };
    return { resolved: false };
  }
  return { resolved: false };
}

/** A gentle reminder in Sage's voice, built from the task itself - no model call. */
export function reminderText(task: Pick<SageTask, "kind" | "expected" | "offer" | "title">): { title: string; body: string } {
  if (task.kind === "REVIEW_STALE_DRAFT") {
    return { title: "Your proposal draft is waiting", body: `"${task.title}" is still a draft. Edit and submit it when it's ready, or dismiss this if you've moved on.` };
  }
  if (task.kind === "DEADLINE_REMINDER") {
    return { title: "A deadline is coming up", body: task.expected ?? task.title };
  }
  const expected = (task.expected ?? task.title).replace(/\.$/, "");
  const offer = task.offer ? ` Once you do, ${task.offer.replace(/^Once you've done that,?\s*/i, "").replace(/^I can/i, "I can")}` : "";
  return { title: "Sage is checking in", body: `Still planning to ${expected.charAt(0).toLowerCase()}${expected.slice(1)}?${offer}`.slice(0, 280) };
}

// ── The wake loop ────────────────────────────────────────────────────────────

async function taskTrailVisibility(task: SageTask): Promise<{ visibility: "COMMONS_MEMBERS" | "CIRCLE"; circleId: string | null; relatedPostIds: string[] }> {
  if (!task.postId) return { visibility: task.circleId ? "CIRCLE" : "COMMONS_MEMBERS", circleId: task.circleId, relatedPostIds: [] };
  const post = await db.commonsPost.findUnique({ where: { id: task.postId }, select: { circleId: true, coopId: true } });
  const isCircle = !!post?.circleId && post.circleId !== `general:${post.coopId}`;
  return { visibility: isCircle ? "CIRCLE" : "COMMONS_MEMBERS", circleId: isCircle ? post!.circleId : null, relatedPostIds: [task.postId] };
}

async function finishTask(task: SageTask, status: "DONE" | "ABANDONED" | "FAILED", outcome: string, eventType: string) {
  await db.sageTask.update({
    where: { id: task.id },
    data: { status, outcome, leaseUntil: null, lastWokeAt: new Date(), events: { create: { eventType, detail: outcome } } },
  });
}

/** Wakes one claimed task: verify, then close, remind once, or give up. Returns what happened. */
export async function wakeTask(task: SageTask, now = new Date()): Promise<"DONE" | "REMINDED" | "ABANDONED" | "FAILED"> {
  const where = await taskTrailVisibility(task);
  const trail = new DecisionTrail({
    agent: "cadence", coopId: task.coopId, circleId: where.circleId, sourceType: "sage_task", sourceId: task.id,
    trigger: "SAGE_WAKE", visibility: where.visibility, observed: { title: task.title, content: task.expected ?? task.reason },
    relatedPostIds: where.relatedPostIds,
  }).step("OBSERVED", `Checked back on: ${task.title}`);
  trail.step("EVIDENCE", "Why Sage was following this", { detail: task.reason });
  try {
    const check = await checkTaskOutcome(task, now);
    trail.policy("What Sage was waiting for has happened", check.resolved, check.outcome);
    if (check.resolved) {
      await finishTask(task, "DONE", check.outcome ?? "Done", "RESOLVED");
      await trail.taken(check.moot ? "Closed: nothing left to follow" : "Closed: it happened", "PASS")
        .result("Done", "PASS", "None.").setOutcome(`Follow-up closed: ${check.outcome ?? "done"}`).save();
      return "DONE";
    }
    const canRemind = trail.policy(`Under the reminder limit (${task.maxAttempts})`, task.attempts < task.maxAttempts,
      `${task.attempts} sent so far`);
    if (!canRemind) {
      await finishTask(task, "ABANDONED", "No response after a reminder", "ABANDONED");
      await trail.taken("Stopped following: no response after a reminder", "INFO")
        .result("Stopped", "INFO", "None. Sage doesn't keep reminding.").setOutcome("Follow-up stopped after one reminder").save();
      return "ABANDONED";
    }
    if (task.ownerUserId) {
      const text = reminderText(task);
      await createNotificationAndPush(db, {
        userId: task.ownerUserId, coopId: task.coopId, type: "SAGE_REMINDER", title: text.title, body: text.body,
        data: { taskId: task.id, coopId: task.coopId, ...(task.postId ? { postId: task.postId } : {}) },
      }).catch((error) => console.error("Could not send Sage reminder", error));
    }
    const nextWakeAt = new Date(now.getTime() + REMINDER_GRACE_DAYS * DAY_MS);
    await db.sageTask.update({
      where: { id: task.id },
      data: {
        attempts: { increment: 1 }, nextWakeAt, leaseUntil: null, lastWokeAt: now,
        events: { create: { eventType: "REMINDED", detail: "Sent one reminder" } },
      },
    });
    await trail.taken("Sent one gentle reminder", "PASS")
      .result("Waiting for a response", "INFO", `Sage checks once more around ${nextWakeAt.toISOString().slice(0, 10)}, then stops.`)
      .setOutcome("Sent a reminder").save();
    return "REMINDED";
  } catch (error) {
    await finishTask(task, "FAILED", "Sage couldn't check this", "FAILED").catch(() => {});
    await trail.taken("Couldn't check this", "FAIL", error instanceof Error ? error.message : String(error), true).setOutcome("Follow-up failed").save();
    return "FAILED";
  }
}

/** Claims due tasks with a lease so overlapping wake runs never handle the same task twice. */
export async function claimDueTasks(options: { coopId?: string; taskIds?: string[]; now?: Date; limit?: number } = {}): Promise<SageTask[]> {
  const now = options.now ?? new Date();
  const candidates = await db.sageTask.findMany({
    where: {
      status: "OPEN",
      ...(options.taskIds ? { id: { in: options.taskIds } } : { nextWakeAt: { lte: now } }),
      ...(options.coopId ? { coopId: options.coopId } : {}),
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
    },
    orderBy: { nextWakeAt: "asc" }, take: options.limit ?? WAKE_BATCH,
  });
  const claimed: SageTask[] = [];
  for (const task of candidates) {
    const result = await db.sageTask.updateMany({
      where: { id: task.id, status: "OPEN", OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
      data: { leaseUntil: new Date(now.getTime() + LEASE_MS) },
    });
    if (result.count) claimed.push(task);
  }
  return claimed;
}

/**
 * Creates the deadline tasks Cadence owns: unsubmitted proposal drafts left alone for a week. Called by
 * the wake cycle; createSageTask's duplicate and dismissal checks keep it from repeating itself.
 */
export async function scheduleDeadlineTasks(coopId: string, now = new Date()): Promise<number> {
  const stale = await db.commonsProposalDraft.findMany({
    where: { coopId, submittedAt: null, createdAt: { lte: new Date(now.getTime() - STALE_DRAFT_DAYS * DAY_MS) } },
    select: { id: true, authorId: true, title: true }, take: 50,
  });
  let created = 0;
  for (const draft of stale) {
    const result = await createSageTask({
      coopId, kind: "REVIEW_STALE_DRAFT", title: draft.title, ownerUserId: draft.authorId,
      reason: `This proposal draft hasn't been submitted for ${STALE_DRAFT_DAYS} days.`,
      subjectType: "proposal_draft", subjectId: draft.id, dueInDays: 1, createdBy: "SYSTEM",
    }, now);
    if (result.created) created++;
  }
  return created;
}

/** One wake run for one Commons, under a lease so runs never overlap. */
export async function runSageWakeCycle(coopId: string, reason: "SCHEDULED" | "EVENT" | "MANUAL", now = new Date(), extra?: (coopId: string) => Promise<void>) {
  const running = await db.sageWakeCycle.findFirst({ where: { coopId, status: "RUNNING", leaseUntil: { gt: now } }, select: { id: true } });
  if (running) return { skipped: true as const };
  const cycle = await db.sageWakeCycle.create({ data: { coopId, reason, leaseUntil: new Date(now.getTime() + LEASE_MS) } });
  try {
    await scheduleDeadlineTasks(coopId, now);
    const tasks = await claimDueTasks({ coopId, now });
    const results: Record<string, number> = {};
    for (const task of tasks) {
      const result = await wakeTask(task, now);
      results[result] = (results[result] ?? 0) + 1;
    }
    if (extra) await extra(coopId);
    await db.sageWakeCycle.update({ where: { id: cycle.id }, data: { status: "DONE", tasksProcessed: tasks.length, finishedAt: new Date() } });
    return { skipped: false as const, cycleId: cycle.id, processed: tasks.length, results };
  } catch (error) {
    await db.sageWakeCycle.update({ where: { id: cycle.id }, data: { status: "FAILED", error: error instanceof Error ? error.message : String(error), finishedAt: new Date() } });
    throw error;
  }
}

/** Wakes a member's open follow-ups on a post right away when they reply there. */
export async function wakeTasksForReply(postId: string, authorId: string): Promise<number> {
  const open = await db.sageTask.findMany({
    where: { status: "OPEN", ownerUserId: authorId, OR: [{ postId }, { subjectType: "commons_post", subjectId: postId }] },
    select: { id: true },
  });
  if (!open.length) return 0;
  const claimed = await claimDueTasks({ taskIds: open.map((task) => task.id) });
  for (const task of claimed) await wakeTask(task);
  return claimed.length;
}

export async function dismissSageTask(taskId: string, userId: string): Promise<boolean> {
  const result = await db.sageTask.updateMany({
    where: { id: taskId, ownerUserId: userId, status: "OPEN" },
    data: { status: "DISMISSED", outcome: "Dismissed by the member", leaseUntil: null },
  });
  if (!result.count) return false;
  await db.sageTaskEvent.create({ data: { taskId, eventType: "DISMISSED", detail: "Dismissed by the member" } });
  return true;
}
