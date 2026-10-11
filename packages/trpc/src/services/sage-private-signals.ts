import { createHash } from "node:crypto";

import { db } from "@repo/db";

import { auditLogEntry } from "../lib/audit.js";
import { recordObservation } from "./ai-memory.js";
import { routeSageAlert } from "./sage-responsibility.js";

export const MEMBER_SIGNAL_AGENT_KEY = "sage-member-signal";
export const PRIVATE_SAFETY_FLAG = "sage_private_safety_response";
const CHECKIN_WINDOW_MS = 14 * 86_400_000;

const URGENT_PATTERNS = [
  /\b(?:kill|hurt)\s+(?:myself|someone)\b/i,
  /\bsuicid(?:e|al)\b/i,
  /\bself[- ]?harm\b/i,
  /\bin immediate danger\b/i,
  /\bbeing (?:hurt|abused|threatened)\b/i,
];
const SENSITIVE_PATTERNS: Array<[string, RegExp]> = [
  ["medical", /\b(?:diagnos(?:is|ed)|medication|hospital|pregnan|therapy|therapist|medical|mental health)\b/i],
  ["legal", /\b(?:lawyer|lawsuit|court case|arrested|immigration status|restraining order)\b/i],
  ["financial", /\b(?:debt|bankruptcy|foreclosure|eviction|can't pay|cannot pay|overdraft)\b/i],
  ["relationship", /\b(?:divorce|breakup|custody|domestic violence|abusive partner)\b/i],
  ["identity", /\b(?:sexual orientation|gender identity|citizenship status|disability)\b/i],
  ["abuse", /\b(?:abuse|abused|assault|stalking|threatened)\b/i],
];

const THEMES: Array<{ key: string; category: string; label: string; pattern: RegExp }> = [
  { key: "transportation_access", category: "transportation", label: "transportation access", pattern: /\b(?:ride|rides|transport(?:ation)?|bus|carpool|getting there|pickup)\b/i },
  { key: "food_access", category: "food", label: "food access", pattern: /\b(?:food|grocer|meal|hungry|pantry)\b/i },
  { key: "housing_stability", category: "housing", label: "housing stability", pattern: /\b(?:housing|rent|landlord|home repair|place to live)\b/i },
  { key: "belonging_connection", category: "belonging", label: "belonging and connection", pattern: /\b(?:lonely|isolated|belong|connection|meet people|community)\b/i },
  { key: "time_and_workload", category: "time_pressure", label: "time and workload pressure", pattern: /\b(?:overwhelmed|too busy|schedule|childcare|time|workload)\b/i },
  { key: "safety_access", category: "safety", label: "access and safety", pattern: /\b(?:unsafe|safety|lighting|harassment)\b/i },
  { key: "shared_resources", category: "resources", label: "shared tools or resources", pattern: /\b(?:tool|equipment|resource|borrow|share)\b/i },
  { key: "skills_and_help", category: "mutual_support", label: "skills and mutual help", pattern: /\b(?:need help|could help|skill|volunteer|support)\b/i },
];

export interface PrivateSignalClassification {
  urgent: boolean;
  sensitiveCategory: string | null;
  themeKey: string | null;
  wellbeingCategory: string | null;
  themeLabel: string | null;
  stance: "SUPPORT" | "CONTRADICT";
  rememberConsent: boolean;
  aggregationConsent: boolean;
}

export function classifyPrivateSignal(content: string): PrivateSignalClassification {
  const urgent = URGENT_PATTERNS.some((pattern) => pattern.test(content));
  const sensitiveCategory = SENSITIVE_PATTERNS.find(([, pattern]) => pattern.test(content))?.[0] ?? null;
  const theme = THEMES.find((candidate) => candidate.pattern.test(content)) ?? null;
  const rememberConsent = /\b(?:remember|keep (?:this|that) in mind|save this)\b/i.test(content);
  const aggregationConsent = /\b(?:anonymous|anonymously)\b/i.test(content)
    && /\b(?:share|use|include|community|commons|pattern)\b/i.test(content);
  const stance = /\b(?:no longer|not anymore|has been resolved|is resolved|isn't an issue|is not an issue)\b/i.test(content)
    ? "CONTRADICT" as const
    : "SUPPORT" as const;
  return {
    urgent,
    sensitiveCategory,
    themeKey: theme?.key ?? null,
    wellbeingCategory: theme?.category ?? null,
    themeLabel: theme?.label ?? null,
    stance,
    rememberConsent: rememberConsent || aggregationConsent,
    aggregationConsent,
  };
}

export function privateSafetyReply() {
  return "I'm really sorry you're dealing with this. I can't provide emergency help, but your immediate safety matters. If you're in immediate danger, contact local emergency services now. If you want, tell me whether you'd like help identifying a trusted person or support role in your Commons to contact; I won't share this without your permission.";
}

export function memoryConsentQuestion(classification: PrivateSignalClassification) {
  if (!classification.themeKey || classification.urgent || classification.sensitiveCategory || classification.rememberConsent) return null;
  return "Would you like me to remember that for future check-ins? I would only include it in broader Commons patterns if you separately ask me to use it anonymously.";
}

async function latestWeeklyCheckin(groupId: string, createdAt: Date) {
  return db.groupComment.findFirst({
    where: {
      groupId,
      systemKey: { startsWith: "sage-weekly:" },
      createdAt: { gte: new Date(createdAt.getTime() - CHECKIN_WINDOW_MS), lte: createdAt },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, content: true },
  });
}

async function relevantCommonsForCheckin(userId: string, checkinContent: string) {
  const memberships = await db.userCoopMembership.findMany({
    where: { userId, status: "ACTIVE" }, select: { coopId: true }, take: 50,
  });
  if (memberships.length <= 1) return memberships.map((membership) => membership.coopId);
  const configs = await db.coopConfig.findMany({
    where: { coopId: { in: memberships.map((membership) => membership.coopId) }, isActive: true },
    orderBy: { version: "desc" }, select: { coopId: true, name: true },
  });
  const normalized = checkinContent.toLocaleLowerCase();
  const matches = new Set(configs
    .filter((config) => {
      const name = config.name?.trim() ?? "";
      return name.length >= 3 && normalized.includes(name.toLocaleLowerCase());
    })
    .map((config) => config.coopId));
  return matches.size === 1 ? [...matches] : [];
}

async function priorSignalConfirmedBy(input: { groupId: string; userId: string; messageId: string; createdAt: Date; content: string }) {
  if (!/^\s*(?:yes|yeah|yep|please do|okay|ok|sure)\s*[.!]?\s*$/i.test(input.content)) return null;
  const prior = await db.groupComment.findMany({
    where: { groupId: input.groupId, id: { not: input.messageId }, createdAt: { lt: input.createdAt } },
    orderBy: { createdAt: "desc" }, take: 8,
    select: { id: true, authorId: true, content: true },
  });
  const offerIndex = prior.findIndex((message) => message.authorId !== input.userId && message.content.includes("Would you like me to remember that for future check-ins?"));
  if (offerIndex < 0) return null;
  const source = prior.slice(offerIndex + 1).find((message) => message.authorId === input.userId);
  if (!source) return null;
  const classification = classifyPrivateSignal(source.content);
  if (!classification.themeKey || classification.urgent || classification.sensitiveCategory) return null;
  return { sourceId: source.id, classification: { ...classification, rememberConsent: true, aggregationConsent: false } };
}

async function priorSafetyOfferAccepted(input: { groupId: string; userId: string; messageId: string; createdAt: Date; content: string }) {
  if (!/^\s*(?:yes|yeah|yep|please do|okay|ok|sure)\s*[.!]?\s*$/i.test(input.content)) return false;
  const prior = await db.groupComment.findMany({
    where: { groupId: input.groupId, id: { not: input.messageId }, createdAt: { lt: input.createdAt } },
    orderBy: { createdAt: "desc" }, take: 8,
    select: { authorId: true, content: true },
  });
  return prior.some((message) => message.authorId !== input.userId && message.content.includes("help identifying a trusted person or support role"));
}

/**
 * Classifies a reply before any aggregation path sees it. Exact text stays in
 * the DM. Only a consented, generalized theme becomes an observation.
 */
export async function handlePrivateCheckinSignal(input: {
  groupId: string;
  coopId: string;
  userId: string;
  messageId: string;
  content: string;
  createdAt: Date;
}) {
  const checkin = await latestWeeklyCheckin(input.groupId, input.createdAt);
  if (!checkin) {
    return { inCheckin: false, classification: classifyPrivateSignal(input.content), safetyReply: null, consentQuestion: null };
  }
  let classification = classifyPrivateSignal(input.content);
  let sourceIds = [input.messageId];
  if (await priorSafetyOfferAccepted(input)) {
    const relevantCoopIds = await relevantCommonsForCheckin(input.userId, checkin.content);
    await db.auditLog.create({
      data: auditLogEntry({
        actorId: input.userId, action: "SAGE_PRIVATE_SAFETY_CONTACT_CONSENTED", resource: "GroupComment", resourceId: input.messageId,
        metadata: { aggregationEligible: false, relevantCommonsResolved: relevantCoopIds.length === 1 },
      }),
    });
    if (relevantCoopIds.length === 1) {
      const member = await db.user.findUnique({ where: { id: input.userId }, select: { name: true, email: true } });
      const memberName = member?.name?.trim() || member?.email.split("@")[0] || "A member";
      const routed = await routeSageAlert({
        coopId: relevantCoopIds[0]!, category: "SUPPORT", subjectType: "member_safety_support", subjectId: input.userId,
        severity: "HIGH", title: "A member asked for private support",
        body: `${memberName} explicitly asked Sage to help contact an appropriate human support person.`,
        evidence: {
          source: "Explicit consent in a private Sage conversation (disclosure withheld)",
          why: "The member asked for human contact after Sage offered it.",
          recommendation: "Contact the member privately, confirm what help they want, and do not forward or summarize their disclosure.",
        },
      });
      await db.auditLog.create({
        data: auditLogEntry({
          actorId: "system/sage", action: "SAGE_PRIVATE_SAFETY_CONTACT_ROUTED", resource: "User", resourceId: input.userId,
          metadata: { coopId: relevantCoopIds[0], routeStatus: routed.status, aggregationEligible: false },
        }),
      });
      return {
        inCheckin: true, classification, safetyReply: "Thank you for saying yes. I’ve privately asked an appropriate support person to contact you; I did not include what you disclosed.", consentQuestion: null,
      };
    }
    return {
      inCheckin: true, classification, safetyReply: "Thank you for saying yes. I couldn't safely tell which Commons support team you meant, so I haven't shared anything. Tell me the Commons name if you want me to route the request.", consentQuestion: null,
    };
  }
  if (!classification.themeKey) {
    const confirmed = await priorSignalConfirmedBy(input);
    if (confirmed) {
      classification = confirmed.classification;
      sourceIds = [confirmed.sourceId, input.messageId];
    }
  }
  if (classification.urgent || classification.sensitiveCategory) {
    await db.auditLog.create({
      data: auditLogEntry({
        actorId: "system/sage",
        action: classification.urgent ? "SAGE_PRIVATE_SAFETY_DETECTED" : "SAGE_PRIVATE_SENSITIVE_EXCLUDED",
        resource: "GroupComment",
        resourceId: input.messageId,
        metadata: { coopId: input.coopId, category: classification.sensitiveCategory ?? "urgent", aggregationEligible: false },
      }),
    }).catch(() => {});
    const safetyEnabled = classification.urgent
      ? (await db.featureFlag.findUnique({ where: { key: PRIVATE_SAFETY_FLAG }, select: { enabled: true } }))?.enabled ?? false
      : false;
    if (safetyEnabled) {
      await db.auditLog.create({
        data: auditLogEntry({
          actorId: "system/sage", action: "SAGE_PRIVATE_SAFETY_RESPONSE_OFFERED", resource: "GroupComment", resourceId: input.messageId,
          metadata: { category: classification.sensitiveCategory ?? "urgent", aggregationEligible: false },
        }),
      });
    }
    return {
      inCheckin: true,
      classification,
      safetyReply: safetyEnabled ? privateSafetyReply() : null,
      consentQuestion: null,
    };
  }
  if (classification.themeKey && classification.rememberConsent) {
    const relevantCoopIds = await relevantCommonsForCheckin(input.userId, checkin.content);
    const sourceDate = input.createdAt.toISOString().slice(0, 10);
    const fingerprint = createHash("sha256").update(`${classification.themeKey}:${classification.stance}:${sourceDate}`).digest("hex").slice(0, 16);
    await recordObservation({
      type: classification.stance === "CONTRADICT" ? "member_need_resolution" : "member_need_signal",
      scopeType: "member",
      scopeId: input.userId,
      confidence: 1,
      summary: classification.stance === "CONTRADICT"
        ? `The member reported that ${classification.themeLabel} is no longer an active need.`
        : `The member reported a need related to ${classification.themeLabel}.`,
      details: {
        themeKey: classification.themeKey,
        wellbeingCategory: classification.wellbeingCategory,
        stance: classification.stance,
        aggregationConsent: classification.aggregationConsent,
        aggregationEligible: classification.aggregationConsent && relevantCoopIds.length === 1,
        relevantCoopIds,
        sourceDate,
        sourceFingerprint: fingerprint,
        sensitive: false,
        urgent: false,
      },
      sources: sourceIds.map((id) => ({ type: "group_comment", id })),
      visibility: "PRIVATE_TO_AUTHOR_SCOPE",
      status: "ACTIVE",
      expiresAt: new Date(input.createdAt.getTime() + 180 * 86_400_000),
      reviewAt: new Date(input.createdAt.getTime() + 90 * 86_400_000),
      generatedByAgentKey: MEMBER_SIGNAL_AGENT_KEY,
      systemKey: `member-signal:${input.messageId}`,
    }).catch((error) => {
      if (!(typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002")) throw error;
    });
    await db.auditLog.create({
      data: auditLogEntry({
        actorId: input.userId, action: "SAGE_PRIVATE_MEMORY_CONSENT_RECORDED", resource: "GroupComment", resourceId: input.messageId,
        metadata: { aggregationConsent: classification.aggregationConsent, aggregationEligible: classification.aggregationConsent && relevantCoopIds.length === 1 },
      }),
    }).catch(() => {});
  }
  return {
    inCheckin: true,
    classification,
    safetyReply: null,
    consentQuestion: memoryConsentQuestion(classification),
  };
}
