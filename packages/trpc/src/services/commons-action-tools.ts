import type { CommonsAction, CommonsActionParticipant } from "@repo/db";
import { db } from "@repo/db";

import { auditLogEntry } from "../lib/audit.js";
import { ensureSageBotUser } from "../lib/bot.js";
import { generateInviteCode } from "../lib/invite-code.js";
import { createNotificationAndPush } from "./push-notification-service.js";
import { notifySageComment } from "./sage-comment-notifications.js";

interface ToolContext {
  action: CommonsAction;
  participants: CommonsActionParticipant[];
}

interface ToolResult {
  resultEntityType: string;
  resultEntityId: string;
}

/** A policy refusal rather than a transient failure: the action is marked FAILED instead of retried. */
export class ToolRefusal extends Error {}

function generalCircleId(coopId: string): string {
  return `general:${coopId}`;
}

function subjectUserId(ctx: ToolContext): string {
  const subject = ctx.participants.find((participant) => participant.role === "SUBJECT");
  if (!subject) throw new Error("No SUBJECT participant to act on behalf of");
  return subject.userId;
}

function suggestionPayload(ctx: ToolContext): { title: string; body: string; suggestedStartAt?: string; suggestedDurationMinutes?: number; targetPostId?: string } {
  const payload = ctx.action.payload as { title?: unknown; body?: unknown; suggestedStartAt?: unknown; suggestedDurationMinutes?: unknown; targetPostId?: unknown } | null;
  return {
    title: typeof payload?.title === "string" ? payload.title : ctx.action.summary,
    body: typeof payload?.body === "string" ? payload.body : ctx.action.summary,
    suggestedStartAt: typeof payload?.suggestedStartAt === "string" ? payload.suggestedStartAt : undefined,
    suggestedDurationMinutes: typeof payload?.suggestedDurationMinutes === "number" ? payload.suggestedDurationMinutes : undefined,
    targetPostId: typeof payload?.targetPostId === "string" ? payload.targetPostId : undefined,
  };
}

/** Mirrors events.ts's create mutation (packages/trpc/src/routers/events.ts), executed as the approving member. */
async function createEvent(ctx: ToolContext): Promise<ToolResult> {
  const authorId = subjectUserId(ctx);
  const { title, body, suggestedStartAt, suggestedDurationMinutes } = suggestionPayload(ctx);
  const startAt = suggestedStartAt ? new Date(suggestedStartAt) : new Date(Date.now() + 7 * 86400000);
  const durationMinutes = suggestedDurationMinutes && suggestedDurationMinutes > 0 ? suggestedDurationMinutes : 60;
  const endAt = new Date(startAt.getTime() + durationMinutes * 60000);
  const circleId = ctx.action.circleId ?? generalCircleId(ctx.action.coopId);

  const post = await db.commonsPost.create({
    data: {
      coopId: ctx.action.coopId, circleId, authorId,
      title: title.slice(0, 120), content: body.slice(0, 5000),
      tag: "Event", classification: "event", classificationConfidence: 0.9,
      classificationSignals: { version: 1, source: "sage_trend_suggestion" },
      event: {
        create: {
          coopId: ctx.action.coopId, circleId, startAt, endAt, isOnline: true,
          createdById: authorId,
          hosts: { create: { userId: authorId } },
          rsvps: { create: { userId: authorId, status: "GOING" } },
        },
      },
    },
  });
  return { resultEntityType: "CommonsPost", resultEntityId: post.id };
}

/** Mirrors commons.ts's createPost mutation, but posted from Sage's own account rather than the
 * approving member's - this is Sage sharing something it noticed, not the member speaking themselves. */
async function createPost(ctx: ToolContext, circleId: string): Promise<ToolResult> {
  const sage = await ensureSageBotUser(db, ctx.action.coopId);
  const { title, body } = suggestionPayload(ctx);
  const post = await db.commonsPost.create({
    data: {
      coopId: ctx.action.coopId, circleId, authorId: sage.id,
      title: title.slice(0, 120), content: body.slice(0, 5000),
      tag: "Idea", classification: "sage_suggestion", classificationConfidence: 0.9,
      classificationSignals: { version: 1, source: "sage_trend_suggestion" },
    },
  });
  return { resultEntityType: "CommonsPost", resultEntityId: post.id };
}

async function createCirclePost(ctx: ToolContext): Promise<ToolResult> {
  const circleId = ctx.action.circleId ?? generalCircleId(ctx.action.coopId);
  return createPost(ctx, circleId);
}

async function createCommonsPost(ctx: ToolContext): Promise<ToolResult> {
  return createPost(ctx, generalCircleId(ctx.action.coopId));
}

/** A Sage-authored comment on one post in the suggestion's own Commons and circle. Re-checks scope at
 * execution time rather than trusting the stored payload, and keeps Sage to one comment per post. */
