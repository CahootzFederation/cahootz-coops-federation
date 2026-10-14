import { createHash } from "node:crypto";

import { db, Prisma } from "@repo/db";
import { z } from "zod";

import { auditLogEntry } from "../lib/audit.js";
import { recordObservation } from "./ai-memory.js";
import { MEMBER_SIGNAL_AGENT_KEY } from "./sage-private-signals.js";

export const COMMUNITY_MEMORY_AGENT_KEY = "sage-community-memory";
export const COMMUNITY_MEMORY_MIN_COMMONS_MEMBERS = 10;
export const COMMUNITY_MEMORY_MIN_CONTRIBUTORS = 5;
export const COMMUNITY_MEMORY_MEMBER_FRACTION = 0.2;
export const COMMUNITY_MEMORY_TTL_DAYS = 180;
export const COMMUNITY_MEMORY_REVIEW_DAYS = 30;
const LOOKBACK_DAYS = 90;
const DAY_MS = 86_400_000;

const ImpactOutcomeZ = z.enum(["HELPFUL", "NOT_HELPFUL", "INCONCLUSIVE", "NO_ACTION"]);
export type ImpactOutcome = z.infer<typeof ImpactOutcomeZ>;

export const CommunityObservationDetailsZ = z.object({
  themeKey: z.string().min(1),
  wellbeingCategory: z.string().min(1),
  evidenceWindow: z.object({ start: z.string().date(), end: z.string().date() }),
  distinctMemberCount: z.number().int().nonnegative(),
  activeMemberCount: z.number().int().nonnegative(),
  requiredMemberCount: z.number().int().positive(),
  supportCount: z.number().int().nonnegative(),
  contradictionCount: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1),
  evaluatedConfigId: z.string().min(1),
  evaluatedConfigVersion: z.number().int().positive(),
  charterSnapshotHash: z.string().min(1),
  missionGoalKeys: z.array(z.string()),
  missionGoalSnapshot: z.array(z.object({ key: z.string(), label: z.string(), description: z.string().optional() })),
  coordination: z.object({
    correlatedBurst: z.boolean(),
    distinctDates: z.number().int().nonnegative(),
    largestDateShare: z.number().min(0).max(1),
    repeatedFingerprintShare: z.number().min(0).max(1),
  }),
  consolidationPasses: z.number().int().positive(),
  sourceObservationIds: z.array(z.string()),
  firstQualifiedAt: z.string().datetime(),
  lastEvaluatedAt: z.string().datetime(),
  impact: z.object({
    state: z.enum(["NOT_DUE", "DUE", "REVIEWED"]),
    nextReviewAt: z.string().datetime(),
    lastOutcome: ImpactOutcomeZ.nullable(),
  }),
});
export type CommunityObservationDetails = z.infer<typeof CommunityObservationDetailsZ>;

const MemberSignalDetailsZ = z.object({
  themeKey: z.string().min(1),
  wellbeingCategory: z.string().min(1),
  stance: z.enum(["SUPPORT", "CONTRADICT"]),
  aggregationConsent: z.literal(true),
  aggregationEligible: z.literal(true),
  relevantCoopIds: z.array(z.string()),
  sourceDate: z.string().date(),
  sourceFingerprint: z.string().min(1),
  sensitive: z.literal(false),
  urgent: z.literal(false),
});

type EligibleSignal = {
  id: string;
  memberId: string;
  themeKey: string;
  wellbeingCategory: string;
  stance: "SUPPORT" | "CONTRADICT";
  sourceDate: string;
  sourceFingerprint: string;
};

type MissionGoal = { key: string; label: string; description?: string };

function requiredContributors(activeMembers: number) {
  return Math.max(COMMUNITY_MEMORY_MIN_CONTRIBUTORS, Math.ceil(activeMembers * COMMUNITY_MEMORY_MEMBER_FRACTION));
}

function charterHash(charter: string, goals: MissionGoal[]) {
  return createHash("sha256").update(JSON.stringify({ charter, goals })).digest("hex");
}

