import { db, type AdminRoleType, type Prisma } from "@repo/db";

import { createNotificationAndPush } from "./push-notification-service.js";
import { DecisionTrail } from "./sage-decision-trail.js";

/**
 * Routing important things to the person responsible (Guardian).
 *
 * The model only ever names a responsibility category. Code resolves the actual people from roles
 * (circle leader, admin roles), checks they're active, and falls back up the chain when nobody holds
 * the role. Alerts carry their evidence, are deduplicated, capped per recipient per day, expire, and
 * can be sent back with "Not for me". Sage never takes a disciplinary step: an alert only asks a
 * person to take a look.
 */
export type ResponsibilityCategory = "CIRCLE_LEADER" | "COMMONS_ADMIN" | "GOVERNANCE" | "TREASURY" | "SUPPORT";
export type RoutedCategory = ResponsibilityCategory | "PLATFORM_ADMIN";
export const RESPONSIBILITY_CATEGORIES: ResponsibilityCategory[] = ["CIRCLE_LEADER", "COMMONS_ADMIN", "GOVERNANCE", "TREASURY", "SUPPORT"];

export const ALERTS_PER_RECIPIENT_PER_DAY = 5;
export const ALERT_TTL_DAYS = 7;
const NOT_FOR_ME_MEMORY_DAYS = 90;
const MAX_RECIPIENTS = 2;
const DAY_MS = 86_400_000;

const ROLE_FOR: Record<Exclude<ResponsibilityCategory, "CIRCLE_LEADER">, AdminRoleType[]> = {
  COMMONS_ADMIN: ["SUPER_ADMIN"],
  GOVERNANCE: ["GOVERNANCE_ADMIN", "SUPER_ADMIN"],
  TREASURY: ["TREASURY_ADMIN", "SUPER_ADMIN"],
  SUPPORT: ["SUPPORT_ADMIN", "SUPER_ADMIN"],
};

/** Where an alert goes when nobody holds the role, or when someone says it isn't for them. */
export const FALLBACK: Record<RoutedCategory, RoutedCategory | null> = {
  CIRCLE_LEADER: "COMMONS_ADMIN", GOVERNANCE: "COMMONS_ADMIN", TREASURY: "COMMONS_ADMIN", SUPPORT: "COMMONS_ADMIN",
  COMMONS_ADMIN: "PLATFORM_ADMIN", PLATFORM_ADMIN: null,
};

const ROLE_LABEL: Record<RoutedCategory, string> = {
  CIRCLE_LEADER: "the circle's leader", COMMONS_ADMIN: "a Commons admin", GOVERNANCE: "a governance admin",
  TREASURY: "a treasury admin", SUPPORT: "a support admin", PLATFORM_ADMIN: "a platform admin",
};

async function activeMembers(coopId: string, userIds: string[]): Promise<Set<string>> {
  if (!userIds.length) return new Set();
  const rows = await db.userCoopMembership.findMany({
    where: { coopId, userId: { in: userIds }, status: "ACTIVE", user: { deletedAt: null, isBot: false } },
    select: { userId: true },
  });
  return new Set(rows.map((row) => row.userId));
}

/** People who recently said alerts of this category aren't for them. */
async function declinedRecently(coopId: string, category: RoutedCategory, now: Date): Promise<Set<string>> {
  const rows = await db.sageAlert.findMany({
    where: { coopId, category, status: "REROUTED", updatedAt: { gte: new Date(now.getTime() - NOT_FOR_ME_MEMORY_DAYS * DAY_MS) }, recipientUserId: { not: null } },
    select: { recipientUserId: true },
  });
  return new Set(rows.map((row) => row.recipientUserId!));
}

/**
 * Resolves a category to people, walking the fallback chain until someone eligible is found. Returns
 * the category that actually matched, and no people when it reaches the platform admin queue.
 */