async function commentOnPost(ctx: ToolContext): Promise<ToolResult> {
  const { body, targetPostId } = suggestionPayload(ctx);
  if (!targetPostId) throw new ToolRefusal("No target post for this comment");
  const post = await db.commonsPost.findUnique({ where: { id: targetPostId }, select: { id: true, coopId: true, circleId: true } });
  const circleId = ctx.action.circleId ?? generalCircleId(ctx.action.coopId);
  if (!post || post.coopId !== ctx.action.coopId || (post.circleId ?? generalCircleId(post.coopId)) !== circleId) {
    throw new ToolRefusal("Target post is outside this suggestion's Commons and circle");
  }
  const sage = await ensureSageBotUser(db, ctx.action.coopId);
  const prior = await db.commonsComment.findFirst({ where: { postId: post.id, authorId: sage.id }, select: { id: true } });
  if (prior) throw new ToolRefusal("Sage has already commented on this post");
  const comment = await db.commonsComment.create({
    data: { postId: post.id, authorId: sage.id, content: body.slice(0, 2000) },
  });
  await notifySageComment({ postId: post.id, commentId: comment.id });
  return { resultEntityType: "CommonsComment", resultEntityId: comment.id };
}

/**
 * Publishes a Sage comment without a review, for a suggestion that passed the autonomous-comment
 * policy (confidence and the Commons' Auto-reply switch, checked by the caller). The same scope and
 * one-per-post checks as an approved comment apply. The comment is recorded like an auto-reply, so
 * a platform admin can remove it, and replySourceKey keeps Sage to one comment per post across both
 * the Commons action agent and circle suggestions.
 */
export async function publishSageCommentAutonomously(actionId: string): Promise<{ published: boolean; reason?: string }> {
  const action = await db.commonsAction.findUnique({ where: { id: actionId } });
  if (!action || action.status !== "PENDING") return { published: false, reason: "The suggestion was no longer pending" };
  const participants = await db.commonsActionParticipant.findMany({ where: { actionId } });
  try {
    const result = await commentOnPost({ action, participants });
    const { targetPostId } = suggestionPayload({ action, participants });
    try {
      await db.commonsAction.update({ where: { id: action.id }, data: {
        status: "PUBLISHED", publishedCommentId: result.resultEntityId, replySourceKey: `commons_post:${targetPostId}`,
      } });
    } catch (error) {
      // Another Sage path claimed this post concurrently (unique replySourceKey): withdraw ours.
      await db.commonsComment.delete({ where: { id: result.resultEntityId } });
      if ((error as { code?: string }).code === "P2002") throw new ToolRefusal("Sage has already commented on this post");
      throw error;
    }
    await db.commonsActionAudit.create({ data: { actionId: action.id, eventType: "AUTO_PUBLISHED", metadata: { ...result } } });
    return { published: true };
  } catch (error) {
    if (!(error instanceof ToolRefusal)) throw error;
    await db.commonsAction.update({ where: { id: action.id }, data: { status: "FAILED" } });
    await db.commonsActionAudit.create({ data: { actionId: action.id, eventType: "ACTION_REFUSED", metadata: { reason: error.message } } });
    return { published: false, reason: error.message };
  }
}

/** An editable organization-proposal draft owned by the approving member. It is never submitted here:
 * the member edits it and submits it through the normal proposal flow, or leaves it as a draft. */
async function draftProposal(ctx: ToolContext): Promise<ToolResult> {
  const authorId = subjectUserId(ctx);
  const { title, body } = suggestionPayload(ctx);
  const draft = await db.commonsProposalDraft.upsert({
    where: { actionId: ctx.action.id },
    create: { actionId: ctx.action.id, coopId: ctx.action.coopId, authorId, title: title.slice(0, 160), body: body.slice(0, 10_000) },
    update: {},
  });
  await createNotificationAndPush(db, {
    userId: authorId, coopId: ctx.action.coopId, type: "PROPOSAL_DRAFT_READY",
    title: "A proposal draft is ready", body: "Sage drafted this from your circle. Edit it before you submit it.",
    data: { draftId: draft.id, coopId: ctx.action.coopId },
  }).catch((error) => console.error("Could not notify proposal draft owner", error));
  return { resultEntityType: "CommonsProposalDraft", resultEntityId: draft.id };
}

/** Mirrors groupsRouter.create's transaction (packages/trpc/src/routers/groups.ts), but seeds every named participant as a member instead of just the caller. */
async function createPrivateCircle(ctx: ToolContext): Promise<ToolResult> {
  const participantIds = [...new Set(ctx.participants.map((participant) => participant.userId))];
  if (participantIds.length < 2) throw new Error("A private circle needs at least two participants");

  let inviteCode = generateInviteCode();
  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await db.group.findUnique({ where: { inviteCode } });
    if (!existing) break;
    inviteCode = generateInviteCode();
  }

  const group = await db.$transaction(async (tx) => {
    const created = await tx.group.create({
      data: {
        coopId: ctx.action.coopId,
        name: "Ride match",
        purpose: ctx.action.summary.slice(0, 500),
        privacy: "private",
        inviteCode,
        leaderId: participantIds[0],
      },
    });
    for (const userId of participantIds) {
      await tx.groupMember.create({ data: { groupId: created.id, userId } });
    }
    await tx.auditLog.create({
      data: auditLogEntry({
        actorId: "system/sage",
        action: "GROUP_CREATED",
        resource: "Group",
        resourceId: created.id,
        metadata: { source: "sage-ride-match", actionId: ctx.action.id },
      }),
    });
    return created;
  });

  return { resultEntityType: "Group", resultEntityId: group.id };
}

