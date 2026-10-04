import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { AccountAuthenticatedContext } from "../context.js";
import { accountAuthenticatedProcedure } from "../procedures/account-authenticated.js";
import { payloadHash } from "../services/sage-ride-match-agent.js";
import { findRideMatchCandidate } from "../services/sage-ride-matcher.js";
import { enqueueSageActionExecute } from "../services/sage-dispatch.js";
import { createNotificationAndPush } from "../services/push-notification-service.js";
import { describeSageAuditEvent } from "../services/sage-audit-descriptions.js";
import { presentTrails } from "../services/sage-decision-trail.js";
import { dismissSageTask } from "../services/sage-tasks.js";
import { acknowledgeSageAlert, rerouteSageAlert } from "../services/sage-responsibility.js";
import { router } from "../trpc.js";

const TERMINAL_STATUSES = ["APPROVED", "DISMISSED", "FAILED"] as const;
const TabZ = z.enum(["NEEDS_YOU", "WAITING", "DONE"]);

function conflict(message: string): never {
  throw new TRPCError({ code: "CONFLICT", message });
}

const CONTEXT_MESSAGE_LIMIT = 30;

function authorName(author: { name: string | null; handle: string | null }) {
  return author.name || (author.handle ? `@${author.handle}` : "A member");
}

/**
 * Where a circle suggestion came from: the circle, the post Sage would reply to, and the conversation
 * window Sage read. Only returned to a viewer who is still a member of that circle, so a suggestion
 * never reveals a private circle's conversation to anyone outside it.
 */
async function loadCircleSuggestionContext(
  db: AccountAuthenticatedContext["db"],
  action: { sourceType: string; sourceId: string; circleId: string | null; coopId: string; payload: unknown },
  userId: string,
) {
  if (action.sourceType !== "circle_trend" || !action.circleId) return null;
  const membership = await db.groupMember.findUnique({
    where: { groupId_userId: { groupId: action.circleId, userId } },
    select: { group: { select: { id: true, name: true, coopId: true } } },
  });
  if (!membership || membership.group.coopId !== action.coopId) return null;

  const targetPostId = (action.payload as { targetPostId?: unknown } | null)?.targetPostId;
  const [window, targetPost] = await Promise.all([
    db.circleAgentWindow.findUnique({ where: { id: action.sourceId }, select: { groupId: true, openedAt: true, closedAt: true, lastMessageAt: true } }),
    typeof targetPostId === "string"
      ? db.commonsPost.findFirst({
          where: { id: targetPostId, coopId: action.coopId, circleId: action.circleId },
          select: { id: true, title: true, content: true, createdAt: true, author: { select: { name: true, handle: true } } },
        })
      : Promise.resolve(null),
  ]);

  let conversation: Array<{ author: string; content: string; createdAt: string }> = [];
  if (window && window.groupId === action.circleId) {
    const range = { gte: window.openedAt, lte: window.closedAt ?? window.lastMessageAt };
    const [messages, posts, postComments] = await Promise.all([
      db.groupComment.findMany({
        where: { groupId: action.circleId, createdAt: range },
        orderBy: { createdAt: "desc" }, take: CONTEXT_MESSAGE_LIMIT,
        select: { content: true, createdAt: true, author: { select: { name: true, handle: true } } },
      }),
      // Circle chat messages are mirrored into the feed as "circle:<id>" posts; skip the mirrors.
      db.commonsPost.findMany({
        where: { circleId: action.circleId, createdAt: range, NOT: { id: { startsWith: "circle:" } } },
        orderBy: { createdAt: "desc" }, take: CONTEXT_MESSAGE_LIMIT,
        select: { title: true, content: true, createdAt: true, author: { select: { name: true, handle: true } } },
      }),
      db.commonsComment.findMany({
        where: { post: { circleId: action.circleId }, createdAt: range },
        orderBy: { createdAt: "desc" }, take: CONTEXT_MESSAGE_LIMIT,
        select: { content: true, createdAt: true, author: { select: { name: true, handle: true } } },
      }),
    ]);
    conversation = [
      ...messages.map((message) => ({ author: authorName(message.author), content: message.content, createdAt: message.createdAt })),
      ...posts.map((post) => ({
        author: authorName(post.author),
        content: post.title && !post.content.startsWith(post.title) ? `${post.title}: ${post.content}` : post.content,
        createdAt: post.createdAt,
      })),
      ...postComments.map((comment) => ({ author: authorName(comment.author), content: comment.content, createdAt: comment.createdAt })),
    ]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(-CONTEXT_MESSAGE_LIMIT)
      .map((entry) => ({ ...entry, content: entry.content.slice(0, 1000), createdAt: entry.createdAt.toISOString() }));
  }

  return {
    circle: { id: membership.group.id, name: membership.group.name },
    targetPost: targetPost ? {
      id: targetPost.id, title: targetPost.title, content: targetPost.content.slice(0, 2000),
      author: authorName(targetPost.author), createdAt: targetPost.createdAt.toISOString(),
    } : null,
    conversation,
  };
}

