import { db, type SageTask } from "@repo/db";

import { createNotificationAndPush } from "./push-notification-service.js";
import { DecisionTrail } from "./sage-decision-trail.js";
import {
  SUGGESTION_GRACE_DAYS, SUGGESTION_TASK_KIND, SUGGESTION_TASK_SUBJECT, checkSuggestionReview, closeSuggestion, suggestionReminderText,
} from "./sage-suggestion-follow-up.js";

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
/** Owners get a week to answer an outcome check before the one reminder, and a week after it. */
const OUTCOME_GRACE_DAYS = 7;
const WAKE_BATCH = 50;

// REVIEW_SUGGESTION / suggestion_review tasks are created by sage-suggestion-follow-up.ts, not createSageTask.
export type SageTaskKind = "FOLLOW_UP" | "REVIEW_STALE_DRAFT" | "DEADLINE_REMINDER" | "CHECK_OUTCOME";
export type SageTaskSubject = "commons_post" | "proposal_draft" | "proposal" | "event" | "proposal_kpi";
/** Outcome checks run on a KPI's own measure date, which can be months away. */
export const OUTCOME_CHECK_MAX_DAYS = 366;

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
  /** A fixed date instead of dueInDays. Only outcome checks use it; clamped to now..366 days. */
  dueAt?: Date;
  /** Messages Sage may send before it stops (default 1). */
  maxAttempts?: number;
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

  const dueAt = input.dueAt && input.kind === "CHECK_OUTCOME"
    ? new Date(Math.min(Math.max(input.dueAt.getTime(), now.getTime()), now.getTime() + OUTCOME_CHECK_MAX_DAYS * DAY_MS))
    : new Date(now.getTime() + clampFollowUpDays(input.dueInDays) * DAY_MS);
  const task = await db.sageTask.create({
    data: {
      coopId: input.coopId, circleId: input.circleId ?? null, kind: input.kind,
      title: input.title.slice(0, 160), reason: input.reason.slice(0, 1000),
      expected: input.expected?.slice(0, 600), offer: input.offer?.slice(0, 400),
      ownerUserId: input.ownerUserId, subjectType: input.subjectType, subjectId: input.subjectId,
      postId: input.postId ?? null, sourceActionId: input.sourceActionId ?? null,
      dueAt, nextWakeAt: dueAt, createdBy: input.createdBy ?? "SAGE",
      maxAttempts: Math.min(3, Math.max(1, input.maxAttempts ?? 1)),
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
export async function checkTaskOutcome(task: Pick<SageTask, "id" | "kind" | "subjectType" | "subjectId" | "ownerUserId" | "postId" | "createdAt">, now = new Date()): Promise<TaskCheck> {
  if (task.subjectType === SUGGESTION_TASK_SUBJECT) return checkSuggestionReview(task, now);
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
  if (task.subjectType === "proposal_kpi") {
    const kpi = await db.proposalKPI.findUnique({
      where: { id: task.subjectId }, select: { outcome: true, proposal: { select: { status: true } } },
    });
    if (!kpi) return { resolved: true, moot: true, outcome: "The proposal or its goal was removed" };
    if (kpi.outcome) return { resolved: true, outcome: `Result recorded: ${OUTCOME_WORDS[kpi.outcome] ?? kpi.outcome.toLowerCase()}` };
    if (!["APPROVED", "FUNDED"].includes(kpi.proposal.status)) {
      return { resolved: true, moot: true, outcome: `The proposal is now ${kpi.proposal.status.toLowerCase()}` };
    }
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

export const OUTCOME_WORDS: Record<string, string> = { MET: "met", PARTLY_MET: "partly met", MISSED: "missed", NO_REPORT: "no report" };

/** A gentle reminder in Sage's voice, built from the task itself - no model call. */
export function reminderText(task: Pick<SageTask, "kind" | "expected" | "offer" | "title"> & { attempts?: number }): { title: string; body: string } {
  if (task.kind === "CHECK_OUTCOME") {
    return {
      title: task.attempts ? `Still waiting on: ${task.title}` : `How did it go? ${task.title}`,
      body: `Time to ${(task.expected ?? `report how "${task.title}" went`).replace(/\.$/, "")}. Open the proposal to answer; the result is shown there for everyone in the Commons.`.slice(0, 280),
    };
  }
  if (task.kind === SUGGESTION_TASK_KIND) return suggestionReminderText(task.title);
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

async function taskTrailVisibility(task: SageTask): Promise<{ visibility: "COMMONS_MEMBERS" | "CIRCLE" | "ADMINS"; circleId: string | null; relatedPostIds: string[] }> {
  // Suggestions are visible only to the people in them (an introduction or ride match names a need), so their trails are admin-only.
  if (task.subjectType === SUGGESTION_TASK_SUBJECT) return { visibility: "ADMINS", circleId: task.circleId, relatedPostIds: [] };
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
    const isSuggestion = task.subjectType === SUGGESTION_TASK_SUBJECT;
    if (!canRemind) {
      if (isSuggestion && task.sourceActionId) {
        await finishTask(task, "ABANDONED", "Nobody answered after a reminder, so Sage closed the suggestion", "ABANDONED");
        await closeSuggestion(task.sourceActionId, "Nobody answered after Sage's reminder", "NO_RESPONSE", { skipTaskId: task.id });
        await trail.taken("Closed the suggestion: nobody answered after a reminder", "INFO")
          .result("Closed", "INFO", "None. The suggestion was dismissed; nothing was published or decided.").setOutcome("Suggestion closed after one reminder").save();
        return "ABANDONED";
      }
      await finishTask(task, "ABANDONED", "No response after a reminder", "ABANDONED");
      await trail.taken("Stopped following: no response after a reminder", "INFO")
        .result("Stopped", "INFO", "None. Sage doesn't keep reminding.").setOutcome("Follow-up stopped after one reminder").save();
      return "ABANDONED";
    }
    if (task.ownerUserId) {
      const text = reminderText(task);
      // An outcome check opens the proposal, where the owner reports the result.
      const proposalId = task.subjectType === "proposal_kpi"
        ? (await db.proposalKPI.findUnique({ where: { id: task.subjectId }, select: { proposalId: true } }))?.proposalId
        : undefined;
      await createNotificationAndPush(db, {
        userId: task.ownerUserId, coopId: task.coopId, type: isSuggestion ? "SAGE_SUGGESTION_REMINDER" : "SAGE_REMINDER", title: text.title, body: text.body,
        data: {
          taskId: task.id, coopId: task.coopId,
          ...(isSuggestion && task.sourceActionId ? { actionId: task.sourceActionId } : task.postId ? { postId: task.postId } : {}),
          ...(proposalId ? { proposalId } : {}),
        },
      }).catch((error) => console.error("Could not send Sage reminder", error));
    }
    const graceDays = isSuggestion ? SUGGESTION_GRACE_DAYS : task.kind === "CHECK_OUTCOME" ? OUTCOME_GRACE_DAYS : REMINDER_GRACE_DAYS;
    const nextWakeAt = new Date(now.getTime() + graceDays * DAY_MS);
    await db.sageTask.update({
      where: { id: task.id },
      data: {
        attempts: { increment: 1 }, nextWakeAt, leaseUntil: null, lastWokeAt: now,
        events: { create: { eventType: "REMINDED", detail: task.kind === "CHECK_OUTCOME" && !task.attempts ? "Asked the owner for the result" : "Sent one reminder" } },
      },
    });
    await trail.taken(task.kind === "CHECK_OUTCOME" && !task.attempts ? "Asked the owner for the result, privately" : "Sent one gentle reminder", "PASS")
      .result("Waiting for a response", "INFO", task.attempts + 1 < task.maxAttempts
        ? `Sage checks again around ${nextWakeAt.toISOString().slice(0, 10)}.`
        : `Sage checks once more around ${nextWakeAt.toISOString().slice(0, 10)}, then ${isSuggestion ? "closes the suggestion if nobody answers" : "stops"}.`)
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