const TOOL_REGISTRY: Record<string, (ctx: ToolContext) => Promise<ToolResult>> = {
  create_private_circle: createPrivateCircle,
  create_event: createEvent,
  create_circle_post: createCirclePost,
  create_commons_post: createCommonsPost,
  comment_on_post: commentOnPost,
  draft_proposal: draftProposal,
};

// Tools whose result announces itself: Sage-authored posts and comments are visible in the feed, and a
// proposal draft sends its own "draft is ready" alert. A generic "your suggestion is done" alert on top
// of those would be redundant noise.
const SELF_ANNOUNCING_TOOL_KEYS = new Set(["create_circle_post", "create_commons_post", "comment_on_post", "draft_proposal"]);

const TOOL_KEY_BY_ACTION_TYPE: Partial<Record<CommonsAction["type"], string>> = {
  RIDE_MATCH_PROPOSAL: "create_private_circle",
};

// The reviewType whose approval actually authorizes execution, per action type. SUGGEST_ACTION resolves
// its tool from payload.capability instead of a fixed type mapping - see resolveToolKey().
export const FINAL_REVIEW_TYPE_BY_ACTION_TYPE: Partial<Record<CommonsAction["type"], string>> = {
  RIDE_MATCH_PROPOSAL: "ACCEPT_MATCH",
  SUGGEST_ACTION: "APPROVE_SUGGESTION",
};

/** Open vocabulary for SUGGEST_ACTION: the model names any capability it thinks fits in payload.capability,
 * so anything not in TOOL_REGISTRY naturally falls through to the MISSING_TOOL path below. */
function resolveToolKey(action: CommonsAction): string | undefined {
  if (action.type === "SUGGEST_ACTION") {
    const capability = (action.payload as { capability?: unknown } | null)?.capability;
    return typeof capability === "string" ? capability : undefined;
  }
  return TOOL_KEY_BY_ACTION_TYPE[action.type];
}

/** Re-verifies approval/idempotency from scratch, then executes the action's tool. Safe to call more than once. */
export async function executeSageAction(actionId: string): Promise<void> {
  const action = await db.commonsAction.findUnique({ where: { id: actionId } });
  if (!action || action.status !== "PENDING") return; // already executed, dismissed, or failed

  const participants = await db.commonsActionParticipant.findMany({ where: { actionId } });
  const finalReviewType = FINAL_REVIEW_TYPE_BY_ACTION_TYPE[action.type];
  const finalReview = finalReviewType
    ? await db.commonsActionReview.findFirst({ where: { actionId, reviewType: finalReviewType, status: "APPROVED" } })
    : null;
  if (!finalReview || finalReview.payloadHash !== action.payloadHash) return; // not yet approved, or a stale revision

  const toolKey = resolveToolKey(action);
  const tool = toolKey ? TOOL_REGISTRY[toolKey] : undefined;
  if (!tool) {
    await db.commonsAction.update({ where: { id: action.id }, data: { status: "FAILED" } });
    await db.commonsActionAudit.create({
      data: { actionId: action.id, eventType: "MISSING_TOOL", metadata: { toolKey: toolKey ?? "unknown" } },
    });
    return;
  }

  try {
    const result = await tool({ action, participants });
    await db.commonsAction.update({ where: { id: action.id }, data: { status: "APPROVED", reviewedAt: new Date() } });
    await db.commonsActionAudit.create({ data: { actionId: action.id, eventType: "ACTION_EXECUTED", metadata: { ...result } } });
    if (!SELF_ANNOUNCING_TOOL_KEYS.has(toolKey!)) {
      await Promise.all(participants.map((participant) =>
        createNotificationAndPush(db, {
          userId: participant.userId, coopId: action.coopId, type: "SAGE_SUGGESTION_DONE",
          title: "Your Sage suggestion is done", body: action.summary.slice(0, 200),
          data: { actionId: action.id, resultEntityType: result.resultEntityType, resultEntityId: result.resultEntityId },
        }).catch((error) => console.error("Could not notify Sage participant", error)),
      ));
    }
  } catch (error) {
    if (error instanceof ToolRefusal) {
      await db.commonsAction.update({ where: { id: action.id }, data: { status: "FAILED" } });
      await db.commonsActionAudit.create({ data: { actionId: action.id, eventType: "ACTION_REFUSED", metadata: { reason: error.message } } });
      return;
    }
    await db.commonsActionAudit.create({
      data: { actionId: action.id, eventType: "ACTION_FAILED", metadata: { error: error instanceof Error ? error.message : String(error) } },
    });
    throw error;
  }
}