function words(value: string) {
  return new Set(value.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((word) => word.length > 3));
}

function relatedGoals(themeKey: string, category: string, goals: MissionGoal[]) {
  const terms = words(`${themeKey} ${category}`);
  return goals.filter((goal) => [...words(`${goal.label} ${goal.description ?? ""}`)].some((word) => terms.has(word)));
}

function maxShare(values: string[]) {
  if (!values.length) return 0;
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Math.max(...counts.values()) / values.length;
}

function distinctMembers(signals: EligibleSignal[], stance: EligibleSignal["stance"]) {
  const byMember = new Map<string, EligibleSignal>();
  for (const signal of signals.filter((item) => item.stance === stance)) {
    const previous = byMember.get(signal.memberId);
    if (!previous || previous.sourceDate < signal.sourceDate) byMember.set(signal.memberId, signal);
  }
  return [...byMember.values()];
}

export interface CommunityCandidate {
  themeKey: string;
  category: string;
  status: "CANDIDATE" | "UNSUPPORTED" | "DISMISSED";
  confidence: number;
  summary: string;
  details: Omit<CommunityObservationDetails, "consolidationPasses" | "firstQualifiedAt" | "lastEvaluatedAt" | "impact">;
}

export function buildCommunityCandidate(input: {
  coopId: string;
  activeMemberCount: number;
  signals: EligibleSignal[];
  config: { id: string; version: number; charterText: string; missionGoals: MissionGoal[] };
}): CommunityCandidate | null {
  if (!input.signals.length) return null;
  const themeKey = input.signals[0]!.themeKey;
  const category = input.signals[0]!.wellbeingCategory;
  const support = distinctMembers(input.signals, "SUPPORT");
  const contradict = distinctMembers(input.signals, "CONTRADICT");
  const required = requiredContributors(input.activeMemberCount);
  const all = [...support, ...contradict];
  const dates = all.map((signal) => signal.sourceDate);
  const distinctDates = new Set(dates).size;
  const largestDateShare = maxShare(dates);
  const repeatedFingerprintShare = maxShare(all.map((signal) => signal.sourceFingerprint));
  const correlatedBurst = distinctDates < 2 || largestDateShare >= 0.8 || repeatedFingerprintShare > 0.5;
  const goals = relatedGoals(themeKey, category, input.config.missionGoals);
  const supportMet = input.activeMemberCount >= COMMUNITY_MEMORY_MIN_COMMONS_MEMBERS && support.length >= required;
  const contradicted = contradict.length >= required && contradict.length >= support.length;
  const status = contradicted ? "DISMISSED" : supportMet ? "CANDIDATE" : "UNSUPPORTED";
  const firstDate = dates.sort()[0] ?? new Date().toISOString().slice(0, 10);
  const lastDate = dates.sort().at(-1) ?? firstDate;
  const confidence = status === "CANDIDATE"
    ? Math.min(0.95, 0.55 + (support.length / Math.max(required, 1)) * 0.2 - (correlatedBurst ? 0.2 : 0))
    : Math.min(0.95, 0.5 + (contradict.length / Math.max(required, 1)) * 0.2);
  const goalPhrase = goals.length ? ` This may affect ${goals.map((goal) => goal.label).join(", ")}.` : "";
  return {
    themeKey,
    category,
    status,
    confidence: Math.max(0, confidence),
    summary: status === "DISMISSED"
      ? `Recent member reports no longer support the earlier ${category.replace(/_/g, " ")} need.`
      : `${support.length} members reported a need related to ${category.replace(/_/g, " ")} during this evidence window.${goalPhrase}`,
    details: {
      themeKey,
      wellbeingCategory: category,
      evidenceWindow: { start: firstDate, end: lastDate },
      distinctMemberCount: new Set(all.map((signal) => signal.memberId)).size,
      activeMemberCount: input.activeMemberCount,
      requiredMemberCount: required,
      supportCount: support.length,
      contradictionCount: contradict.length,
      confidence: Math.max(0, confidence),
      evaluatedConfigId: input.config.id,
      evaluatedConfigVersion: input.config.version,
      charterSnapshotHash: charterHash(input.config.charterText, input.config.missionGoals),
      missionGoalKeys: goals.map((goal) => goal.key),
      missionGoalSnapshot: goals,
      coordination: { correlatedBurst, distinctDates, largestDateShare, repeatedFingerprintShare },
      sourceObservationIds: all.map((signal) => signal.id).sort(),
    },
  };
}

