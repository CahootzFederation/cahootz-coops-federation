import { NextResponse } from "next/server";
import { z } from "zod";
import { db, getSession } from "@/lib/signature-verification";
import { isPlatformAdminWallet, isPlatformAdminEmail } from "@repo/trpc/lib/admin-config";
import { charterSnapshotKey, hasExactGrounding, REPLY_ACTIONS, scanCommons } from "@repo/trpc/services/commons-action-agent";
import { ingestDocument } from "@repo/trpc/services/knowledge-base";
import { createNotificationAndPush } from "@repo/trpc/services/push-notification-service";

const CommandZ = z.discriminatedUnion("command", [
  z.object({ command: z.literal("auto-reply"), enabled: z.boolean() }),
  z.object({ command: z.literal("scan") }),
  z.object({ command: z.literal("dismiss"), actionId: z.string().min(1) }),
  z.object({ command: z.literal("edit-draft"), actionId: z.string().min(1), draftText: z.string().trim().max(2000) }),
  z.object({ command: z.literal("approve"), actionId: z.string().min(1) }),
  z.object({ command: z.literal("remove-reply"), actionId: z.string().min(1) }),
  z.object({ command: z.literal("publish-resource"), resourceId: z.string().min(1) }),
]);

async function adminIdentity() {
  const session = await getSession();
  if (!session || !(isPlatformAdminWallet(session.address) || isPlatformAdminEmail(session.email))) return null;
  return session.address || session.email || "platform-admin";
}

async function exists(coopId: string) {
  return db.coopConfig.findFirst({ where: { coopId, isActive: true }, select: { id: true } });
}

