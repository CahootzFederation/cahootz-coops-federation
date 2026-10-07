import { TRPCError } from "@trpc/server";
import type { CommonsResource, Prisma, PrismaClient } from "@repo/db";

import { ingestDocument } from "./knowledge-base.js";

type Db = PrismaClient | Prisma.TransactionClient;

function conflict(message: string): never {
  throw new TRPCError({ code: "CONFLICT", message });
}

/** Whether a member's accepted offer is listed without review. On unless a steward turned it off. */
export async function resourceAutoListEnabled(db: Db, coopId: string): Promise<boolean> {
  const settings = await db.commonsAgentSetting.findUnique({ where: { coopId }, select: { autoListResources: true } });
  return settings?.autoListResources ?? true;
}

/**
 * Lists a resource in its Commons catalog and knowledge base. Used by platform admins, stewards, and
 * auto-listing when the offering member accepts. A person or self-offer must be accepted first.
 */
export async function publishCommonsResource(db: Db, resource: CommonsResource, actor: string) {
  if (resource.status === "PUBLISHED") return resource;
  if (resource.candidateUserId && resource.status !== "ACCEPTED") conflict("The member must accept the invitation first");
  if (resource.kind === "PERSON" && resource.status !== "ACCEPTED") conflict("The person must accept the invitation first");
  if (resource.status === "DECLINED") conflict("The invitation was declined");
  const duplicate = await db.commonsResource.findFirst({ where: { id: { not: resource.id }, coopId: resource.coopId,
    kind: resource.kind, title: { equals: resource.title, mode: "insensitive" }, status: "PUBLISHED" }, select: { id: true } });
  if (duplicate) conflict("A resource with this title and kind is already published");
  const author = await db.commonsAction.findUnique({ where: { id: resource.actionId }, select: { sourceAuthorId: true } });
  if (!author) conflict("Source action missing");
  // The catalog listing is what members see; the knowledge-base copy only helps Sage find it later.
  const knowledgeDocId = await ingestDocument({
    documentId: `commons-resource:${resource.id}`,
    coopId: resource.coopId, scopeType: "commons", scopeId: resource.coopId, type: "OTHER", visibility: "COMMONS",
    title: resource.title, content: resource.description, uploadedById: author.sourceAuthorId,
    metadata: { commonsResourceId: resource.id, sourceType: resource.sourceType, sourceId: resource.sourceId },
  }).then(({ document }) => document.id).catch((error) => {
    console.error("Could not add a published resource to the knowledge base", error);
    return null;
  });
  const now = new Date();
  const updated = await db.commonsResource.update({ where: { id: resource.id }, data: {
    status: "PUBLISHED", verifiedBy: actor, verifiedAt: now, publishedAt: now, knowledgeDocId,
  } });
  await db.commonsAction.update({ where: { id: resource.actionId }, data: { status: "APPROVED", reviewedBy: actor, reviewedAt: now } });
  return updated;
}
