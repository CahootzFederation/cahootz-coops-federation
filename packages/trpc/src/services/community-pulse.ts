import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { Prisma } from "@repo/db";

// Explicit publication type. Never expose internal hypotheses or generic memory.
export const PULSE_TYPE = "community_pulse";
export const PulseFeedbackInput = z.object({
  coopId: z.string().min(1).max(100),
  observationId: z.string().min(1).max(100),
  response: z.enum(["YES", "PARTLY", "DIFFERENT_TAKE"]),
  comment: z.string().trim().max(500).nullable().optional(),
});
const PublishedDetails = z.object({
  title: z.string().max(200).optional(),
  basis: z.string().max(2000).optional(),
  uncertainty: z.string().max(1000).optional(),
});
const ownFeedback = { response: true, comment: true, updatedAt: true } as const;

async function requireMember(db: Prisma.TransactionClient, coopId: string, userId: string) {
  const member = await db.userCoopMembership.findFirst({
    where: { coopId, userId, status: "ACTIVE" }, select: { id: true },
  });
  if (!member) throw new TRPCError({ code: "FORBIDDEN", message: "Join this Commons to view its pulse." });
}
function eligible(coopId: string) {
  return {
    type: PULSE_TYPE, scopeType: "commons", scopeId: coopId,
    visibility: "COMMONS_MEMBERS" as const, status: "ACTIVE" as const,
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
  };
}

export async function listCommunityPulse(db: Prisma.TransactionClient, coopId: string, userId: string) {
  await requireMember(db, coopId, userId);
  const rows = await db.aIObservation.findMany({
    where: eligible(coopId), orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 5,
    select: {
      id: true, summary: true, details: true, createdAt: true,
      humanFeedback: { where: { userId }, select: ownFeedback },
    },
  });
  return { observations: rows.map(({ details, humanFeedback, ...row }) => {
    const published = PublishedDetails.safeParse(details);
    return {
      ...row,
      // Only fields deliberately published for Pulse, never raw metadata or source IDs.
      ...(published.success ? published.data : {}),
      feedback: humanFeedback[0] ?? null,
    };
  }) };
}

export async function saveHumanAIFeedback(
  db: Prisma.TransactionClient, userId: string, rawInput: z.input<typeof PulseFeedbackInput>,
) {
  const input = PulseFeedbackInput.parse(rawInput);
  await requireMember(db, input.coopId, userId);
  const observation = await db.aIObservation.findFirst({
    where: { ...eligible(input.coopId), id: input.observationId }, select: { id: true },
  });
  if (!observation) throw new TRPCError({ code: "NOT_FOUND", message: "This pulse is no longer available. Refresh to see the latest." });
  // Omitted comment preserves an existing explanation when changing the choice;
  // an explicit empty/null comment removes it. Native upsert handles duplicate taps.
  const comment = input.comment === undefined ? undefined : input.comment || null;
  return db.humanAIFeedback.upsert({
    where: { observationId_userId: { observationId: observation.id, userId } },
    create: { observationId: observation.id, coopId: input.coopId, userId, response: input.response, comment },
    update: { response: input.response, ...(comment !== undefined ? { comment } : {}) },
    select: ownFeedback,
  });
}
