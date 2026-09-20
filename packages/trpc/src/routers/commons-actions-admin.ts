import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { commonsPlatformAdminProcedure } from "../procedures/commons-platform-admin.js";
import { charterSnapshotKey, hasExactGrounding, REPLY_ACTIONS, scanCommons } from "../services/commons-action-agent.js";
import { ingestDocument } from "../services/knowledge-base.js";
import { createNotificationAndPush } from "../services/push-notification-service.js";
import { router } from "../trpc.js";

const Scoped = z.object({ coopId: z.string().min(1) });
const Command = z.discriminatedUnion("command", [
  Scoped.extend({ command: z.literal("auto-reply"), enabled: z.boolean() }),
  Scoped.extend({ command: z.literal("scan") }),
  Scoped.extend({ command: z.literal("dismiss"), actionId: z.string().min(1) }),
  Scoped.extend({ command: z.literal("edit-draft"), actionId: z.string().min(1), draftText: z.string().trim().max(2000) }),
  Scoped.extend({ command: z.literal("approve"), actionId: z.string().min(1) }),
  Scoped.extend({ command: z.literal("remove-reply"), actionId: z.string().min(1) }),
  Scoped.extend({ command: z.literal("publish-resource"), resourceId: z.string().min(1) }),
]);

function conflict(message: string): never {
  throw new TRPCError({ code: "CONFLICT", message });
}

export const commonsActionsAdminRouter = router({
  dashboard: commonsPlatformAdminProcedure.input(Scoped).query(async ({ ctx, input }) => {
    const config = await ctx.db.coopConfig.findFirst({ where: { coopId: input.coopId, isActive: true }, select: { id: true } });
    if (!config) throw new TRPCError({ code: "NOT_FOUND", message: "Commons not found" });
    const [setting, actions, resources, costEvents, monthlyCosts] = await Promise.all([
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
    ]);
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
      actions: actions.map((action) => ({
        ...action,
        source: action.sourceType === "commons_comment"
          ? commentsById.get(action.sourceId) ?? null
          : postsById.get(action.sourceId) ?? null,
        parentPost: action.sourceType === "commons_comment" ? postsById.get(action.sourcePostId) ?? null : null,
      })),
      resources,
      costs: { byFeature: [...byFeature.values()], byDay: [...byDay.values()].sort((a, b) => b.day.localeCompare(a.day)),
        byMonth: monthlyCosts.map((row) => ({ ...row, estimatedUsd: Number(row.estimatedUsd) })) },
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
    if (input.command === "scan") return scanCommons(coopId);
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
        await tx.commonsComment.deleteMany({ where: { id: action.publishedCommentId!, postId: action.sourcePostId, author: { isBot: true } } });
        await tx.commonsAction.update({ where: { id: action.id }, data: { status: "DISMISSED", publishedCommentId: null, replySourceKey: null, reviewedBy: actor, reviewedAt: new Date() } });
      });
      return { success: true };
    }
    if (action.status !== "PENDING") conflict("Action is no longer pending");
    if (action.type === "VERIFY_RESOURCE" || action.type === "LOG_RESOURCE") conflict("Verify and publish the resource from the resource list");
    if (REPLY_ACTIONS.has(action.type)) {
      const config = await ctx.db.coopConfig.findFirst({ where: { coopId, isActive: true }, orderBy: { version: "desc" } });
      if (!config || charterSnapshotKey(config) !== action.charterConfigId || !hasExactGrounding(action.evidence || "", config) || !action.draftText) {
        conflict("Reply needs a current charter or goal citation");
      }
      const existingReply = await ctx.db.commonsAction.findFirst({ where: {
        sourceType: action.sourceType, sourceId: action.sourceId, publishedCommentId: { not: null },
      }, select: { id: true } });
      if (existingReply) conflict("This item already has an agent reply");
      const sage = await ctx.db.user.findUnique({ where: { handle: "sage" }, select: { id: true, isBot: true } });
      if (!sage?.isBot) conflict("Sage account missing");
      await ctx.db.$transaction(async (tx) => {
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
      });
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
    } else {
      await ctx.db.commonsAction.update({ where: { id: action.id }, data: { status: "APPROVED", reviewedBy: actor, reviewedAt: new Date() } });
    }
    return { success: true };
  }),
});
