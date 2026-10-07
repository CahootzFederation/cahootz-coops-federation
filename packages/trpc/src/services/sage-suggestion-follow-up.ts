import { db, type CommonsAction, type CommonsActionReview } from "@repo/db";

import { createNotificationAndPush } from "./push-notification-service.js";
import { titlesNearlyIdentical } from "./sage-titles.js";

/**
 * Follow-through on Sage's suggestions that wait on someone (a circle leader's approval, a ride
 * detail, an introduction's yes). Every waiting answer gets one task in the wake loop, so Sage:
 *
 * - closes the suggestion as soon as it no longer applies, judged from app data only (the post or
 *   circle is gone, someone left, the time passed, the work was already done) - no model call;
 * - reminds the person once after SUGGESTION_REMIND_AFTER_DAYS;
 * - closes it when nobody has answered by SUGGESTION_CLOSE_AFTER_DAYS.
 *
 * Closing only dismisses the suggestion: nothing is published, spent or decided.
 */

export const SUGGESTION_REMIND_AFTER_DAYS = 3;
export const SUGGESTION_CLOSE_AFTER_DAYS = 7;
/** Time between the one reminder and closing. */
export const SUGGESTION_GRACE_DAYS = SUGGESTION_CLOSE_AFTER_DAYS - SUGGESTION_REMIND_AFTER_DAYS;
export const SUGGESTION_TASK_KIND = "REVIEW_SUGGESTION";
export const SUGGESTION_TASK_SUBJECT = "suggestion_review";
const SWEEP_BATCH = 200;
const DAY_MS = 86_400_000;

type ReviewWithAction = CommonsActionReview & { action: CommonsAction };

const ANSWERED: Record<string, string> = {
  APPROVED: "You approved it", DECLINED: "You declined it", ESCALATED: "You sent it to an admin",
  EXPIRED: "The suggestion was closed", SUPERSEDED: "The suggestion changed",
};

/**
 * Why a waiting suggestion no longer applies, or null while it still does. Deterministic checks on
 * app data; the reasons are shown to the people involved, so they never name another member.
 */
export async function suggestionNoLongerApplies(review: Pick<CommonsActionReview, "userId" | "reviewType">, action: CommonsAction, now = new Date()): Promise<string | null> {
  const participants = await db.commonsActionParticipant.findMany({ where: { actionId: action.id }, select: { userId: true } });
  const people = [...new Set([review.userId, ...participants.map((participant) => participant.userId)])];
  const active = await db.userCoopMembership.count({ where: { coopId: action.coopId, userId: { in: people }, status: "ACTIVE" } });
  if (active < people.length) return "Someone it involved is no longer an active member of this Commons";

  if (action.circleId) {
    const circle = await db.group.findUnique({ where: { id: action.circleId }, select: { leaderId: true } });
    if (!circle) return "The circle was deleted";
    if (review.reviewType === "APPROVE_SUGGESTION" && circle.leaderId !== review.userId) return "The circle has a new leader";
    const stillInCircle = await db.groupMember.findUnique({ where: { groupId_userId: { groupId: action.circleId, userId: review.userId } }, select: { id: true } });
    if (!stillInCircle && circle.leaderId !== review.userId) return "The person asked left the circle";
  }

  if (action.sourceType === "circle_message") {
    const message = await db.groupComment.findUnique({ where: { id: action.sourceId }, select: { id: true } });
    if (!message) return "The message it came from was deleted";
  }

  const payload = (action.payload ?? {}) as { capability?: unknown; title?: unknown; targetPostId?: unknown; suggestedStartAt?: unknown };
  if (typeof payload.targetPostId === "string") {
    const post = await db.commonsPost.findUnique({ where: { id: payload.targetPostId }, select: { id: true } });
    if (!post) return "The post it was about was deleted";
    if (payload.capability === "comment_on_post") {
      const sageComment = await db.commonsComment.findFirst({
        where: { postId: payload.targetPostId, createdAt: { gt: action.createdAt }, author: { isBot: true } }, select: { id: true },
      });
      if (sageComment) return "Sage already commented on that post";
    }
  }
  if (typeof payload.suggestedStartAt === "string") {
    const startAt = new Date(payload.suggestedStartAt);
    if (!Number.isNaN(startAt.getTime()) && startAt <= now) return "The suggested time has passed";
  }
  if (payload.capability === "draft_proposal" && typeof payload.title === "string") {
    const drafts = await db.commonsProposalDraft.findMany({
      where: { coopId: action.coopId, authorId: review.userId, createdAt: { gt: action.createdAt }, actionId: { not: action.id } },
      select: { title: true }, take: 20,
    });
    const title = payload.title;
    if (drafts.some((draft) => titlesNearlyIdentical(draft.title, title))) return "A proposal draft on this already exists";
  }
  return null;
}

