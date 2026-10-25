import { TRPCError } from "@trpc/server";

import { estimateStripeFeeCents, offerSavings, splitOfferPayment } from "@repo/validators/marketplace-offers";

import { requireActiveMember, requireSteward } from "../commons-membership.js";
import { requireStoreOwner } from "./lifecycle.js";
import {
  ACTIVE_COMMITMENT_STATUSES,
  type Db,
  MEMBER_VISIBLE_GROUP_BUY_STATUSES,
  notFound,
  PAID_COMMITMENT_STATUSES,
} from "./shared.js";
import { memberOfferView, offerInclude } from "./views.js";

/**
 * How one unit's price is split, with Stripe's fee estimated (2.9% + 30¢).
 * Recorded payments use Stripe's real fee.
 */
export function unitSplit(offer: { memberPriceCents: number; vendorPayoutCents: number; commonsSplitBps: number }) {
  const split = splitOfferPayment({
    chargedCents: offer.memberPriceCents,
    vendorCents: offer.vendorPayoutCents,
    stripeFeeCents: estimateStripeFeeCents(offer.memberPriceCents),
    commonsSplitBps: offer.commonsSplitBps,
  });
  return {
    memberPaysCents: split.chargedCents,
    estimatedStripeFeeCents: split.stripeFeeCents,
    vendorCents: split.vendorCents,
    commonsCents: split.commonsCents,
    cahootzCents: split.cahootzCents,
    commonsSplitBps: offer.commonsSplitBps,
  };
}

const commitmentSelect = { quantity: true, status: true, savingsCents: true, committedAt: true, paidAt: true } as const;

// ── Members ──────────────────────────────────────────────

/**
 * Offers a member can see in one Commons: live deals, Group Buys in progress,
 * and any offer they took part in (so they can see how it ended).
 */
export async function listOffersForMember(db: Db, userId: string, coopId: string, now = new Date()) {
  await requireActiveMember(db, userId, coopId);
  const offers = await db.marketplaceOffer.findMany({
    where: {
      coopId,
      OR: [
        { offerType: "MEMBER_DEAL", status: "LIVE", expiresAt: { gt: now } },
        { offerType: "GROUP_BUY", status: { in: [...MEMBER_VISIBLE_GROUP_BUY_STATUSES] } },
        { commitments: { some: { userId, status: { not: "CANCELLED" } } }, status: { notIn: ["DRAFT", "PENDING_STEWARD"] } },
      ],
    },
    include: { ...offerInclude, commitments: { where: { userId }, select: commitmentSelect } },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: 50,
  });
  return offers.map(({ commitments, ...offer }) => memberOfferView(offer, commitments[0] ?? null, now));
}

export async function getOfferForMember(db: Db, userId: string, offerId: string, now = new Date()) {
  const offer = await db.marketplaceOffer.findUnique({
    where: { id: offerId },
    include: { ...offerInclude, commitments: { where: { userId }, select: commitmentSelect } },
  });
  if (!offer || offer.status === "DRAFT" || offer.status === "PENDING_STEWARD") notFound();
  await requireActiveMember(db, userId, offer.coopId);
  const { commitments, ...rest } = offer;
  const mine = commitments[0] ?? null;
  if (offer.status === "PAUSED" && !mine) notFound();
  return memberOfferView(rest, mine, now);
}

/** Savings from offers the member actually paid for, net of refunds. */
export async function mySavings(db: Db, userId: string, coopId?: string) {
  const commitments = await db.offerCommitment.findMany({
    where: {
      userId,
      status: { in: [...PAID_COMMITMENT_STATUSES] },
      savingsCents: { gt: 0 },
      ...(coopId ? { offer: { coopId } } : {}),
    },
    include: { offer: { select: { id: true, title: true, offerType: true, coopId: true, store: { select: { name: true } } } } },
    orderBy: { paidAt: "desc" },
  });
  return {
    totalSavingsCents: commitments.reduce((sum, c) => sum + c.savingsCents, 0),
    offers: commitments.map((c) => ({
      offerId: c.offer.id,
      title: c.offer.title,
      offerType: c.offer.offerType,
      vendorName: c.offer.store.name,
      quantity: c.quantity,
      paidCents: c.memberUnitCents * c.quantity,
      savingsCents: c.savingsCents,
      paidAt: c.paidAt,
    })),
  };
}

// ── Money totals (shared by stewards, vendors and admins) ─

export type OfferFinancials = {
  grossChargedCents: number;
  refundedCents: number;
  vendorProceedsCents: number;
  federationRevenueCents: number;
  commonsRevenueCents: number;
  processingFeesCents: number;
  verifiedSavingsCents: number;
  paidOrders: number;
};

