import { db, Prisma } from "@repo/db";

import { requireMembership } from "../routers/groups.js";

export interface RecordObservationSource {
  type: string; // "commons_post" | "group_comment" | "knowledge_document" | "proposal" | "audit_log" | ...
  id: string;
}

export interface RecordObservationParams {
  type: string; // "pattern_detected" | "risk_flag" | "recommendation" | "post_classification" | "circle_digest_summary" | ...
  scopeType: string; // "commons" | "circle" | "member" | "proposal"
  scopeId: string;
  confidence: number;
  summary: string;
  details?: unknown;
  sources?: RecordObservationSource[];
  visibility?: "PRIVATE_TO_AUTHOR_SCOPE" | "CIRCLE" | "COMMONS_ADMINS" | "COMMONS_MEMBERS" | "PUBLIC";
  expiresAt?: Date;
  reviewAt?: Date;
  generatedByAgentKey?: string;
}

/**
 * Writes one AI Working Memory observation. This is application-code
 * triggered only — no write tool is exposed to agents (see memory-tools.ts) —
 * so a human/reviewer implicitly gates what becomes a stored "belief" other
 * agents can later read via queryObservations().
 */
export async function recordObservation(params: RecordObservationParams) {
  return db.aIObservation.create({
    data: {
      type: params.type,
      scopeType: params.scopeType,
      scopeId: params.scopeId,
      confidence: params.confidence,
      summary: params.summary,
      details: params.details as Prisma.InputJsonValue,
      visibility: params.visibility ?? "COMMONS_ADMINS",
      expiresAt: params.expiresAt,
      reviewAt: params.reviewAt,
      generatedByAgentKey: params.generatedByAgentKey,
      sources: params.sources?.length
        ? {
            create: params.sources.map((s) => ({ sourceType: s.type, sourceId: s.id })),
          }
        : undefined,
    },
    include: { sources: true },
  });
}

export interface QueryObservationsParams {
  scopeType: string;
  scopeId: string;
  requestingUserId: string | null;
  coopId: string;
  includeInactive?: boolean;
}

export interface ObservationResult {
  id: string;
  type: string;
  scopeType: string;
  scopeId: string;
  confidence: number;
  summary: string;
  details: unknown;
  sources: string[];
  visibility: string;
  status: string;
  createdAt: string;
}

async function isActiveCommonsMember(db_: typeof db, userId: string, coopId: string) {
  const membership = await db_.userCoopMembership.findUnique({
    where: { userId_coopId: { userId, coopId } },
    select: { status: true },
  });
  return membership?.status === "ACTIVE";
}

async function isActiveCommonsAdmin(db_: typeof db, userId: string, coopId: string) {
  const adminRole = await db_.adminRole.findFirst({
    where: { userId, coopId, revokedAt: null },
    select: { id: true },
  });
  return !!adminRole;
}

async function isCircleMember(db_: typeof db, groupId: string, userId: string) {
  try {
    await requireMembership(db_, groupId, userId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads AIObservation rows for a scope, enforcing per-row visibility. This is
 * the enforcement point for the whole Layer 4 permission model — every
 * caller (routers, agent tools) goes through this rather than querying
 * AIObservation directly.
 */
export async function queryObservations(
  params: QueryObservationsParams,
): Promise<ObservationResult[]> {
  const rows = await db.aIObservation.findMany({
    where: {
      scopeType: params.scopeType,
      scopeId: params.scopeId,
      ...(params.includeInactive ? {} : { status: "ACTIVE" }),
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    include: { sources: true },
    orderBy: { createdAt: "desc" },
  });

  if (rows.length === 0) return [];

  const neededVisibilities = new Set(rows.map((r) => r.visibility));
  const userId = params.requestingUserId;

  const [commonsMember, commonsAdmin, circleMember] = await Promise.all([
    userId && neededVisibilities.has("COMMONS_MEMBERS")
      ? isActiveCommonsMember(db, userId, params.coopId)
      : Promise.resolve(false),
    userId && neededVisibilities.has("COMMONS_ADMINS")
      ? isActiveCommonsAdmin(db, userId, params.coopId)
      : Promise.resolve(false),
    userId && neededVisibilities.has("CIRCLE")
      ? isCircleMember(db, params.scopeId, userId)
      : Promise.resolve(false),
  ]);

  function isVisible(visibility: string): boolean {
    switch (visibility) {
      case "PUBLIC":
        return true;
      case "COMMONS_MEMBERS":
        return commonsMember;
      case "COMMONS_ADMINS":
        return commonsAdmin;
      case "CIRCLE":
        return circleMember;
      case "PRIVATE_TO_AUTHOR_SCOPE":
        return params.scopeType === "member" && userId === params.scopeId;
      default:
        return false;
    }
  }

  return rows
    .filter((r) => isVisible(r.visibility))
    .map((r) => ({
      id: r.id,
      type: r.type,
      scopeType: r.scopeType,
      scopeId: r.scopeId,
      confidence: r.confidence,
      summary: r.summary,
      details: r.details,
      sources: r.sources.map((s) => s.sourceId),
      visibility: r.visibility,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    }));
}
