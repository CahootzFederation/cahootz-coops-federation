import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { commonsPlatformAdminProcedure } from "../procedures/commons-platform-admin.js";
import { charterSnapshotKey, hasExactGrounding, REPLY_ACTIONS, scanCommons } from "../services/commons-action-agent.js";
import { needsCharterGrounding } from "../services/sage-grounding.js";
import { ingestDocument } from "../services/knowledge-base.js";
import { createNotificationAndPush } from "../services/push-notification-service.js";
import { FINAL_REVIEW_TYPE_BY_ACTION_TYPE } from "../services/commons-action-tools.js";
import { closeCircleWindowNow } from "../services/circle-window.js";
import { presentTrails } from "../services/sage-decision-trail.js";
import { runSageWakeCycle } from "../services/sage-tasks.js";
import { wakeCycleWork } from "../services/sage-wake-work.js";
import { getSageAutonomyUsage } from "../services/sage-autonomy.js";
import { notifySageComment } from "../services/sage-comment-notifications.js";
import { enqueueSageActionExecute } from "../services/sage-dispatch.js";
import { router } from "../trpc.js";

const Scoped = z.object({ coopId: z.string().min(1) });
const FeedbackReasons = z.enum(["WRONG_ACTION", "INCORRECT_CHARTER_USE", "INACCURATE", "MISSED_CONTEXT", "TONE", "UNCLEAR", "OTHER"]);
const Command = z.discriminatedUnion("command", [
  Scoped.extend({ command: z.literal("auto-reply"), enabled: z.boolean() }),
  Scoped.extend({ command: z.literal("autonomy-limits"),
    monthlyUsdLimit: z.number().min(0).max(10_000).multipleOf(0.01),
    monthlyCallLimit: z.number().int().min(0).max(1_000_000) }),
  Scoped.extend({ command: z.literal("scan") }),
  Scoped.extend({ command: z.literal("analyze-circle"), groupId: z.string().min(1) }),
  Scoped.extend({ command: z.literal("wake") }),
  Scoped.extend({ command: z.literal("dismiss"), actionId: z.string().min(1) }),
  Scoped.extend({ command: z.literal("edit-draft"), actionId: z.string().min(1), draftText: z.string().trim().max(2000) }),
  Scoped.extend({ command: z.literal("approve"), actionId: z.string().min(1) }),
  Scoped.extend({ command: z.literal("remove-reply"), actionId: z.string().min(1) }),
  Scoped.extend({ command: z.literal("publish-resource"), resourceId: z.string().min(1) }),
  Scoped.extend({ command: z.literal("rate-response"), actionId: z.string().min(1),
    rating: z.enum(["GOOD", "NEEDS_WORK"]), reasons: z.array(FeedbackReasons).max(7),
    notes: z.string().trim().max(2000), correctedText: z.string().trim().max(10000) }),
]);

function conflict(message: string): never {
  throw new TRPCError({ code: "CONFLICT", message });
}