const toCents = (dollars: number) => Math.round(dollars * 100);

/**
 * Separate totals for one or more offers, all net of refunds. Only completed
 * payments count. Processing fees are what Stripe kept, where known.
 */
export async function offerFinancials(db: Db, offerIds: string[]): Promise<Map<string, OfferFinancials>> {
  const empty = (): OfferFinancials => ({
    grossChargedCents: 0,
    refundedCents: 0,
    vendorProceedsCents: 0,
    federationRevenueCents: 0,
    commonsRevenueCents: 0,
    processingFeesCents: 0,
    verifiedSavingsCents: 0,
    paidOrders: 0,
  });
  const totals = new Map(offerIds.map((id) => [id, empty()]));
  if (offerIds.length === 0) return totals;

  const [transactions, savings] = await Promise.all([
    db.commerceTransaction.findMany({
      where: { offerId: { in: offerIds }, status: { in: ["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"] } },
      select: {
        offerId: true,
        status: true,
        chargedAmount: true,
        refundedAmount: true,
        merchantSettlementAmount: true,
        treasuryFeeAmount: true,
        federationFeeAmount: true,
        processingFeeAmount: true,
      },
    }),
    db.offerCommitment.groupBy({
      by: ["offerId"],
      where: { offerId: { in: offerIds }, status: { in: [...PAID_COMMITMENT_STATUSES] } },
      _sum: { savingsCents: true },
    }),
  ]);

  for (const t of transactions) {
    const row = totals.get(t.offerId!)!;
    const kept = t.chargedAmount > 0 ? Math.max(0, 1 - t.refundedAmount / t.chargedAmount) : 0;
    row.grossChargedCents += toCents(t.chargedAmount);
    row.refundedCents += toCents(t.refundedAmount);
    row.vendorProceedsCents += toCents(t.merchantSettlementAmount * kept);
    row.federationRevenueCents += toCents(t.federationFeeAmount * kept);
    row.commonsRevenueCents += toCents(t.treasuryFeeAmount * kept);
    row.processingFeesCents += toCents(t.processingFeeAmount ?? 0);
    if (t.status !== "REFUNDED") row.paidOrders++;
  }
  for (const s of savings) totals.get(s.offerId)!.verifiedSavingsCents = s._sum.savingsCents ?? 0;
  return totals;
}

// ── Stewards: aggregate numbers only, never names ────────

