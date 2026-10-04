import { db } from "@repo/db";

import { createNotificationAndPush } from "./push-notification-service.js";
import { payloadHash } from "./sage-ride-match-agent.js";

/**
 * Consent-first introductions (Bridge). Sage proposes connecting a member who needs something with a
 * member whose profile says they can help. Nobody's details are shared and no circle is created until
 * both say yes: the person with the need first, then the helper. Then a private two-person circle is
 * created for them.
 */
export const INTRODUCTION_COOLDOWN_DAYS = 30;
const DAY_MS = 86_400_000;

export async function createIntroductionSuggestion(input: {
  coopId: string; needUserId: string; helperUserId: string; needSummary: string; reason: string; now?: Date;
}): Promise<{ created: boolean; actionId?: string; reason?: string }> {
  const now = input.now ?? new Date();
  if (input.needUserId === input.helperUserId) return { created: false, reason: "Same person" };
  const members = await db.userCoopMembership.findMany({
    where: { coopId: input.coopId, userId: { in: [input.needUserId, input.helperUserId] }, status: "ACTIVE", user: { isBot: false, deletedAt: null } },
    select: { userId: true },
  });
  if (members.length !== 2) return { created: false, reason: "Both people must be active members of this Commons" };

  const recent = await db.commonsAction.findFirst({
    where: {
      coopId: input.coopId, type: "CONNECT_MEMBERS", sourceType: "sage_introduction",
      createdAt: { gte: new Date(now.getTime() - INTRODUCTION_COOLDOWN_DAYS * DAY_MS) },
      AND: [{ participants: { some: { userId: input.needUserId } } }, { participants: { some: { userId: input.helperUserId } } }],
    },
    select: { id: true },
  });
  if (recent) return { created: false, actionId: recent.id, reason: "Sage suggested this introduction recently" };

  const payload = { circleName: "Introduction", needSummary: input.needSummary.slice(0, 300) };
  const hash = payloadHash(payload);
  const sourceId = `${input.needUserId}:${input.helperUserId}:${now.toISOString().slice(0, 10)}`;
  const action = await db.commonsAction.create({
    data: {
      coopId: input.coopId, sourceType: "sage_introduction", sourceId, sourcePostId: sourceId, sourceAuthorId: input.needUserId,
      contentHash: hash, position: 0, type: "CONNECT_MEMBERS", status: "PENDING",
      summary: `Introduction: ${input.needSummary.slice(0, 200)}`, evidence: input.reason.slice(0, 2000), confidence: 1,
      charterConfigId: "sage-introduction:v1", payload, payloadHash: hash, revision: 1,
      participants: { create: [{ userId: input.needUserId, role: "SUBJECT" }, { userId: input.helperUserId, role: "HELPER" }] },
      reviews: { create: {
        userId: input.needUserId, reviewType: "ACCEPT_INTRODUCTION", payloadHash: hash, status: "PENDING",
        presentationData: { message: `Sage can introduce you to a member whose profile says they can help with: ${input.needSummary.slice(0, 200)}. Want the introduction? Nothing is shared until you both say yes.` },
      } },
      auditEvents: { create: { eventType: "SUGGESTION_CREATED", metadata: { kind: "introduction" } } },
    },
    select: { id: true },
  });
  await createNotificationAndPush(db, {
    userId: input.needUserId, coopId: input.coopId, type: "SAGE_SUGGESTION_NEEDS_YOU",
    title: "Sage can introduce you to someone", body: `Someone here may be able to help with ${input.needSummary.slice(0, 120)}.`,
    data: { actionId: action.id },
  }).catch((error) => console.error("Could not notify about introduction", error));
  return { created: true, actionId: action.id };
}

/** After the person with the need accepts, ask the helper. */
export async function askIntroductionHelper(actionId: string): Promise<boolean> {
  const action = await db.commonsAction.findUnique({ where: { id: actionId }, select: { id: true, coopId: true, payload: true, payloadHash: true } });
  const helper = await db.commonsActionParticipant.findFirst({ where: { actionId, role: "HELPER" }, select: { userId: true } });
  if (!action?.payloadHash || !helper) return false;
  const existing = await db.commonsActionReview.findFirst({ where: { actionId, userId: helper.userId, reviewType: "ACCEPT_INTRODUCTION" }, select: { id: true } });
  if (existing) return false;
  const needSummary = (action.payload as { needSummary?: string } | null)?.needSummary ?? "something";
  await db.commonsActionReview.create({
    data: {
      actionId, userId: helper.userId, reviewType: "ACCEPT_INTRODUCTION", payloadHash: action.payloadHash, status: "PENDING",
      presentationData: { message: `A member could use help with: ${needSummary}. Your profile says you might be able to help. Want to be introduced? If you both agree, you'll get a private circle together.` },
    },
  });
  await createNotificationAndPush(db, {
    userId: helper.userId, coopId: action.coopId, type: "SAGE_SUGGESTION_NEEDS_YOU",
    title: "Someone could use your help", body: `A member could use help with ${needSummary.slice(0, 120)}.`,
    data: { actionId },
  }).catch((error) => console.error("Could not notify introduction helper", error));
  return true;
}