export async function resolveResponsible(input: {
  coopId: string; category: RoutedCategory; circleId?: string | null; excludeUserIds?: string[]; now?: Date;
}): Promise<{ category: RoutedCategory; userIds: string[]; skipped: RoutedCategory[] }> {
  const now = input.now ?? new Date();
  const exclude = new Set(input.excludeUserIds ?? []);
  const skipped: RoutedCategory[] = [];
  let category: RoutedCategory | null = input.category;
  while (category && category !== "PLATFORM_ADMIN") {
    let candidates: string[] = [];
    if (category === "CIRCLE_LEADER") {
      if (input.circleId) {
        const group = await db.group.findUnique({ where: { id: input.circleId }, select: { coopId: true, leaderId: true } });
        if (group?.coopId === input.coopId && group.leaderId) candidates = [group.leaderId];
      }
    } else {
      const roles = ROLE_FOR[category];
      const rows = await db.adminRole.findMany({
        where: { coopId: input.coopId, role: { in: roles }, revokedAt: null }, select: { userId: true, role: true },
      });
      // The specific role first, then SUPER_ADMIN.
      candidates = rows.sort((a, b) => roles.indexOf(a.role) - roles.indexOf(b.role)).map((row) => row.userId);
    }
    const declined = await declinedRecently(input.coopId, category, now);
    const active = await activeMembers(input.coopId, candidates);
    const eligible = [...new Set(candidates)].filter((userId) => active.has(userId) && !exclude.has(userId) && !declined.has(userId));
    if (eligible.length) return { category, userIds: eligible.slice(0, MAX_RECIPIENTS), skipped };
    skipped.push(category);
    category = FALLBACK[category];
  }
  return { category: "PLATFORM_ADMIN", userIds: [], skipped };
}

export interface AlertEvidence {
  source: string;
  quote?: string;
  why: string;
  recommendation: string;
}

export interface RouteAlertInput {
  coopId: string;
  circleId?: string | null;
  category: RoutedCategory;
  subjectType: string;
  subjectId: string;
  postId?: string | null;
  severity: "LOW" | "MEDIUM" | "HIGH";
  title: string;
  body: string;
  evidence: AlertEvidence;
  dueAt?: Date | null;
  sourceActionId?: string | null;
  excludeUserIds?: string[];
  reroutedFromId?: string | null;
}

export type RouteResult =
  | { status: "DEDUPED"; alertId: string }
  | { status: "ROUTED"; category: RoutedCategory; alerts: Array<{ id: string; recipientUserId: string | null; delivered: boolean }> };

/** Routes one alert to the responsible people, recording the decision in a trail (agent "guardian"). */
export async function routeSageAlert(input: RouteAlertInput, now = new Date()): Promise<RouteResult> {
  const trail = new DecisionTrail({
    agent: "guardian", coopId: input.coopId, circleId: input.circleId ?? null, sourceType: "sage_alert", sourceId: input.subjectId,
    trigger: "ESCALATION", visibility: "ADMINS", observed: { title: input.title, content: input.evidence.source },
    relatedPostIds: input.postId ? [input.postId] : [],
  }).step("OBSERVED", `Something needs ${ROLE_LABEL[input.category]}: ${input.title}`);
  trail.step("EVIDENCE", "The evidence", { detail: [input.evidence.quote && `"${input.evidence.quote}"`, input.evidence.why].filter(Boolean).join("\n") });

  const existing = input.reroutedFromId ? null : await db.sageAlert.findFirst({
    where: {
      subjectType: input.subjectType, subjectId: input.subjectId, category: input.category,
      status: { in: ["SENT", "QUEUED", "ACKNOWLEDGED"] }, expiresAt: { gt: now },
    },
    select: { id: true },
  });
  if (!trail.policy("Not already raised", !existing, existing ? "An open alert about this already exists" : undefined)) {
    await trail.taken("Didn't alert anyone again", "INFO").result("Already raised", "INFO", "None.").setOutcome("Duplicate alert suppressed").save();
    return { status: "DEDUPED", alertId: existing!.id };
  }

  const resolved = await resolveResponsible({ coopId: input.coopId, category: input.category, circleId: input.circleId, excludeUserIds: input.excludeUserIds, now });
  trail.policy(`Found ${ROLE_LABEL[resolved.category]}`, resolved.userIds.length > 0 || resolved.category === "PLATFORM_ADMIN",
    resolved.skipped.length ? `Nobody available as ${resolved.skipped.map((category) => ROLE_LABEL[category]).join(", then ")}` : undefined);

  const expiresAt = new Date(now.getTime() + ALERT_TTL_DAYS * DAY_MS);
  const base = {
    coopId: input.coopId, circleId: input.circleId ?? null, category: resolved.category, subjectType: input.subjectType,
    subjectId: input.subjectId, postId: input.postId ?? null, severity: input.severity, title: input.title.slice(0, 160),
    body: input.body.slice(0, 2000),
    evidence: { ...input.evidence, why: `${input.evidence.why} You're getting this as ${ROLE_LABEL[resolved.category]}.` } as unknown as Prisma.InputJsonValue,
    dueAt: input.dueAt ?? null, expiresAt, sourceActionId: input.sourceActionId ?? null, reroutedFromId: input.reroutedFromId ?? null,
  };

  const alerts: Array<{ id: string; recipientUserId: string | null; delivered: boolean }> = [];
  if (!resolved.userIds.length) {
    const queued = await db.sageAlert.create({ data: { ...base, recipientUserId: null, status: "QUEUED" }, select: { id: true } });
    alerts.push({ id: queued.id, recipientUserId: null, delivered: false });
    trail.taken("Added to the platform admin queue", "INFO");
  }
  for (const userId of resolved.userIds) {
    const recent = await db.sageAlert.count({
      where: { recipientUserId: userId, createdAt: { gte: new Date(now.getTime() - DAY_MS) }, status: { not: "REROUTED" } },
    });
    const underCap = trail.policy(`Under the daily alert limit (${ALERTS_PER_RECIPIENT_PER_DAY})`, recent < ALERTS_PER_RECIPIENT_PER_DAY, `${recent} today`);
    const alert = await db.sageAlert.create({ data: { ...base, recipientUserId: userId, status: underCap ? "SENT" : "QUEUED" }, select: { id: true } });
    if (underCap) {
      await createNotificationAndPush(db, {
        userId, coopId: input.coopId, type: "SAGE_ALERT", title: input.title.slice(0, 120), body: input.body.slice(0, 200),
        data: { alertId: alert.id, coopId: input.coopId, ...(input.postId ? { postId: input.postId } : {}) },
      }).catch((error) => console.error("Could not deliver Sage alert", error));
    }
    alerts.push({ id: alert.id, recipientUserId: userId, delivered: underCap });
    trail.taken(underCap ? `Alerted ${ROLE_LABEL[resolved.category]}` : `Held for ${ROLE_LABEL[resolved.category]} (daily limit reached)`, underCap ? "PASS" : "INFO");
  }
  await trail.result(alerts.some((alert) => alert.delivered) ? "Delivered" : "Queued", "INFO",
    `They can act on it or say it's not for them. It expires ${expiresAt.toISOString().slice(0, 10)}.`)
    .setOutcome(`Routed to ${ROLE_LABEL[resolved.category]}`).save();
  return { status: "ROUTED", category: resolved.category, alerts };
}