export async function listOffersForSteward(db: Db, userId: string, coopId: string) {
  await requireSteward(db, userId, coopId);
  const offers = await db.marketplaceOffer.findMany({
    where: { coopId, status: { not: "DRAFT" } },
    include: offerInclude,
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
  const ids = offers.map((o) => o.id);
  const [committers, money] = await Promise.all([
    db.offerCommitment.groupBy({
      by: ["offerId"],
      where: { offerId: { in: ids }, status: { in: [...ACTIVE_COMMITMENT_STATUSES] } },
      _count: { _all: true },
    }),
    offerFinancials(db, ids),
  ]);
  const committerCount = new Map(committers.map((c) => [c.offerId, c._count._all]));
  return offers.map((offer) => {
    const totals = money.get(offer.id)!;
    return {
      id: offer.id,
      offerType: offer.offerType,
      status: offer.status,
      title: offer.title,
      description: offer.description,
      vendorName: offer.store.name,
      productName: offer.product.name,
      regularPriceCents: offer.regularPriceCents,
      regularPriceSource: offer.regularPriceSource,
      memberPriceCents: offer.memberPriceCents,
      ...offerSavings(offer.regularPriceCents, offer.memberPriceCents),
      split: unitSplit(offer),
      minimumCommitments: offer.minimumCommitments,
      minimumPaidOrders: offer.minimumPaidOrders,
      maximumQuantity: offer.maximumQuantity,
      quantityPerMember: offer.quantityPerMember,
      commitmentDeadline: offer.commitmentDeadline,
      paymentWindowHours: offer.paymentWindowHours,
      expiresAt: offer.expiresAt,
      fulfillmentMethod: offer.fulfillmentMethod,
      pickupLocation: offer.pickupLocation,
      redemptionRules: offer.redemptionRules,
      refundPolicy: offer.refundPolicy,
      substitutionPolicy: offer.substitutionPolicy,
      terms: offer.terms,
      // Aggregates only.
      committedQuantity: offer.committedQuantity,
      householdCount: committerCount.get(offer.id) ?? 0,
      paidOrders: totals.paidOrders,
      verifiedSavingsCents: totals.verifiedSavingsCents,
      commonsRevenueCents: totals.commonsRevenueCents,
    };
  });
}

// ── Vendors ──────────────────────────────────────────────

export async function listOffersForVendor(db: Db, userId: string) {
  const offers = await db.marketplaceOffer.findMany({
    where: { store: { ownerId: userId }, status: { notIn: ["DRAFT", "PENDING_STEWARD"] } },
    include: offerInclude,
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
  const money = await offerFinancials(db, offers.map((o) => o.id));
  return offers.map((offer) => {
    const totals = money.get(offer.id)!;
    return {
      id: offer.id,
      offerType: offer.offerType,
      status: offer.status,
      title: offer.title,
      productName: offer.product.name,
      memberPriceCents: offer.memberPriceCents,
      regularPriceCents: offer.regularPriceCents,
      split: unitSplit(offer),
      committedQuantity: offer.committedQuantity,
      minimumCommitments: offer.minimumCommitments,
      minimumPaidOrders: offer.minimumPaidOrders,
      commitmentDeadline: offer.commitmentDeadline,
      paymentDeadline: offer.paymentDeadline,
      expiresAt: offer.expiresAt,
      fulfillmentMethod: offer.fulfillmentMethod,
      pickupLocation: offer.pickupLocation,
      paidOrders: totals.paidOrders,
      vendorProceedsCents: totals.vendorProceedsCents,
    };
  });
}

/**
 * Who committed, for planning and pickup. Members agreed to share their name
 * and phone when they committed. No payment details.
 */
export async function vendorRoster(db: Db, userId: string, offerId: string) {
  const offer = await requireStoreOwner(db, userId, offerId);
  const commitments = await db.offerCommitment.findMany({
    where: { offerId: offer.id, status: { not: "CANCELLED" } },
    select: { id: true, contactName: true, contactPhone: true, quantity: true, status: true, committedAt: true, fulfilledAt: true },
    orderBy: { committedAt: "asc" },
  });
  return commitments.map((c) => ({
    commitmentId: c.id,
    name: c.contactName ?? "A member",
    phone: c.contactPhone,
    quantity: c.quantity,
    paid: c.status === "PAID" || c.status === "FULFILLED",
    pickedUp: c.status === "FULFILLED",
    status: c.status,
    committedAt: c.committedAt,
  }));
}

// ── Platform admin ───────────────────────────────────────

export async function listOffersForAdmin(db: Db, coopId: string) {
  const offers = await db.marketplaceOffer.findMany({
    where: { coopId },
    include: offerInclude,
    orderBy: { updatedAt: "desc" },
  });
  const money = await offerFinancials(db, offers.map((o) => o.id));
  return offers.map((offer) => ({ ...offer, ...offerSavings(offer.regularPriceCents, offer.memberPriceCents), split: unitSplit(offer), financials: money.get(offer.id)! }));
}

export async function getOfferForAdmin(db: Db, offerId: string) {
  const offer = await db.marketplaceOffer.findUnique({
    where: { id: offerId },
    include: {
      ...offerInclude,
      commitments: {
        include: { commerceTransaction: { select: { id: true, status: true, chargedAmount: true, refundedAmount: true, failureReason: true } } },
        orderBy: { committedAt: "asc" },
      },
    },
  });
  if (!offer) notFound();
  const money = await offerFinancials(db, [offer.id]);
  const exceptions = offer.commitments.filter(
    (c) => c.refundError || c.status === "LAPSED" || c.commerceTransaction?.status === "FAILED",
  );
  return {
    ...offer,
    ...offerSavings(offer.regularPriceCents, offer.memberPriceCents),
    split: unitSplit(offer),
    financials: money.get(offer.id)!,
    exceptions: exceptions.map((c) => ({
      commitmentId: c.id,
      status: c.status,
      refundError: c.refundError,
      paymentFailure: c.commerceTransaction?.failureReason ?? null,
    })),
  };
}

/** Totals for every offer, split by Commons and vendor, for the platform report. */
export async function offersReport(db: Db) {
  const offers = await db.marketplaceOffer.findMany({
    where: { status: { notIn: ["DRAFT"] } },
    select: { id: true, coopId: true, title: true, offerType: true, status: true, store: { select: { name: true } } },
  });
  const money = await offerFinancials(db, offers.map((o) => o.id));
  return offers.map((offer) => ({
    offerId: offer.id,
    coopId: offer.coopId,
    title: offer.title,
    offerType: offer.offerType,
    status: offer.status,
    vendorName: offer.store.name,
    ...money.get(offer.id)!,
  }));
}

export function assertCoop(offer: { coopId: string }, coopId: string) {
  if (offer.coopId !== coopId) throw new TRPCError({ code: "NOT_FOUND", message: "That offer isn't in this Commons." });
}