/**
 * Dismisses a waiting suggestion: every unanswered review expires, the timeline records why, any open
 * follow-up on it closes, and the people who already said yes are told it won't go ahead (in their
 * inbox only - no push). Returns false when it was already finished.
 */
export async function closeSuggestion(actionId: string, reason: string, kind: "NO_LONGER_APPLIES" | "NO_RESPONSE", options: { skipTaskId?: string } = {}): Promise<boolean> {
  const now = new Date();
  const closed = await db.$transaction(async (tx) => {
    const updated = await tx.commonsAction.updateMany({ where: { id: actionId, status: "PENDING" }, data: { status: "DISMISSED" } });
    if (!updated.count) return false;
    await tx.commonsActionReview.updateMany({ where: { actionId, status: "PENDING" }, data: { status: "EXPIRED", respondedAt: now } });
    await tx.commonsActionAudit.create({ data: { actionId, actorId: null, eventType: "AUTO_CLOSED", metadata: { reason, kind } } });
    return true;
  });
  if (!closed) return false;

  const tasks = await db.sageTask.findMany({
    where: { sourceActionId: actionId, subjectType: SUGGESTION_TASK_SUBJECT, status: "OPEN", ...(options.skipTaskId ? { id: { not: options.skipTaskId } } : {}) },
    select: { id: true },
  });
  for (const task of tasks) {
    await db.sageTask.update({ where: { id: task.id }, data: {
      status: "DONE", outcome: reason, leaseUntil: null, events: { create: { eventType: "RESOLVED", detail: reason } },
    } });
  }

  const action = await db.commonsAction.findUnique({ where: { id: actionId }, select: { coopId: true, summary: true } });
  const waiting = await db.commonsActionReview.findMany({ where: { actionId, status: "APPROVED" }, select: { userId: true }, distinct: ["userId"] });
  for (const { userId } of action ? waiting : []) {
    await createNotificationAndPush(db, {
      userId, coopId: action!.coopId, type: "SAGE_SUGGESTION_CLOSED", push: false,
      title: "Sage closed a suggestion", body: `"${action!.summary.slice(0, 120)}" won't go ahead. ${reason}.`,
      data: { actionId },
    }).catch((error) => console.error("Could not tell a member Sage closed a suggestion", error));
  }
  return true;
}

/** Resolves the follow-up on one review once it's answered, so the Following tab is current right away. */
export async function resolveSuggestionReviewTask(reviewId: string, outcome: string, client: Pick<typeof db, "sageTask"> = db) {
  const tasks = await client.sageTask.findMany({ where: { subjectType: SUGGESTION_TASK_SUBJECT, subjectId: reviewId, status: "OPEN" }, select: { id: true } });
  for (const task of tasks) {
    await client.sageTask.update({ where: { id: task.id }, data: {
      status: "DONE", outcome, leaseUntil: null, events: { create: { eventType: "RESOLVED", detail: outcome } },
    } });
  }
}

/** The wake loop's check for a suggestion follow-up: answered, finished, no longer applicable, or still waiting. */
export async function checkSuggestionReview(task: { id: string; subjectId: string }, now = new Date()): Promise<{ resolved: boolean; outcome?: string; moot?: boolean }> {
  const review = await db.commonsActionReview.findUnique({ where: { id: task.subjectId }, include: { action: true } });
  if (!review) return { resolved: true, moot: true, outcome: "The suggestion was removed" };
  if (review.status !== "PENDING") return { resolved: true, outcome: ANSWERED[review.status] ?? "It was answered" };
  if (review.action.status !== "PENDING") return { resolved: true, moot: true, outcome: "The suggestion is finished" };
  const reason = await suggestionNoLongerApplies(review, review.action, now);
  if (!reason) return { resolved: false };
  await closeSuggestion(review.actionId, reason, "NO_LONGER_APPLIES", { skipTaskId: task.id });
  return { resolved: true, moot: true, outcome: `Closed: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}` };
}

