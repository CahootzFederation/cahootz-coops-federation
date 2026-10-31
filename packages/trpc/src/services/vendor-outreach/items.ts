import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { db as defaultDb } from "@repo/db";

import { auditLogEntry } from "../../lib/audit.js";
import { CAMPAIGN_DAYS, approveCampaignSchema } from "./campaigns.js";
import { dealCategoryByKey } from "./categories.js";
import { offerPricingSettings } from "../marketplace-offers/pricing-settings.js";
import { currentObservation, dealCategoryForItem, itemSnapshot, membersNeededFor, packLabel, suggestionFor } from "./item-questions.js";
import { checkOutreachText } from "./outreach-check.js";

type Db = typeof defaultDb;
const DAY_MS = 86_400_000;

function notFound(): never {
  throw new TRPCError({ code: "NOT_FOUND", message: "We couldn't find that item. Refresh and try again." });
}

async function audit(db: Db, actorId: string, action: string, resourceId: string, metadata?: Record<string, unknown>) {
  await db.auditLog.create({ data: auditLogEntry({ actorId, action, resource: "SourcedProduct", resourceId, metadata }) });
}

/**
 * Items the product-discovery bot found (docs/product-discovery.md) become
 * Group Buys by finding a seller: a platform admin approves an item for a
 * Commons, then starts an outreach campaign that looks for a local shop or the
 * supplier's wholesale contact. Cahootz never buys the stock itself. Sage's
 * weekly deal question can also name an approved item, and the answers count
 * toward a campaign the same way category questions do.
 */

// ── Platform admin ───────────────────────────────────────

/** Items waiting for review or already approved, with the price evidence behind them. */
export async function listItemsForAdmin(db: Db = defaultDb, now = new Date()) {
  const pricing = await offerPricingSettings(db);
  const matches = await db.commonsProductMatch.findMany({
    where: { status: { in: ["CANDIDATE", "APPROVED"] }, product: { status: { not: "REJECTED" } } },
    orderBy: [{ status: "asc" }, { fitScore: "desc" }, { createdAt: "desc" }],
    take: 200,
    include: {
      profile: { select: { id: true, key: true, name: true, coopId: true } },
      product: {
        include: {
          priceObservations: { orderBy: { observedAt: "desc" }, take: 1 },
          vendorCampaigns: { select: { id: true, coopId: true, status: true, endReason: true }, orderBy: { createdAt: "desc" } },
        },
      },
    },
  });
  return matches.map((match) => {
    const observation = match.product.priceObservations[0] ?? null;
    const expired = !!observation?.expiresAt && observation.expiresAt <= now;
    const suggestion = observation ? suggestionFor(observation, pricing) : null;
    return {
      profileId: match.profileId,
      productId: match.productId,
      profileName: match.profile.name,
      coopId: match.profile.coopId,
      status: match.status,
      fitScore: match.fitScore,
      fitReason: match.fitReason,
      purpose: match.purpose,
      foundAt: match.createdAt,
      goalFit: match.goalFit as "FITS" | "DOES_NOT_FIT" | null,
      goalFitReason: match.goalFitReason,
      name: match.product.name,
      brand: match.product.brand,
      supplierName: match.product.supplierName,
      category: match.product.category,
      categoryKey: dealCategoryForItem(match.product),
      description: match.product.description,
      sourceUrl: match.product.sourceUrl,
      imageUrl: match.product.imageUrl,
      price: observation
        ? {
            memberShare: observation.memberShare,
            peopleNeeded: observation.peopleNeeded,
            regularPriceCents: observation.regularPriceCents,
            bulkShareCents: observation.bulkShareCents,
            sourceUrl: observation.sourceUrl,
            comparisonUrl: observation.comparisonUrl,
            verifiedFacts: observation.verifiedFacts,
            risks: observation.risksOrUnverifiedClaims,
            observedAt: observation.observedAt,
            expired,
          }
        : null,
      // The deal we'd suggest, by the same price rule as every offer. Null when members wouldn't save anything.
      suggestion: suggestion && observation
        ? { ...suggestion, packLabel: packLabel(observation.memberShare, suggestion.packSize), membersNeeded: membersNeededFor(observation.peopleNeeded, suggestion.packSize) }
        : null,
      campaign: match.profile.coopId
        ? match.product.vendorCampaigns.find((campaign) => campaign.coopId === match.profile.coopId) ?? null
        : null,
      createdAt: match.createdAt,
    };
  });
}

