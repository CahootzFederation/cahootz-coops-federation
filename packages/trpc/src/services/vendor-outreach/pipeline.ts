import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { db as defaultDb } from "@repo/db";

import { auditLogEntry } from "../../lib/audit.js";
import { DEAL_INTEREST_SOURCE } from "./demand.js";
import { suppressProspect } from "./responses.js";

type Db = typeof defaultDb;

/**
 * Phase 5: people take it from here. Once a business says yes, a platform admin
 * talks with them, helps them open a shop, and creates the offer. These actions
 * record where each business stands.
 */
export const prospectActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("inTalks"), note: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal("converted"), offerId: z.string().min(1), note: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal("declined"), note: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal("doNotEmail"), note: z.string().trim().max(500).optional() }),
]);

export async function updateProspect(db: Db, actorId: string, prospectId: string, raw: z.input<typeof prospectActionSchema>) {
  const input = prospectActionSchema.parse(raw);
  const prospect = await db.vendorProspect.findUnique({ where: { id: prospectId } });
  if (!prospect) throw new TRPCError({ code: "NOT_FOUND", message: "We couldn't find that business." });

  if (input.action === "converted") {
    const offer = await db.marketplaceOffer.findUnique({ where: { id: input.offerId }, select: { id: true } });
    if (!offer) throw new TRPCError({ code: "BAD_REQUEST", message: "We couldn't find that offer. Paste the id from the offer's admin page." });
    await db.vendorProspect.update({ where: { id: prospectId }, data: { status: "CONVERTED", convertedOfferId: offer.id, statusNote: input.note ?? null } });
  } else if (input.action === "doNotEmail") {
    await suppressProspect(db, prospect, "ADMIN");
    if (input.note) await db.vendorProspect.update({ where: { id: prospectId }, data: { statusNote: input.note } });
  } else {
    await db.vendorProspect.update({
      where: { id: prospectId },
      data: { status: input.action === "inTalks" ? "IN_TALKS" : "DECLINED", statusNote: input.note ?? null },
    });
  }
  await db.auditLog.create({
    data: auditLogEntry({ actorId, action: `VENDOR_PROSPECT_${input.action.toUpperCase()}`, resource: "VendorProspect", resourceId: prospectId, metadata: input }),
  });
}

/** From a deal question to a live deal, across the platform. Public counts only. */
export async function outreachFunnel(db: Db = defaultDb) {
  const [questions, campaigns, prospectsByStatus, firstEmails, responses, converted] = await Promise.all([
    db.commonsAction.findMany({ where: { sourceType: DEAL_INTEREST_SOURCE, status: "PUBLISHED" }, select: { payload: true } }),
    db.vendorCampaign.groupBy({ by: ["status"], _count: { _all: true } }),
    db.vendorProspect.groupBy({ by: ["status"], _count: { _all: true } }),
    db.outreachMessage.groupBy({ by: ["status"], where: { step: "FIRST" }, _count: { _all: true } }),
    db.vendorResponse.groupBy({ by: ["interest"], _count: { _all: true } }),
    db.vendorProspect.findMany({ where: { status: "CONVERTED", convertedOfferId: { not: null } }, select: { convertedOfferId: true } }),
  ]);
  const count = <T extends { _count: { _all: number } }>(rows: T[], match: (row: T) => boolean) =>
    rows.filter(match).reduce((sum, row) => sum + row._count._all, 0);
  const liveOffers = converted.length
    ? await db.marketplaceOffer.count({ where: { id: { in: converted.map((row) => row.convertedOfferId!) }, status: { notIn: ["DRAFT", "PENDING_STEWARD", "CANCELLED", "EXPIRED", "FAILED"] } } })
    : 0;
  return {
    questionsAsked: questions.length,
    membersInterested: questions.reduce((sum, row) => sum + Number(((row.payload ?? {}) as { interestCount?: number }).interestCount ?? 0), 0),
    campaignsProposed: count(campaigns, () => true),
    campaignsApproved: count(campaigns, (row) => ["ACTIVE", "PAUSED", "COMPLETED", "EXPIRED"].includes(row.status)),
    businessesFound: count(prospectsByStatus, () => true),
    // Previews count as emailed: the business still got a reply link (and, in tests, answered on it).
    businessesEmailed: count(firstEmails, (row) => row.status === "SENT" || row.status === "DRY_RUN"),
    emailsDryRun: count(firstEmails, (row) => row.status === "DRY_RUN"),
    saidYes: count(responses, (row) => row.interest === "YES"),
    saidNotNow: count(responses, (row) => row.interest === "NOT_NOW"),
    unsubscribed: count(responses, (row) => row.interest === "UNSUBSCRIBE"),
    inTalks: count(prospectsByStatus, (row) => row.status === "IN_TALKS"),
    converted: count(prospectsByStatus, (row) => row.status === "CONVERTED"),
    dealsLive: liveOffers,
  };
}