/** The reminder for a suggestion nobody has answered, built from the task - no model call. */
export function suggestionReminderText(title: string): { title: string; body: string } {
  return {
    title: "Sage is still waiting on you",
    body: `"${title.slice(0, 120)}" needs your answer. Sage will close it in ${SUGGESTION_GRACE_DAYS} days if nobody answers.`,
  };
}

/** When a waiting suggestion closes if nobody answers, for the suggestion page. */
export function suggestionClosesAt(review: Pick<CommonsActionReview, "createdAt">, task: { nextWakeAt: Date; attempts: number } | null): Date {
  if (!task) return new Date(review.createdAt.getTime() + SUGGESTION_CLOSE_AFTER_DAYS * DAY_MS);
  return task.attempts > 0 ? task.nextWakeAt : new Date(task.nextWakeAt.getTime() + SUGGESTION_GRACE_DAYS * DAY_MS);
}

/**
 * Each wake cycle: close waiting suggestions that no longer apply, start a follow-up for every new
 * waiting answer, and close ones nobody answered in time whose follow-up is no longer open (the member
 * dismissed it, or it predates this follow-up). Bounded to the oldest SWEEP_BATCH waiting answers.
 */
export async function followUpOnSuggestions(coopId: string, now = new Date()) {
  const reviews: ReviewWithAction[] = await db.commonsActionReview.findMany({
    where: { status: "PENDING", action: { coopId, status: "PENDING" } },
    include: { action: true }, orderBy: { createdAt: "asc" }, take: SWEEP_BATCH,
  });
  if (!reviews.length) return { scheduled: 0, closed: 0 };
  const tasks = await db.sageTask.findMany({
    where: { subjectType: SUGGESTION_TASK_SUBJECT, subjectId: { in: reviews.map((review) => review.id) } },
    select: { subjectId: true, status: true },
  });
  const taskStatus = new Map(tasks.map((task) => [task.subjectId, task.status]));
  const handled = new Set<string>();
  let scheduled = 0;
  let closed = 0;

  for (const review of reviews) {
    if (handled.has(review.actionId)) continue;
    const reason = await suggestionNoLongerApplies(review, review.action, now);
    if (reason) {
      handled.add(review.actionId);
      if (await closeSuggestion(review.actionId, reason, "NO_LONGER_APPLIES")) closed++;
      continue;
    }
    const age = now.getTime() - review.createdAt.getTime();
    const status = taskStatus.get(review.id);
    if (status === "OPEN") continue;
    if (age >= SUGGESTION_CLOSE_AFTER_DAYS * DAY_MS) {
      handled.add(review.actionId);
      if (await closeSuggestion(review.actionId, `Nobody answered within ${SUGGESTION_CLOSE_AFTER_DAYS} days`, "NO_RESPONSE")) closed++;
      continue;
    }
    if (status) continue;
    const dueAt = new Date(Math.max(now.getTime(), review.createdAt.getTime() + SUGGESTION_REMIND_AFTER_DAYS * DAY_MS));
    await db.sageTask.create({ data: {
      coopId, circleId: review.action.circleId, kind: SUGGESTION_TASK_KIND, title: review.action.summary.slice(0, 160),
      reason: `Sage asked for your answer on ${review.createdAt.toISOString().slice(0, 10)}.`,
      expected: "answer Sage's suggestion", ownerUserId: review.userId,
      subjectType: SUGGESTION_TASK_SUBJECT, subjectId: review.id, sourceActionId: review.actionId,
      dueAt, nextWakeAt: dueAt, createdBy: "SYSTEM",
      events: { create: { eventType: "CREATED", detail: "Waiting for an answer to a Sage suggestion" } },
    } });
    scheduled++;
  }
  return { scheduled, closed };
}