export const reviewItemSchema = z.object({
  profileId: z.string().min(1),
  productId: z.string().min(1),
  decision: z.enum(["approve", "reject"]),
  /** Reject the item for every Commons, so the bot never brings it back. */
  everywhere: z.boolean().optional(),
});

/** A platform admin approves or rejects one discovered item for one Commons profile. */
export async function reviewItem(db: Db, actorId: string, raw: z.input<typeof reviewItemSchema>, now = new Date()) {
  const input = reviewItemSchema.parse(raw);
  const match = await db.commonsProductMatch.findUnique({
    where: { profileId_productId: { profileId: input.profileId, productId: input.productId } },
    include: { product: { select: { status: true } } },
  });
  if (!match) notFound();

  if (input.decision === "approve") {
    if (match.product.status === "REJECTED") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "This item was turned down everywhere, so it can't be approved." });
    }
    if (!(await currentObservation(db, input.productId, now))) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "This item's price is out of date. Wait for the next discovery run to check it again." });
    }
    const updated = await db.commonsProductMatch.updateMany({
      where: { profileId: input.profileId, productId: input.productId, status: { in: ["CANDIDATE", "PAUSED"] } },
      data: { status: "APPROVED", approvedBy: actorId, approvedAt: now },
    });
    if (updated.count === 0) throw new TRPCError({ code: "CONFLICT", message: "This item was already reviewed. Refresh to see it." });
    await db.sourcedProduct.updateMany({
      where: { id: input.productId, status: { in: ["CANDIDATE", "STALE"] } },
      data: { status: "VERIFIED", lastVerifiedAt: now },
    });
  } else {
    await db.commonsProductMatch.update({
      where: { profileId_productId: { profileId: input.profileId, productId: input.productId } },
      data: { status: "REJECTED", approvedBy: null, approvedAt: null },
    });
    if (input.everywhere) await db.sourcedProduct.update({ where: { id: input.productId }, data: { status: "REJECTED" } });
  }
  await audit(db, actorId, input.decision === "approve" ? "SOURCED_PRODUCT_APPROVED" : "SOURCED_PRODUCT_REJECTED", input.productId, {
    profileId: input.profileId,
    everywhere: input.everywhere ?? false,
  });
}

export const findSellerSchema = approveCampaignSchema.extend({
  profileId: z.string().min(1),
  productId: z.string().min(1),
  category: z.string().optional(),
});

/**
 * "Find a seller": a platform admin starts an outreach campaign for an approved
 * item. Starting it is the admin's approval, so it goes straight to ACTIVE and
 * Sage looks for sellers on the next hourly run, inside the usual limits.
 */