const TRAIL_LIMIT = 10;

/**
 * Decision trails a member may see for a post or a suggestion: never admin-only trails (ride matches),
 * Commons-feed trails only for active members of that Commons, circle trails only for members of that
 * circle. Content that has since been deleted is not shown.
 */
async function memberVisibleTrails(
  db: AccountAuthenticatedContext["db"],
  userId: string,
  filter: { postId?: string; actionId?: string; proposalId?: string; circleId?: string },
) {
  const rows = await db.sageDecisionTrail.findMany({
    where: {
      visibility: { not: "ADMINS" },
      ...(filter.postId ? { relatedPostIds: { has: filter.postId } } : {}),
      ...(filter.actionId ? { actionIds: { has: filter.actionId } } : {}),
      ...(filter.proposalId ? { proposalId: filter.proposalId } : {}),
      ...(filter.circleId ? { circleId: filter.circleId } : {}),
    },
    orderBy: { createdAt: "desc" }, take: TRAIL_LIMIT,
  });
  if (!rows.length) return [];
  const coopIds = [...new Set(rows.map((row) => row.coopId))];
  const circleIds = [...new Set(rows.flatMap((row) => (row.circleId ? [row.circleId] : [])))];
  const [memberships, circleMemberships] = await Promise.all([
    db.userCoopMembership.findMany({ where: { userId, coopId: { in: coopIds }, status: "ACTIVE" }, select: { coopId: true } }),
    circleIds.length
      ? db.groupMember.findMany({ where: { userId, groupId: { in: circleIds } }, select: { groupId: true, group: { select: { coopId: true } } } })
      : Promise.resolve([]),
  ]);
  const activeCoops = new Set(memberships.map((membership) => membership.coopId));
  const visible = rows.filter((row) => {
    if (row.visibility === "COMMONS_MEMBERS") return activeCoops.has(row.coopId);
    if (row.visibility === "CIRCLE") return circleMemberships.some((membership) => membership.groupId === row.circleId && membership.group.coopId === row.coopId);
    return false;
  });
  const postSources = visible.filter((row) => row.sourceType === "commons_post").map((row) => row.sourceId);
  const commentSources = visible.filter((row) => row.sourceType === "commons_comment").map((row) => row.sourceId);
  const [livePosts, liveComments] = await Promise.all([
    postSources.length ? db.commonsPost.findMany({ where: { id: { in: postSources } }, select: { id: true } }) : Promise.resolve([]),
    commentSources.length ? db.commonsComment.findMany({ where: { id: { in: commentSources } }, select: { id: true } }) : Promise.resolve([]),
  ]);
  const live = new Set([...livePosts, ...liveComments].map((row) => row.id));
  const presented = await presentTrails(visible, { forAdmin: false }, db);
  return presented.map((trail) => (trail.sourceType === "commons_post" || trail.sourceType === "commons_comment") && !live.has(trail.sourceId)
    ? { ...trail, observed: { content: "This content was deleted." } }
    : trail);
}