function candidateFingerprint(coopId: string, candidate: CommunityCandidate) {
  return createHash("sha256")
    .update(JSON.stringify({
      coopId,
      theme: candidate.themeKey,
      config: candidate.details.evaluatedConfigId,
      version: candidate.details.evaluatedConfigVersion,
      charter: candidate.details.charterSnapshotHash,
      sources: candidate.details.sourceObservationIds,
    }))
    .digest("hex")
    .slice(0, 24);
}

function parseDetails(value: unknown) {
  const parsed = CommunityObservationDetailsZ.safeParse(value);
  return parsed.success ? parsed.data : null;
}

async function writeCandidate(coopId: string, candidate: CommunityCandidate, now: Date) {
  const existingRows = await db.aIObservation.findMany({
    where: {
      scopeType: "commons", scopeId: coopId, generatedByAgentKey: COMMUNITY_MEMORY_AGENT_KEY,
      status: { in: ["CANDIDATE", "ACTIVE"] },
    },
    orderBy: { createdAt: "desc" },
    include: { sources: true },
  });
  const sameTheme = existingRows.filter((row) => parseDetails(row.details)?.themeKey === candidate.themeKey);
  if (candidate.status !== "CANDIDATE") {
    if (sameTheme.length) {
      await db.aIObservation.updateMany({
        where: { id: { in: sameTheme.map((row) => row.id) } },
        data: { status: candidate.status },
      });
    }
    return { state: candidate.status.toLowerCase(), observationId: sameTheme[0]?.id ?? null };
  }
  const fingerprint = candidateFingerprint(coopId, candidate);
  const systemKey = `community:${coopId}:${candidate.themeKey}:${fingerprint}`;
  const sameVersion = sameTheme.find((row) => row.systemKey === systemKey);
  if (sameVersion) {
    if (sameVersion.status === "ACTIVE") return { state: "active", observationId: sameVersion.id };
    const current = parseDetails(sameVersion.details);
    if (!current) return { state: "invalid", observationId: sameVersion.id };
    const passes = current.consolidationPasses + 1;
    const canPromote = passes >= 2 && !candidate.details.coordination.correlatedBurst;
    await db.aIObservation.update({
      where: { id: sameVersion.id },
      data: {
        status: canPromote ? "ACTIVE" : "CANDIDATE",
        confidence: candidate.confidence,
        details: { ...current, consolidationPasses: passes, lastEvaluatedAt: now.toISOString() } as Prisma.InputJsonValue,
        reviewAt: new Date(now.getTime() + COMMUNITY_MEMORY_REVIEW_DAYS * DAY_MS),
      },
    });
    if (canPromote) {
      await db.aIObservation.updateMany({
        where: { id: { in: sameTheme.filter((row) => row.id !== sameVersion.id).map((row) => row.id) }, status: { in: ["CANDIDATE", "ACTIVE"] } },
        data: { status: "SUPERSEDED" },
      });
    }
    return { state: canPromote ? "active" : "candidate", observationId: sameVersion.id };
  }
  const details: CommunityObservationDetails = {
    ...candidate.details,
    consolidationPasses: 1,
    firstQualifiedAt: now.toISOString(),
    lastEvaluatedAt: now.toISOString(),
    impact: {
      state: "NOT_DUE",
      nextReviewAt: new Date(now.getTime() + 30 * DAY_MS).toISOString(),
      lastOutcome: null,
    },
  };
  const row = await recordObservation({
    type: candidate.details.missionGoalKeys.length ? "commons_goal_signal" : "community_wellbeing_signal",
    scopeType: "commons",
    scopeId: coopId,
    confidence: candidate.confidence,
    summary: candidate.summary,
    details,
    sources: candidate.details.sourceObservationIds.map((id) => ({ type: "ai_observation", id })),
    visibility: "SAGE_INTERNAL",
    status: "CANDIDATE",
    expiresAt: new Date(now.getTime() + COMMUNITY_MEMORY_TTL_DAYS * DAY_MS),
    reviewAt: new Date(now.getTime() + COMMUNITY_MEMORY_REVIEW_DAYS * DAY_MS),
    generatedByAgentKey: COMMUNITY_MEMORY_AGENT_KEY,
    systemKey,
  });
  return { state: "created", observationId: row.id };
}