export async function GET(_request: Request, { params }: { params: Promise<{ coopId: string }> }) {
  if (!await adminIdentity()) return NextResponse.json({ error: "Platform admin access required" }, { status: 403 });
  const { coopId } = await params;
  if (!await exists(coopId)) return NextResponse.json({ error: "Commons not found" }, { status: 404 });
  const [setting, actions, resources, costEvents, monthlyCosts] = await Promise.all([
    db.commonsAgentSetting.findUnique({ where: { coopId } }),
    db.commonsAction.findMany({ where: { coopId }, orderBy: { createdAt: "desc" }, take: 150 }),
    db.commonsResource.findMany({ where: { coopId }, orderBy: { createdAt: "desc" }, take: 150 }),
    db.aICostEvent.findMany({ where: { coopId, createdAt: { gte: new Date(Date.now() - 31 * 86400000) } }, orderBy: { createdAt: "desc" } }),
    db.$queryRaw<Array<{ month: string; estimatedUsd: string; unknown: number; calls: number }>>`
      SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') AS month,
        COALESCE(SUM("costUsd"), 0)::text AS "estimatedUsd",
        COUNT(*) FILTER (WHERE "costUsd" IS NULL)::int AS unknown,
        COUNT(*)::int AS calls
      FROM "public"."AICostEvent"
      WHERE "coopId" = ${coopId} AND "createdAt" >= NOW() - INTERVAL '12 months'
      GROUP BY 1 ORDER BY 1 DESC`,
  ]);
  const totals = new Map<string, { feature: string; model: string; calls: number; estimatedUsd: number; unknown: number }>();
  const days = new Map<string, { day: string; estimatedUsd: number; unknown: number }>();
  for (const event of costEvents) {
    const key = `${event.feature}\u0000${event.model}`;
    const row = totals.get(key) ?? { feature: event.feature, model: event.model, calls: 0, estimatedUsd: 0, unknown: 0 };
    row.calls++;
    row.estimatedUsd += Number(event.costUsd || 0);
    if (event.costUsd === null) row.unknown++;
    totals.set(key, row);
    const day = event.createdAt.toISOString().slice(0, 10);
    const daily = days.get(day) ?? { day, estimatedUsd: 0, unknown: 0 };
    daily.estimatedUsd += Number(event.costUsd || 0);
    if (event.costUsd === null) daily.unknown++;
    days.set(day, daily);
  }
  return NextResponse.json({
    setting: { autoReply: setting?.autoReply ?? true, backfillPostsDone: setting?.backfillPostsDone ?? false,
      backfillCommentsDone: setting?.backfillCommentsDone ?? false },
    actions, resources, costs: { byFeature: [...totals.values()], byDay: [...days.values()].sort((a, b) => b.day.localeCompare(a.day)),
      byMonth: monthlyCosts.map((row) => ({ ...row, estimatedUsd: Number(row.estimatedUsd) })) },
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ coopId: string }> }) {
  const actor = await adminIdentity();
  if (!actor) return NextResponse.json({ error: "Platform admin access required" }, { status: 403 });
  const { coopId } = await params;
  if (!await exists(coopId)) return NextResponse.json({ error: "Commons not found" }, { status: 404 });
  const parsed = CommandZ.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid command" }, { status: 400 });
  const input = parsed.data;
  try {
    if (input.command === "auto-reply") {
      const setting = await db.commonsAgentSetting.upsert({ where: { coopId }, create: { coopId, autoReply: input.enabled, updatedBy: actor }, update: { autoReply: input.enabled, updatedBy: actor } });
      return NextResponse.json({ autoReply: setting.autoReply });
    }
    if (input.command === "scan") return NextResponse.json(await scanCommons(coopId));
    if (input.command === "publish-resource") {
      const resource = await db.commonsResource.findFirst({ where: { id: input.resourceId, coopId } });
      if (!resource) return NextResponse.json({ error: "Resource not found" }, { status: 404 });
      if (resource.kind === "PERSON" && resource.status !== "ACCEPTED") {
        return NextResponse.json({ error: "The person must accept the invitation first" }, { status: 409 });
      }
      if (resource.status === "PUBLISHED") return NextResponse.json({ resource });
      if (resource.status === "DECLINED") return NextResponse.json({ error: "The invitation was declined" }, { status: 409 });
      const duplicate = await db.commonsResource.findFirst({ where: { id: { not: resource.id }, coopId,
        kind: resource.kind, title: { equals: resource.title, mode: "insensitive" }, status: "PUBLISHED" }, select: { id: true } });
      if (duplicate) return NextResponse.json({ error: "A resource with this title and kind is already published" }, { status: 409 });
      const author = await db.commonsAction.findUnique({ where: { id: resource.actionId }, select: { sourceAuthorId: true } });
      if (!author) return NextResponse.json({ error: "Source action missing" }, { status: 409 });
      const { document } = await ingestDocument({
        documentId: `commons-resource:${resource.id}`,
        coopId, scopeType: "commons", scopeId: coopId, type: "OTHER", visibility: "COMMONS",
        title: resource.title, content: resource.description, uploadedById: author.sourceAuthorId,
        metadata: { commonsResourceId: resource.id, sourceType: resource.sourceType, sourceId: resource.sourceId },
      });
      const updated = await db.commonsResource.update({ where: { id: resource.id }, data: {
        status: "PUBLISHED", verifiedBy: actor, verifiedAt: new Date(), publishedAt: new Date(), knowledgeDocId: document.id,
      } });
      await db.commonsAction.update({ where: { id: resource.actionId }, data: { status: "APPROVED", reviewedBy: actor, reviewedAt: new Date() } });
      return NextResponse.json({ resource: updated });
    }
    const action = await db.commonsAction.findFirst({ where: { id: input.actionId, coopId } });
    if (!action) return NextResponse.json({ error: "Action not found" }, { status: 404 });
    if (input.command === "dismiss") {
      if (action.status !== "PENDING") return NextResponse.json({ error: "Only pending actions can be dismissed" }, { status: 409 });
      await db.commonsAction.update({ where: { id: action.id }, data: { status: "DISMISSED", reviewedBy: actor, reviewedAt: new Date() } });
      return NextResponse.json({ success: true });
    }
    if (input.command === "edit-draft") {
      if (action.status !== "PENDING") return NextResponse.json({ error: "Only pending drafts can be edited" }, { status: 409 });
      await db.commonsAction.update({ where: { id: action.id }, data: { draftText: input.draftText } });
      return NextResponse.json({ success: true });
    }
    if (input.command === "remove-reply") {
      if (!action.publishedCommentId) return NextResponse.json({ error: "No published reply" }, { status: 409 });
      await db.$transaction(async (tx) => {
        await tx.commonsComment.deleteMany({ where: { id: action.publishedCommentId!, postId: action.sourcePostId, author: { isBot: true } } });
        await tx.commonsAction.update({ where: { id: action.id }, data: { status: "DISMISSED", publishedCommentId: null, replySourceKey: null, reviewedBy: actor, reviewedAt: new Date() } });
      });
      return NextResponse.json({ success: true });
    }
    if (action.status !== "PENDING") return NextResponse.json({ error: "Action is no longer pending" }, { status: 409 });
    if (action.type === "VERIFY_RESOURCE" || action.type === "LOG_RESOURCE") {
      return NextResponse.json({ error: "Verify and publish the resource from the resource list" }, { status: 409 });
    }
    if (REPLY_ACTIONS.has(action.type)) {
      const config = await db.coopConfig.findFirst({ where: { coopId, isActive: true }, orderBy: { version: "desc" } });
      if (!config || charterSnapshotKey(config) !== action.charterConfigId || !hasExactGrounding(action.evidence || "", config) || !action.draftText) {
        return NextResponse.json({ error: "Reply needs a current charter or goal citation" }, { status: 409 });
      }
      const existingReply = await db.commonsAction.findFirst({ where: {
        sourceType: action.sourceType, sourceId: action.sourceId, publishedCommentId: { not: null },
      }, select: { id: true } });
      if (existingReply) return NextResponse.json({ error: "This item already has an agent reply" }, { status: 409 });
      const sage = await db.user.findUnique({ where: { handle: "sage" }, select: { id: true, isBot: true } });
      if (!sage?.isBot) return NextResponse.json({ error: "Sage account missing" }, { status: 409 });
      await db.$transaction(async (tx) => {
        const priorReply = await tx.commonsAction.findFirst({ where: {
          sourceType: action.sourceType, sourceId: action.sourceId, publishedCommentId: { not: null },
        }, select: { id: true } });
        if (priorReply) throw new Error("This item already has an agent reply");
        const comment = await tx.commonsComment.create({ data: { postId: action.sourcePostId, authorId: sage.id, content: action.draftText! } });
        await tx.commonsAction.update({ where: { id: action.id }, data: {
          status: "PUBLISHED", publishedCommentId: comment.id,
          replySourceKey: `${action.sourceType}:${action.sourceId}`,
          reviewedBy: actor, reviewedAt: new Date(),
        } });
      });
    } else if (action.type === "MAKE_PROPOSAL") {
      const draft = await db.commonsProposalDraft.upsert({ where: { actionId: action.id }, create: {
        actionId: action.id, coopId, authorId: action.sourceAuthorId, title: action.summary.slice(0, 160), body: action.draftText || action.summary,
      }, update: {} });
      await db.commonsAction.update({ where: { id: action.id }, data: { status: "APPROVED", reviewedBy: actor, reviewedAt: new Date() } });
      await createNotificationAndPush(db, {
        userId: action.sourceAuthorId, coopId, type: "PROPOSAL_DRAFT_READY",
        title: "A proposal draft is ready", body: "Review and edit this Commons suggestion before you submit it.",
        data: { draftId: draft.id, coopId },
      }).catch((error) => console.error("Could not notify proposal author", error));
    } else {
      await db.commonsAction.update({ where: { id: action.id }, data: { status: "APPROVED", reviewedBy: actor, reviewedAt: new Date() } });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Commons AI admin action failed", { coopId, command: input.command, error });
    return NextResponse.json({ error: "Action failed. Check server logs." }, { status: 500 });
  }
}