export const commonsActionsAdminRouter = router({
  dashboard: commonsPlatformAdminProcedure.input(Scoped.extend({ trailAgent: z.string().max(40).optional() })).query(async ({ ctx, input }) => {
    const config = await ctx.db.coopConfig.findFirst({ where: { coopId: input.coopId, isActive: true }, select: { id: true } });
    if (!config) throw new TRPCError({ code: "NOT_FOUND", message: "Commons not found" });
    const [setting, actions, resources, costEvents, monthlyCosts, autonomy, circles, skippedRepeats, trailRows] = await Promise.all([
      ctx.db.commonsAgentSetting.findUnique({ where: { coopId: input.coopId } }),
      ctx.db.commonsAction.findMany({ where: { coopId: input.coopId }, orderBy: { createdAt: "desc" }, take: 150 }),
      ctx.db.commonsResource.findMany({ where: { coopId: input.coopId }, orderBy: { createdAt: "desc" }, take: 150 }),
      ctx.db.aICostEvent.findMany({ where: { coopId: input.coopId, createdAt: { gte: new Date(Date.now() - 31 * 86400000) } }, orderBy: { createdAt: "desc" } }),
      ctx.db.$queryRaw<Array<{ month: string; estimatedUsd: string; unknown: number; calls: number }>>`
        SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') AS month,
          COALESCE(SUM("costUsd"), 0)::text AS "estimatedUsd",
          COUNT(*) FILTER (WHERE "costUsd" IS NULL)::int AS unknown,
          COUNT(*)::int AS calls
        FROM "public"."AICostEvent"
        WHERE "coopId" = ${input.coopId} AND "createdAt" >= NOW() - INTERVAL '12 months'
        GROUP BY 1 ORDER BY 1 DESC`,
      getSageAutonomyUsage(input.coopId, ctx.db),
      ctx.db.group.findMany({
        where: { coopId: input.coopId, kind: { not: "DIRECT" } },
        orderBy: { lastActivityAt: "desc" }, take: 100,
        select: { id: true, name: true, lastActivityAt: true },
      }),
      ctx.db.commonsActionAudit.findMany({
        where: { eventType: "DUPLICATE_SKIPPED", action: { coopId: input.coopId } },
        orderBy: { createdAt: "desc" }, take: 50,
        select: { createdAt: true, metadata: true, action: { select: { id: true, summary: true, status: true, circleId: true } } },
      }),
      ctx.db.sageDecisionTrail.findMany({
        where: { coopId: input.coopId, ...(input.trailAgent ? { agent: input.trailAgent } : {}) },
        orderBy: { createdAt: "desc" }, take: 50,
      }),
    ]);
    const trails = await presentTrails(trailRows, { forAdmin: true }, ctx.db);
    const [tasks, wakeCycles, alerts] = await Promise.all([
      ctx.db.sageTask.findMany({ where: { coopId: input.coopId }, orderBy: { updatedAt: "desc" }, take: 50 }),
      ctx.db.sageWakeCycle.findMany({ where: { coopId: input.coopId }, orderBy: { startedAt: "desc" }, take: 10 }),
      ctx.db.sageAlert.findMany({ where: { coopId: input.coopId }, orderBy: { createdAt: "desc" }, take: 50 }),
    ]);
    const windows = circles.length ? await ctx.db.circleAgentWindow.findMany({
      where: { groupId: { in: circles.map((circle) => circle.id) } },
      orderBy: { openedAt: "desc" },
      select: { groupId: true, status: true, messageCount: true, closedAt: true },
    }) : [];
    const feedback = await ctx.db.commonsActionFeedback.findMany({ where: { coopId: input.coopId, actionId: { in: actions.map((action) => action.id) } } });
    const [missingToolEvents, escalatedActions] = await Promise.all([
      ctx.db.commonsActionAudit.findMany({ where: { eventType: "MISSING_TOOL", action: { coopId: input.coopId } }, select: { actionId: true, metadata: true } }),
      ctx.db.commonsAction.findMany({
        where: { coopId: input.coopId, reviews: { some: { status: "ESCALATED" } } },
        include: { reviews: { where: { status: "ESCALATED" } } },
        orderBy: { createdAt: "desc" }, take: 100,
      }),
    ]);
    const neededToolsByCapability = new Map<string, { capability: string; count: number; sampleActionIds: string[] }>();
    for (const event of missingToolEvents) {
      const capability = (event.metadata as { toolKey?: unknown } | null)?.toolKey;
      const key = typeof capability === "string" ? capability : "unknown";
      const entry = neededToolsByCapability.get(key) ?? { capability: key, count: 0, sampleActionIds: [] };
      entry.count++;
      if (entry.sampleActionIds.length < 5) entry.sampleActionIds.push(event.actionId);
      neededToolsByCapability.set(key, entry);
    }
    const postIds = [...new Set(actions.map((action) => action.sourcePostId))];
    const commentIds = [...new Set(actions.filter((action) => action.sourceType === "commons_comment").map((action) => action.sourceId))];
    const [posts, comments] = await Promise.all([
      ctx.db.commonsPost.findMany({ where: { id: { in: postIds }, coopId: input.coopId }, select: {
        id: true, title: true, content: true, createdAt: true,
        author: { select: { name: true, handle: true } },
      } }),
      ctx.db.commonsComment.findMany({ where: { id: { in: commentIds }, post: { coopId: input.coopId } }, select: {
        id: true, content: true, createdAt: true,
        author: { select: { name: true, handle: true } },
      } }),
    ]);
    const postsById = new Map(posts.map((post) => [post.id, post]));
    const commentsById = new Map(comments.map((comment) => [comment.id, comment]));
    const feedbackByActionId = new Map(feedback.map((entry) => [entry.actionId, entry]));
    const byFeature = new Map<string, { feature: string; model: string; calls: number; estimatedUsd: number; unknown: number }>();
    const byDay = new Map<string, { day: string; estimatedUsd: number; unknown: number }>();
    for (const event of costEvents) {
      const key = `${event.feature}\u0000${event.model}`;
      const feature = byFeature.get(key) ?? { feature: event.feature, model: event.model, calls: 0, estimatedUsd: 0, unknown: 0 };
      feature.calls++;
      feature.estimatedUsd += Number(event.costUsd || 0);
      if (event.costUsd === null) feature.unknown++;
      byFeature.set(key, feature);
      const day = event.createdAt.toISOString().slice(0, 10);
      const daily = byDay.get(day) ?? { day, estimatedUsd: 0, unknown: 0 };
      daily.estimatedUsd += Number(event.costUsd || 0);
      if (event.costUsd === null) daily.unknown++;
      byDay.set(day, daily);
    }
    return {
      setting: { autoReply: setting?.autoReply ?? true, backfillPostsDone: setting?.backfillPostsDone ?? false,
        backfillCommentsDone: setting?.backfillCommentsDone ?? false },
      autonomy,
      circles: circles.map((circle) => {
        const open = windows.find((window) => window.groupId === circle.id && window.status === "OPEN");
        const lastClosed = windows.find((window) => window.groupId === circle.id && window.status === "CLOSED");
        return { id: circle.id, name: circle.name, pendingMessages: open?.messageCount ?? 0,
          lastAnalyzedAt: lastClosed?.closedAt?.toISOString() ?? null };
      }),
      trails,
      tasks: tasks.map((task) => ({
        id: task.id, kind: task.kind, status: task.status, title: task.title, reason: task.reason, ownerUserId: task.ownerUserId,
        postId: task.postId, attempts: task.attempts, maxAttempts: task.maxAttempts, outcome: task.outcome,
        nextWakeAt: task.nextWakeAt.toISOString(), updatedAt: task.updatedAt.toISOString(),
      })),
      alerts: alerts.map((alert) => ({
        id: alert.id, category: alert.category, recipientUserId: alert.recipientUserId, status: alert.status, severity: alert.severity,
        title: alert.title, body: alert.body, feedback: alert.feedback, postId: alert.postId, createdAt: alert.createdAt.toISOString(),
      })),
      wakeCycles: wakeCycles.map((cycle) => ({
        id: cycle.id, reason: cycle.reason, status: cycle.status, tasksProcessed: cycle.tasksProcessed, error: cycle.error,
        startedAt: cycle.startedAt.toISOString(), finishedAt: cycle.finishedAt?.toISOString() ?? null,
      })),
      skippedRepeats: skippedRepeats.map((event) => ({
        createdAt: event.createdAt.toISOString(),
        title: (event.metadata as { title?: unknown } | null)?.title ?? null,
        matched: event.action,
      })),
      actions: actions.map((action) => ({
        ...action,
        feedback: feedbackByActionId.get(action.id) ?? null,
        source: action.sourceType === "commons_comment"
          ? commentsById.get(action.sourceId) ?? null
          : postsById.get(action.sourceId) ?? null,
        parentPost: action.sourceType === "commons_comment" ? postsById.get(action.sourcePostId) ?? null : null,
      })),
      resources,
      costs: { byFeature: [...byFeature.values()], byDay: [...byDay.values()].sort((a, b) => b.day.localeCompare(a.day)),
        byMonth: monthlyCosts.map((row) => ({ ...row, estimatedUsd: Number(row.estimatedUsd) })) },
      neededTools: [...neededToolsByCapability.values()].sort((a, b) => b.count - a.count),
      escalations: escalatedActions.map((action) => ({
        id: action.id, summary: action.summary, type: action.type, circleId: action.circleId,
        reviews: action.reviews.map((review) => ({ id: review.id, reviewType: review.reviewType, userId: review.userId })),
      })),
    };
  }),

  command: commonsPlatformAdminProcedure.input(Command).mutation(async ({ ctx, input }) => {
    const coopId = input.coopId;
    const actor = ctx.commonsAdminIdentity;
    const configExists = await ctx.db.coopConfig.findFirst({ where: { coopId, isActive: true }, select: { id: true } });
    if (!configExists) throw new TRPCError({ code: "NOT_FOUND", message: "Commons not found" });
    if (input.command === "auto-reply") {
      const setting = await ctx.db.commonsAgentSetting.upsert({ where: { coopId }, create: { coopId, autoReply: input.enabled, updatedBy: actor }, update: { autoReply: input.enabled, updatedBy: actor } });
      return { autoReply: setting.autoReply };
    }
    if (input.command === "autonomy-limits") {
      const data = { autonomyMonthlyUsdLimit: input.monthlyUsdLimit, autonomyMonthlyCallLimit: input.monthlyCallLimit, updatedBy: actor };
      await ctx.db.commonsAgentSetting.upsert({ where: { coopId }, create: { coopId, ...data }, update: data });
      return getSageAutonomyUsage(coopId, ctx.db);
    }
    if (input.command === "wake") {
      // Runs the wake-and-wait loop for this Commons now instead of waiting for the schedule.
      const result = await runSageWakeCycle(coopId, "MANUAL", new Date(), (id) => wakeCycleWork(id));
      return result.skipped ? conflict("A wake run for this Commons is already in progress.") : result;
    }
    if (input.command === "analyze-circle") {
      const group = await ctx.db.group.findUnique({ where: { id: input.groupId }, select: { coopId: true, kind: true } });
      if (!group || group.coopId !== coopId || group.kind === "DIRECT") throw new TRPCError({ code: "NOT_FOUND", message: "Circle not found" });
      if ((await getSageAutonomyUsage(coopId, ctx.db)).paused) conflict("Sage is paused for this Commons until its monthly limit resets or is raised.");
      const closed = await closeCircleWindowNow(input.groupId);
      if (!closed) conflict("No new circle activity since Sage last read this circle.");
      // Without a Trigger worker the analysis has already run; with one, the trail appears when it finishes.
      const trail = await ctx.db.sageDecisionTrail.findFirst({ where: { sourceType: "circle_window", sourceId: closed.windowId }, select: { id: true } });
      return { ...closed, trailId: trail?.id ?? null };
    }
    if (input.command === "scan") return scanCommons(coopId, "ADMIN_SCAN");
    if (input.command === "publish-resource") {
      const resource = await ctx.db.commonsResource.findFirst({ where: { id: input.resourceId, coopId } });
      if (!resource) throw new TRPCError({ code: "NOT_FOUND", message: "Resource not found" });
      if (resource.kind === "PERSON" && resource.status !== "ACCEPTED") conflict("The person must accept the invitation first");
      if (resource.status === "PUBLISHED") return { resource };
      if (resource.status === "DECLINED") conflict("The invitation was declined");
      const duplicate = await ctx.db.commonsResource.findFirst({ where: { id: { not: resource.id }, coopId,
        kind: resource.kind, title: { equals: resource.title, mode: "insensitive" }, status: "PUBLISHED" }, select: { id: true } });
      if (duplicate) conflict("A resource with this title and kind is already published");
      const author = await ctx.db.commonsAction.findUnique({ where: { id: resource.actionId }, select: { sourceAuthorId: true } });
      if (!author) conflict("Source action missing");
      const { document } = await ingestDocument({
        documentId: `commons-resource:${resource.id}`,
        coopId, scopeType: "commons", scopeId: coopId, type: "OTHER", visibility: "COMMONS",
        title: resource.title, content: resource.description, uploadedById: author.sourceAuthorId,
        metadata: { commonsResourceId: resource.id, sourceType: resource.sourceType, sourceId: resource.sourceId },
      });
      const updated = await ctx.db.commonsResource.update({ where: { id: resource.id }, data: {
        status: "PUBLISHED", verifiedBy: actor, verifiedAt: new Date(), publishedAt: new Date(), knowledgeDocId: document.id,
      } });
      await ctx.db.commonsAction.update({ where: { id: resource.actionId }, data: { status: "APPROVED", reviewedBy: actor, reviewedAt: new Date() } });
      return { resource: updated };
    }
    const action = await ctx.db.commonsAction.findFirst({ where: { id: input.actionId, coopId } });
    if (!action) throw new TRPCError({ code: "NOT_FOUND", message: "Action not found" });
    if (input.command === "rate-response") {
      if (action.type !== "MAKE_PROPOSAL" && !REPLY_ACTIONS.has(action.type)) conflict("Only replies and proposal drafts can be rated");
      if (input.rating === "NEEDS_WORK" && input.reasons.length === 0) conflict("Choose why this response needs work");
      const data = { rating: input.rating, reasons: input.rating === "GOOD" ? [] : input.reasons,
        notes: input.notes || null, correctedText: input.correctedText || null, reviewedBy: actor };
      await ctx.db.commonsActionFeedback.upsert({ where: { actionId: action.id },
        create: { actionId: action.id, coopId, ...data }, update: data });
      return { success: true };
    }
    if (input.command === "dismiss") {
      if (action.status !== "PENDING") conflict("Only pending actions can be dismissed");
      await ctx.db.commonsAction.update({ where: { id: action.id }, data: { status: "DISMISSED", reviewedBy: actor, reviewedAt: new Date() } });
      return { success: true };
    }
    if (input.command === "edit-draft") {
      if (action.status !== "PENDING") conflict("Only pending drafts can be edited");
      await ctx.db.commonsAction.update({ where: { id: action.id }, data: { draftText: input.draftText } });
      return { success: true };
    }
    if (input.command === "remove-reply") {
      if (!action.publishedCommentId) conflict("No published reply");
      await ctx.db.$transaction(async (tx) => {
        // Scoped by Commons rather than sourcePostId: a circle-trend comment's source is its window, not the post.
        await tx.commonsComment.deleteMany({ where: { id: action.publishedCommentId!, post: { coopId }, author: { isBot: true } } });
        await tx.commonsAction.update({ where: { id: action.id }, data: { status: "DISMISSED", publishedCommentId: null, replySourceKey: null, reviewedBy: actor, reviewedAt: new Date() } });
      });
      return { success: true };
    }
    if (action.status !== "PENDING") conflict("Action is no longer pending");
    if (action.type === "VERIFY_RESOURCE" || action.type === "LOG_RESOURCE") conflict("Verify and publish the resource from the resource list");
    if (REPLY_ACTIONS.has(action.type)) {
      const config = await ctx.db.coopConfig.findFirst({ where: { coopId, isActive: true }, orderBy: { version: "desc" } });
      // A reply about rules, money or membership still needs a current charter quote. Anything else
      // may rest on the thread or a checked source; the admin approving it is the human check.
      const charterRequired = needsCharterGrounding(action.type, action.draftText || "");
      if (!config || charterSnapshotKey(config) !== action.charterConfigId || !action.draftText || !action.evidence
        || (charterRequired && !hasExactGrounding(action.evidence, config))) {
        conflict(charterRequired ? "Reply needs a current charter or goal citation" : "Reply needs evidence and the current charter version");
      }
      const existingReply = await ctx.db.commonsAction.findFirst({ where: {
        sourceType: action.sourceType, sourceId: action.sourceId, publishedCommentId: { not: null },
      }, select: { id: true } });
      if (existingReply) conflict("This item already has an agent reply");
      const sage = await ctx.db.user.findUnique({ where: { handle: "sage" }, select: { id: true, isBot: true } });
      if (!sage?.isBot) conflict("Sage account missing");
      const publishedId = await ctx.db.$transaction(async (tx) => {
        const priorReply = await tx.commonsAction.findFirst({ where: {
          sourceType: action.sourceType, sourceId: action.sourceId, publishedCommentId: { not: null },
        }, select: { id: true } });
        if (priorReply) conflict("This item already has an agent reply");
        const comment = await tx.commonsComment.create({ data: { postId: action.sourcePostId, authorId: sage.id, content: action.draftText! } });
        await tx.commonsAction.update({ where: { id: action.id }, data: {
          status: "PUBLISHED", publishedCommentId: comment.id,
          replySourceKey: `${action.sourceType}:${action.sourceId}`,
          reviewedBy: actor, reviewedAt: new Date(),
        } });
        return comment.id;
      });
      await notifySageComment({ postId: action.sourcePostId, commentId: publishedId });
    } else if (action.type === "MAKE_PROPOSAL") {
      const draft = await ctx.db.commonsProposalDraft.upsert({ where: { actionId: action.id }, create: {
        actionId: action.id, coopId, authorId: action.sourceAuthorId, title: action.summary.slice(0, 160), body: action.draftText || action.summary,
      }, update: {} });
      await ctx.db.commonsAction.update({ where: { id: action.id }, data: { status: "APPROVED", reviewedBy: actor, reviewedAt: new Date() } });
      await createNotificationAndPush(ctx.db, {
        userId: action.sourceAuthorId, coopId, type: "PROPOSAL_DRAFT_READY",
        title: "A proposal draft is ready", body: "Review and edit this Commons suggestion before you submit it.",
        data: { draftId: draft.id, coopId },
      }).catch((error) => console.error("Could not notify proposal author", error));
    } else if (FINAL_REVIEW_TYPE_BY_ACTION_TYPE[action.type]) {
      // Tool-backed action (e.g. an escalated Sage suggestion): authorize the gating review on the
      // admin's behalf, matching the action's current revision, then execute the same as a member approval would.
      const finalReviewType = FINAL_REVIEW_TYPE_BY_ACTION_TYPE[action.type]!;
      const review = await ctx.db.commonsActionReview.findFirst({
        where: { actionId: action.id, reviewType: finalReviewType, payloadHash: action.payloadHash ?? undefined },
        orderBy: { createdAt: "desc" },
      });
      if (!review) conflict("No matching review to authorize for this action's current revision");
      await ctx.db.commonsActionReview.update({ where: { id: review.id }, data: { status: "APPROVED", respondedAt: new Date() } });
      await ctx.db.commonsAction.update({ where: { id: action.id }, data: { reviewedBy: actor, reviewedAt: new Date() } });
      await enqueueSageActionExecute(action.id, action.revision);
    } else {
      await ctx.db.commonsAction.update({ where: { id: action.id }, data: { status: "APPROVED", reviewedBy: actor, reviewedAt: new Date() } });
    }
    return { success: true };
  }),
});