export function impactOutcome(actions: Array<{ status: string; feedback?: { rating: string } | null }>): ImpactOutcome {
  if (!actions.length) return "NO_ACTION";
  if (actions.some((action) => action.status === "PUBLISHED" && action.feedback?.rating === "GOOD")) return "HELPFUL";
  if (actions.some((action) => action.feedback?.rating === "NEEDS_WORK" || ["DISMISSED", "FAILED"].includes(action.status))) return "NOT_HELPFUL";
  return "INCONCLUSIVE";
}

async function reviewImpacts(coopId: string, now: Date) {
  const observations = await db.aIObservation.findMany({
    where: {
      scopeType: "commons", scopeId: coopId, generatedByAgentKey: COMMUNITY_MEMORY_AGENT_KEY,
      type: { in: ["commons_goal_signal", "community_wellbeing_signal"] },
    },
  });
  let reviewed = 0;
  for (const observation of observations) {
    const ageDays = Math.floor((now.getTime() - observation.createdAt.getTime()) / DAY_MS);
    for (const days of [30, 90] as const) {
      if (ageDays < days) continue;
      const systemKey = `community-impact:${observation.id}:${days}`;
      if (await db.aIObservation.findUnique({ where: { systemKey }, select: { id: true } })) continue;
      const actions = await db.commonsAction.findMany({
        where: { originObservationId: observation.id }, include: { feedback: true, reviews: true },
      });
      const details = parseDetails(observation.details);
      const outcome = impactOutcome(actions);
      const related = await db.aIObservation.findMany({
        where: {
          scopeType: "commons", scopeId: coopId, generatedByAgentKey: COMMUNITY_MEMORY_AGENT_KEY,
          type: { in: ["commons_goal_signal", "community_wellbeing_signal"] },
        },
        orderBy: { createdAt: "desc" }, take: 100,
        select: { details: true },
      });
      const current = related.map((row) => parseDetails(row.details))
        .find((candidate) => candidate?.themeKey === details?.themeKey);
      const baseline = details?.supportCount ?? null;
      const currentSupport = current?.supportCount ?? null;
      const signalMovement = baseline === null || currentSupport === null ? "UNKNOWN"
        : currentSupport > baseline ? "INCREASED" : currentSupport < baseline ? "DECREASED" : "STABLE";
      await recordObservation({
        type: "community_need_impact",
        scopeType: "commons",
        scopeId: coopId,
        confidence: 1,
        summary: `${days}-day review: ${outcome.toLowerCase().replace(/_/g, " ")}. This records association, not causation.`,
        details: {
          sourceObservationId: observation.id,
          reviewWindowDays: days,
          outcome,
          linkedActionCount: actions.length,
          actionProgress: {
            suggested: actions.length > 0,
            reviewedCount: actions.filter((action) => action.reviewedAt || action.reviews.some((review) => review.respondedAt)).length,
            acceptedCount: actions.filter((action) => ["APPROVED", "PUBLISHED"].includes(action.status)).length,
            editedCount: actions.filter((action) => action.generatedDraftText && action.draftText && action.generatedDraftText !== action.draftText).length,
            dismissedCount: actions.filter((action) => action.status === "DISMISSED").length,
            publishedCount: actions.filter((action) => action.status === "PUBLISHED").length,
            failedCount: actions.filter((action) => action.status === "FAILED").length,
            positiveFeedbackCount: actions.filter((action) => action.feedback?.rating === "GOOD").length,
            negativeFeedbackCount: actions.filter((action) => action.feedback?.rating === "NEEDS_WORK").length,
          },
          baselineSupportCount: baseline,
          currentSupportCount: currentSupport,
          signalMovement,
          causationClaimed: false,
        },
        sources: [
          { type: "ai_observation", id: observation.id },
          ...actions.map((action) => ({ type: "commons_action", id: action.id })),
        ],
        visibility: "SAGE_INTERNAL",
        status: "ACTIVE",
        expiresAt: new Date(now.getTime() + COMMUNITY_MEMORY_TTL_DAYS * DAY_MS),
        generatedByAgentKey: COMMUNITY_MEMORY_AGENT_KEY,
        systemKey,
      });
      reviewed++;
    }
  }
  return reviewed;
}