/** "Not for me": the recipient sends it back, it moves up the chain, and the directory remembers. */
export async function rerouteSageAlert(alertId: string, userId: string, feedback: string | null, now = new Date()): Promise<RouteResult | null> {
  const alert = await db.sageAlert.findUnique({ where: { id: alertId } });
  if (!alert || alert.recipientUserId !== userId || !["SENT", "QUEUED", "ACKNOWLEDGED"].includes(alert.status)) return null;
  await db.sageAlert.update({ where: { id: alertId }, data: { status: "REROUTED", feedback: feedback?.slice(0, 500) ?? "Not for me" } });
  const next = FALLBACK[alert.category as RoutedCategory] ?? "PLATFORM_ADMIN";
  const chain = await db.sageAlert.findMany({
    where: { subjectType: alert.subjectType, subjectId: alert.subjectId, recipientUserId: { not: null } }, select: { recipientUserId: true },
  });
  const evidence = alert.evidence as unknown as AlertEvidence;
  return routeSageAlert({
    coopId: alert.coopId, circleId: alert.circleId, category: next, subjectType: alert.subjectType, subjectId: alert.subjectId,
    postId: alert.postId, severity: alert.severity as RouteAlertInput["severity"], title: alert.title, body: alert.body,
    evidence: { ...evidence, why: evidence.why.replace(/ You're getting this as .*$/, "") }, dueAt: alert.dueAt,
    sourceActionId: alert.sourceActionId, reroutedFromId: alert.id,
    excludeUserIds: chain.map((row) => row.recipientUserId!),
  }, now);
}

export async function acknowledgeSageAlert(alertId: string, userId: string): Promise<boolean> {
  const result = await db.sageAlert.updateMany({ where: { id: alertId, recipientUserId: userId, status: { in: ["SENT", "QUEUED"] } }, data: { status: "ACKNOWLEDGED" } });
  return result.count > 0;
}

export async function expireSageAlerts(coopId: string, now = new Date()): Promise<number> {
  const result = await db.sageAlert.updateMany({ where: { coopId, status: { in: ["SENT", "QUEUED"] }, expiresAt: { lte: now } }, data: { status: "EXPIRED" } });
  return result.count;
}