export async function startSellerSearch(db: Db, actorId: string, raw: z.input<typeof findSellerSchema>, now = new Date()) {
  const input = findSellerSchema.parse(raw);
  const match = await db.commonsProductMatch.findUnique({
    where: { profileId_productId: { profileId: input.profileId, productId: input.productId } },
    include: { profile: { select: { coopId: true } }, product: true },
  });
  if (!match) notFound();
  if (match.status !== "APPROVED") throw new TRPCError({ code: "BAD_REQUEST", message: "Approve this item before looking for a seller." });
  const coopId = match.profile.coopId;
  if (!coopId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "This item's profile isn't linked to a Commons yet, so there's no one to buy it." });
  }
  const observation = await currentObservation(db, match.productId, now);
  if (!observation) throw new TRPCError({ code: "BAD_REQUEST", message: "This item's price is out of date. Wait for the next discovery run to check it again." });
  const categoryKey = input.category && dealCategoryByKey(input.category) ? input.category : dealCategoryForItem(match.product);
  const open = await db.vendorCampaign.findFirst({
    where: { coopId, sourcedProductId: match.productId, status: { in: ["PROPOSED", "ACTIVE", "PAUSED"] } },
    select: { id: true },
  });
  if (open) throw new TRPCError({ code: "CONFLICT", message: "There's already a seller search for this item. Find it under Campaigns." });
  if (input.pitchPoints) {
    const check = checkOutreachText(input.pitchPoints, { maxChars: 300 });
    if (!check.ok) throw new TRPCError({ code: "BAD_REQUEST", message: `The extra line can't be used: ${check.reason}` });
  }

  const item = itemSnapshot(match.product, observation);
  const campaign = await db.vendorCampaign.create({
    data: {
      coopId,
      category: categoryKey,
      offerType: "GROUP_BUY",
      sourcedProductId: match.productId,
      searchTerms: input.searchTerms ?? [match.product.name, match.product.category, match.product.brand].filter((term) => term.trim().length >= 2).slice(0, 4),
      area: input.area,
      maxEmails: input.maxEmails ?? 10,
      maxSearches: input.maxSearches ?? 5,
      pitchPoints: input.pitchPoints ?? null,
      // No member answers behind it yet: an admin picked this item.
      demandEvidence: { source: "discovered_item", interestCount: 0, item },
      status: "ACTIVE",
      approvedById: actorId,
      approvedAt: now,
      expiresAt: new Date(now.getTime() + CAMPAIGN_DAYS * DAY_MS),
    },
  });
  await db.auditLog.create({
    data: auditLogEntry({ actorId, action: "VENDOR_CAMPAIGN_APPROVED", resource: "VendorCampaign", resourceId: campaign.id, metadata: { productId: match.productId, area: input.area } }),
  });
  return { campaignId: campaign.id };
}

/**
 * What the offer form fills in when a Group Buy starts from a discovered item:
 * the suggested deal, by the same price rule as every offer. The vendor amount
 * is the bot's bulk price, a starting point until the seller confirms theirs.
 * When card fees would eat most of the savings, the member price is left for
 * the admin to set. When it starts from a seller who said yes, the vendor's
 * name and contact come from their reply.
 */
export async function itemOfferDraft(db: Db, productId: string, now = new Date(), prospectId?: string | null) {
  const product = await db.sourcedProduct.findUnique({ where: { id: productId } });
  if (!product || product.status === "REJECTED") notFound();
  const prospect = prospectId
    ? await db.vendorProspect.findUnique({
        where: { id: prospectId },
        include: { responses: { orderBy: { respondedAt: "desc" }, take: 1 } },
      })
    : null;
  const reply = prospect?.responses[0];
  const observation = await currentObservation(db, productId, now);
  const suggestion = observation ? suggestionFor(observation, await offerPricingSettings(db)) : null;
  const packSize = suggestion?.packSize ?? 1;
  const observedOn = observation?.observedAt.toISOString().slice(0, 10);
  return {
    sourcedProductId: product.id,
    vendorProspectId: prospect?.id ?? null,
    vendorName: prospect?.businessName ?? null,
    vendorEmail: prospect?.email ?? null,
    vendorPhone: prospect?.phone ?? (reply?.bestContact && !reply.bestContact.includes("@") ? reply.bestContact : null),
    vendorContactName: reply?.contactName ?? null,
    imageUrl: product.imageUrl,
    title: (packSize > 1 ? `${packSize} × ${product.name}` : product.name).slice(0, 120),
    description: product.description.slice(0, 2000),
    regularPriceCents: suggestion?.regularPriceCents ?? observation?.regularPriceCents ?? null,
    memberPriceCents: suggestion?.qualifies ? suggestion.memberPriceCents : null,
    vendorPayoutCents: suggestion?.vendorPayoutCents ?? null,
    commonsSplitBps: 5000,
    minimumCommitments: observation ? membersNeededFor(observation.peopleNeeded, packSize) : null,
    memberShare: observation ? packLabel(observation.memberShare, packSize) : null,
    feesEatSavings: !!suggestion && !suggestion.qualifies,
    regularPriceSource: observation
      ? `${product.supplierName} price on ${observedOn}${packSize > 1 ? ` (${packSize} × $${(observation.regularPriceCents / 100).toFixed(2)})` : ""}: ${observation.sourceUrl}`.slice(0, 200)
      : null,
  };
}