export async function consolidateCommonsMemory(coopId: string, now = new Date()) {
  const config = await db.coopConfig.findFirst({
    where: { coopId, isActive: true }, orderBy: { version: "desc" },
    select: { id: true, version: true, charterText: true, missionGoals: true },
  });
  if (!config) return { skipped: "no-config" as const, themes: 0, created: 0, active: 0, unsupported: 0, dismissed: 0, impacts: 0 };
  const memberships = await db.userCoopMembership.findMany({
    where: { coopId, status: "ACTIVE", user: { deletedAt: null, isBot: false, status: "ACTIVE" } },
    select: { userId: true },
  });
  const activeMembers = new Set(memberships.map((membership) => membership.userId));
  const rows = await db.aIObservation.findMany({
    where: {
      scopeType: "member", status: "ACTIVE", generatedByAgentKey: MEMBER_SIGNAL_AGENT_KEY,
      createdAt: { gte: new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS) },
    },
    orderBy: { createdAt: "asc" }, take: 5000,
  });
  const signals: EligibleSignal[] = [];
  for (const row of rows) {
    if (!activeMembers.has(row.scopeId)) continue;
    const parsed = MemberSignalDetailsZ.safeParse(row.details);
    if (!parsed.success || !parsed.data.relevantCoopIds.includes(coopId)) continue;
    signals.push({
      id: row.id, memberId: row.scopeId, themeKey: parsed.data.themeKey,
      wellbeingCategory: parsed.data.wellbeingCategory, stance: parsed.data.stance,
      sourceDate: parsed.data.sourceDate, sourceFingerprint: parsed.data.sourceFingerprint,
    });
  }
  const byTheme = new Map<string, EligibleSignal[]>();
  for (const signal of signals) byTheme.set(signal.themeKey, [...(byTheme.get(signal.themeKey) ?? []), signal]);
  const counts = { created: 0, candidate: 0, active: 0, unsupported: 0, dismissed: 0 };
  for (const themeSignals of byTheme.values()) {
    const candidate = buildCommunityCandidate({
      coopId,
      activeMemberCount: activeMembers.size,
      signals: themeSignals,
      config: {
        ...config,
        missionGoals: (Array.isArray(config.missionGoals) ? config.missionGoals : []) as MissionGoal[],
      },
    });
    if (!candidate) continue;
    const result = await writeCandidate(coopId, candidate, now);
    if (result.state in counts) counts[result.state as keyof typeof counts]++;
  }
  // Active/candidate themes that disappeared from the evidence window become unsupported, not false.
  const presentThemes = new Set(byTheme.keys());
  const stale = await db.aIObservation.findMany({
    where: { scopeType: "commons", scopeId: coopId, generatedByAgentKey: COMMUNITY_MEMORY_AGENT_KEY, status: { in: ["CANDIDATE", "ACTIVE"] } },
    select: { id: true, details: true },
  });
  const unsupportedIds = stale.filter((row) => {
    const details = parseDetails(row.details);
    return details && !presentThemes.has(details.themeKey);
  }).map((row) => row.id);
  if (unsupportedIds.length) {
    await db.aIObservation.updateMany({ where: { id: { in: unsupportedIds } }, data: { status: "UNSUPPORTED" } });
    counts.unsupported += unsupportedIds.length;
  }
  const impacts = await reviewImpacts(coopId, now);
  await db.auditLog.create({
    data: auditLogEntry({
      actorId: "system/sage",
      action: "SAGE_COMMUNITY_MEMORY_CONSOLIDATED",
      resource: "CoopConfig",
      resourceId: config.id,
      metadata: { coopId, themes: byTheme.size, activeMembers: activeMembers.size, ...counts, impacts },
    }),
  }).catch(() => {});
  return { skipped: false as const, themes: byTheme.size, ...counts, impacts };
}