export const sageRouter = router({
  /** The member's personal "Show Sage decision trails" app setting. */
  trailSettings: accountAuthenticatedProcedure.query(async ({ ctx }) => {
    const context = ctx as AccountAuthenticatedContext;
    const user = await context.db.user.findUnique({ where: { id: context.accountUser.id }, select: { showSageDecisionTrails: true } });
    return { showSageDecisionTrails: user?.showSageDecisionTrails ?? false };
  }),

  setTrailSettings: accountAuthenticatedProcedure
    .input(z.object({ showSageDecisionTrails: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      const user = await context.db.user.update({
        where: { id: context.accountUser.id },
        data: { showSageDecisionTrails: input.showSageDecisionTrails },
        select: { showSageDecisionTrails: true },
      });
      return { showSageDecisionTrails: user.showSageDecisionTrails };
    }),

  /**
   * Decision trails for one subject, if the member turned them on: a post (and its comments), a Sage
   * suggestion, a proposal (its reviews and comment evaluations), or a circle or direct message.
   */
  listTrails: accountAuthenticatedProcedure
    .input(z.object({
      postId: z.string().min(1).optional(), actionId: z.string().min(1).optional(),
      proposalId: z.string().min(1).optional(), circleId: z.string().min(1).optional(),
    }).refine((input) => [input.postId, input.actionId, input.proposalId, input.circleId].filter(Boolean).length === 1,
      { message: "Pass exactly one of postId, actionId, proposalId or circleId" }))
    .query(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      const user = await context.db.user.findUnique({ where: { id: context.accountUser.id }, select: { showSageDecisionTrails: true } });
      if (!user?.showSageDecisionTrails) return { enabled: false, trails: [] };
      return { enabled: true, trails: await memberVisibleTrails(context.db, context.accountUser.id, input) };
    }),

  // Called when the member opens the Sage suggestions list, so the Alerts tab's
  // unread dot clears without requiring them to separately open each notification.
  /** What Sage is following up on with this member: their open tasks, newest due first, plus recent closed ones. */
  listTasks: accountAuthenticatedProcedure
    .input(z.object({ coopId: z.string().min(1).default("cahootz") }))
    .query(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      const userId = context.accountUser.id;
      const [open, closed] = await Promise.all([
        context.db.sageTask.findMany({
          where: { coopId: input.coopId, ownerUserId: userId, status: "OPEN" },
          orderBy: { nextWakeAt: "asc" }, take: 50,
        }),
        context.db.sageTask.findMany({
          where: { coopId: input.coopId, ownerUserId: userId, status: { in: ["DONE", "DISMISSED", "ABANDONED"] }, updatedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
          orderBy: { updatedAt: "desc" }, take: 20,
        }),
      ]);
      const view = (task: (typeof open)[number]) => ({
        id: task.id, kind: task.kind, status: task.status, title: task.title, reason: task.reason,
        expected: task.expected, offer: task.offer, postId: task.postId, subjectType: task.subjectType, subjectId: task.subjectId,
        nextWakeAt: task.nextWakeAt.toISOString(), attempts: task.attempts, outcome: task.outcome, updatedAt: task.updatedAt.toISOString(),
      });
      return { open: open.map(view), closed: closed.map(view) };
    }),

  /** The member says they don't need Sage to follow this; Sage won't recreate it for 30 days. */
  dismissTask: accountAuthenticatedProcedure
    .input(z.object({ taskId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      if (!(await dismissSageTask(input.taskId, context.accountUser.id))) {
        throw new TRPCError({ code: "NOT_FOUND", message: "This follow-up is no longer open." });
      }
      return { dismissed: true };
    }),

  /** A routed alert, for its recipient: what happened, the evidence, why them, and what's recommended. */
  getAlert: accountAuthenticatedProcedure
    .input(z.object({ alertId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      const alert = await context.db.sageAlert.findUnique({ where: { id: input.alertId } });
      if (!alert || alert.recipientUserId !== context.accountUser.id) throw new TRPCError({ code: "NOT_FOUND", message: "Alert not found" });
      return {
        id: alert.id, coopId: alert.coopId, category: alert.category, severity: alert.severity, title: alert.title, body: alert.body,
        evidence: alert.evidence as { source: string; quote?: string; why: string; recommendation: string },
        postId: alert.postId, status: alert.status, dueAt: alert.dueAt?.toISOString() ?? null, expiresAt: alert.expiresAt.toISOString(),
        createdAt: alert.createdAt.toISOString(),
      };
    }),

  acknowledgeAlert: accountAuthenticatedProcedure
    .input(z.object({ alertId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      return { acknowledged: await acknowledgeSageAlert(input.alertId, context.accountUser.id) };
    }),

  /** "Not for me": sends the alert to the next responsible person and remembers the answer. */
  alertNotForMe: accountAuthenticatedProcedure
    .input(z.object({ alertId: z.string().min(1), feedback: z.string().trim().max(500).optional() }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      const result = await rerouteSageAlert(input.alertId, context.accountUser.id, input.feedback ?? null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "This alert can no longer be passed on." });
      return { rerouted: true, to: result.status === "ROUTED" ? result.category : null };
    }),

  markSeen: accountAuthenticatedProcedure.mutation(async ({ ctx }) => {
    const context = ctx as AccountAuthenticatedContext;
    const result = await context.db.notification.updateMany({
      where: { userId: context.accountUser.id, read: false, type: { startsWith: "SAGE_SUGGESTION_" } },
      data: { read: true },
    });
    return { success: true, count: result.count };
  }),

  list: accountAuthenticatedProcedure
    .input(z.object({ coopId: z.string().min(1).default("cahootz"), tab: TabZ, cursor: z.string().optional() }))
    .query(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      const userId = context.accountUser.id;
      const base = { coopId: input.coopId, participants: { some: { userId } } };
      const where = input.tab === "NEEDS_YOU"
        ? { ...base, reviews: { some: { userId, status: "PENDING" } } }
        : input.tab === "DONE"
          ? { ...base, status: { in: [...TERMINAL_STATUSES] } }
          : { ...base, status: { notIn: [...TERMINAL_STATUSES] }, NOT: { reviews: { some: { userId, status: "PENDING" } } } };

      const actions = await context.db.commonsAction.findMany({
        where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 21,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      });
      const nextCursor = actions.length > 20 ? actions[20]!.id : null;
      const page = actions.slice(0, 20);

      return {
        suggestions: page.map((action) => ({
          id: action.id, type: action.type, title: action.summary, circleId: action.circleId,
          status: action.status, createdAt: action.createdAt.toISOString(),
        })),
        nextCursor,
      };
    }),

  getDetail: accountAuthenticatedProcedure
    .input(z.object({ actionId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      const userId = context.accountUser.id;
      const action = await context.db.commonsAction.findUnique({ where: { id: input.actionId } });
      if (!action) throw new TRPCError({ code: "NOT_FOUND", message: "Suggestion not found" });
      const participant = await context.db.commonsActionParticipant.findUnique({
        where: { actionId_userId: { actionId: action.id, userId } },
      });
      if (!participant) throw new TRPCError({ code: "FORBIDDEN", message: "Not part of this suggestion" });

      const [myReviews, auditEvents, context_] = await Promise.all([
        context.db.commonsActionReview.findMany({ where: { actionId: action.id, userId }, orderBy: { createdAt: "asc" } }),
        context.db.commonsActionAudit.findMany({ where: { actionId: action.id }, orderBy: { createdAt: "asc" }, select: { eventType: true, metadata: true, createdAt: true } }),
        loadCircleSuggestionContext(context.db, action, userId),
      ]);

      const payload = action.payload as { capability?: unknown; body?: unknown } | null;
      const suggestionReview = myReviews.find((review) => review.reviewType === "APPROVE_SUGGESTION");
      const reason = (suggestionReview?.presentationData as { reason?: unknown } | null)?.reason
        ?? (action.type === "SUGGEST_ACTION" ? action.evidence : null);
      const resultEvent = [...auditEvents].reverse().find((event) => event.eventType === "ACTION_EXECUTED");
      const result = resultEvent?.metadata as { resultEntityType?: unknown; resultEntityId?: unknown } | null;
      return {
        suggestion: {
          id: action.id, coopId: action.coopId, title: action.summary, status: action.status, circleId: action.circleId,
          capability: action.type === "SUGGEST_ACTION" && typeof payload?.capability === "string" ? payload.capability : null,
          proposedText: action.type === "SUGGEST_ACTION" && typeof payload?.body === "string" ? payload.body : null,
          // Sage's stated reason stays visible after the review is answered.
          reason: typeof reason === "string" ? reason : null,
          result: typeof result?.resultEntityType === "string" && typeof result.resultEntityId === "string"
            ? { entityType: result.resultEntityType, entityId: result.resultEntityId } : null,
          // The subject's own raw message excerpt is only shown to the subject, never to a helper/candidate.
          evidence: participant.role === "SUBJECT" ? action.sourceTextSnapshot : null,
          role: participant.role,
        },
        context: context_,
        reviews: myReviews.map((review) => ({
          id: review.id, reviewType: review.reviewType, status: review.status,
          presentationData: review.presentationData, payloadHash: review.payloadHash,
        })),
        auditEvents: auditEvents.map((event) => ({
          description: describeSageAuditEvent(event.eventType, event.metadata),
          createdAt: event.createdAt.toISOString(),
        })),
      };
    }),

  respondToReview: accountAuthenticatedProcedure
    .input(z.object({
      reviewId: z.string().min(1),
      response: z.enum(["APPROVE", "DECLINE", "ESCALATE"]),
      payload: z.record(z.unknown()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      const userId = context.accountUser.id;
      const review = await context.db.commonsActionReview.findUnique({ where: { id: input.reviewId } });
      if (!review || review.userId !== userId) throw new TRPCError({ code: "NOT_FOUND", message: "Review not found" });
      if (review.status !== "PENDING") conflict("This review has already been answered");
      const action = await context.db.commonsAction.findUnique({ where: { id: review.actionId } });
      if (!action) throw new TRPCError({ code: "NOT_FOUND", message: "Suggestion not found" });
      if (review.payloadHash !== action.payloadHash) {
        await context.db.commonsActionReview.update({ where: { id: review.id }, data: { status: "SUPERSEDED" } });
        conflict("This suggestion changed since you were asked — refresh to see the current version");
      }

      if (input.response === "DECLINE") {
        await context.db.$transaction([
          context.db.commonsActionReview.update({ where: { id: review.id }, data: { status: "DECLINED", respondedAt: new Date() } }),
          context.db.commonsAction.update({ where: { id: action.id }, data: { status: "DISMISSED" } }),
          context.db.commonsActionAudit.create({ data: { actionId: action.id, actorId: userId, eventType: "REVIEW_DECLINED", metadata: { reviewType: review.reviewType } } }),
        ]);
        return { success: true };
      }

      // Generic across every reviewType and action type - not terminal, so an admin can still resolve it.
      if (input.response === "ESCALATE") {
        await context.db.$transaction([
          context.db.commonsActionReview.update({ where: { id: review.id }, data: { status: "ESCALATED", respondedAt: new Date() } }),
          context.db.commonsActionAudit.create({ data: { actionId: action.id, actorId: userId, eventType: "ESCALATED_TO_ADMIN", metadata: { reviewType: review.reviewType } } }),
        ]);
        return { success: true };
      }

      await context.db.commonsActionReview.update({ where: { id: review.id }, data: { status: "APPROVED", respondedAt: new Date() } });
      await context.db.commonsActionAudit.create({ data: { actionId: action.id, actorId: userId, eventType: "REVIEW_APPROVED", metadata: { reviewType: review.reviewType } } });

      if (review.reviewType === "PROVIDE_CONTEXT") {
        const newPayload = { area: String(input.payload?.area ?? ""), timeWindow: String(input.payload?.timeWindow ?? ""), shareScope: String(input.payload?.shareScope ?? "") };
        const newHash = payloadHash(newPayload);
        await context.db.commonsAction.update({ where: { id: action.id }, data: { payload: newPayload, payloadHash: newHash, revision: { increment: 1 } } });
        const candidate = await findRideMatchCandidate(action);
        if (candidate) {
          await context.db.commonsActionParticipant.upsert({
            where: { actionId_userId: { actionId: action.id, userId: candidate.candidateUserId } },
            create: { actionId: action.id, userId: candidate.candidateUserId, role: "HELPER" },
            update: {},
          });
          await context.db.commonsActionReview.create({
            data: {
              actionId: action.id, userId: action.sourceAuthorId, reviewType: "CONSENT_TO_SHARE",
              payloadHash: newHash, status: "PENDING",
              presentationData: { message: "Sage found a possible match. Confirm what you're comfortable sharing." },
            },
          });
          await createNotificationAndPush(context.db, {
            userId: action.sourceAuthorId, coopId: action.coopId, type: "SAGE_SUGGESTION_NEEDS_YOU",
            title: "Sage has a suggestion for you", body: "Sage found a possible match - confirm what you're comfortable sharing.",
            data: { actionId: action.id },
          }).catch((error) => console.error("Could not notify Sage suggestion subject", error));
        }
      } else if (review.reviewType === "CONSENT_TO_SHARE") {
        const helper = await context.db.commonsActionParticipant.findFirst({ where: { actionId: action.id, role: "HELPER" } });
        if (helper) {
          await context.db.commonsActionReview.create({
            data: {
              actionId: action.id, userId: helper.userId, reviewType: "ACCEPT_MATCH",
              payloadHash: action.payloadHash!, status: "PENDING",
              presentationData: { message: "A circle member could use a ride matching what you offered. Interested?" },
            },
          });
          await createNotificationAndPush(context.db, {
            userId: helper.userId, coopId: action.coopId, type: "SAGE_SUGGESTION_NEEDS_YOU",
            title: "Sage has a suggestion for you", body: "A circle member could use your help - take a look.",
            data: { actionId: action.id },
          }).catch((error) => console.error("Could not notify Sage suggestion helper", error));
        }
      } else if (review.reviewType === "ACCEPT_MATCH" || review.reviewType === "APPROVE_SUGGESTION") {
        await enqueueSageActionExecute(action.id, action.revision);
      }

      return { success: true };
    }),
});