export async function retrieveCommunityInsights(coopId: string, purpose: string, now = new Date()) {
  const config = await db.coopConfig.findFirst({
    where: { coopId, isActive: true }, orderBy: { version: "desc" },
    select: { id: true, version: true, charterText: true, missionGoals: true },
  });
  if (!config) return [];
  const activeGoals = (Array.isArray(config.missionGoals) ? config.missionGoals : []) as MissionGoal[];
  const activeCharterHash = charterHash(config.charterText, activeGoals);
  const [rows, impactRows] = await Promise.all([
    db.aIObservation.findMany({
      where: {
        scopeType: "commons", scopeId: coopId, status: "ACTIVE", visibility: "SAGE_INTERNAL",
        generatedByAgentKey: COMMUNITY_MEMORY_AGENT_KEY,
        type: { in: ["commons_goal_signal", "community_wellbeing_signal"] },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { createdAt: "desc" }, take: 20,
      select: { id: true, summary: true, confidence: true, details: true },
    }),
    db.aIObservation.findMany({
      where: {
        scopeType: "commons", scopeId: coopId, status: "ACTIVE", visibility: "SAGE_INTERNAL",
        generatedByAgentKey: COMMUNITY_MEMORY_AGENT_KEY, type: "community_need_impact",
      },
      orderBy: { createdAt: "desc" }, take: 100,
      select: { details: true },
    }),
  ]);
  const discouragingReviews = new Map<string, number>();
  for (const row of impactRows) {
    const detail = row.details as { sourceObservationId?: unknown; outcome?: unknown } | null;
    if (typeof detail?.sourceObservationId !== "string" || !["NOT_HELPFUL", "NO_ACTION"].includes(String(detail.outcome))) continue;
    discouragingReviews.set(detail.sourceObservationId, (discouragingReviews.get(detail.sourceObservationId) ?? 0) + 1);
  }
  const valid = rows.filter((row) => {
    const details = parseDetails(row.details);
    return details?.evaluatedConfigId === config.id
      && details.evaluatedConfigVersion === config.version
      && details.charterSnapshotHash === activeCharterHash
      && (discouragingReviews.get(row.id) ?? 0) < 2;
  })
    .map((row) => ({ id: row.id, summary: row.summary, confidence: row.confidence }));
  await db.auditLog.create({
    data: auditLogEntry({
      actorId: "system/sage", action: "SAGE_COMMUNITY_MEMORY_READ", resource: "AIObservation", resourceId: coopId,
      metadata: { coopId, purpose, returned: valid.length },
    }),
  }).catch(() => {});
  return valid;
}

export async function runCommunityMemorySweep(options: { now?: Date; coopIds?: string[] } = {}) {
  const now = options.now ?? new Date();
  const configs = await db.coopConfig.findMany({
    where: { isActive: true, isDemo: false, ...(options.coopIds ? { coopId: { in: options.coopIds } } : {}) },
    select: { coopId: true }, distinct: ["coopId"],
  });
  const results: unknown[] = [];
  let failed = 0;
  for (const { coopId } of configs) {
    try {
      results.push({ coopId, ...(await consolidateCommonsMemory(coopId, now)) });
    } catch (error) {
      failed++;
      results.push({ coopId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { commons: configs.length, failed, results };
}
