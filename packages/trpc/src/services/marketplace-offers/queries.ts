import { TRPCError } from "@trpc/server";

import { estimateStripeFeeCents, offerSavings, splitOfferPayment } from "@repo/validators/marketplace-offers";

import { requireActiveMember } from "../commons-membership.js";
import {
  ACTIVE_COMMITMENT_STATUSES,
  type Db,
  MEMBER_VISIBLE_GROUP_BUY_STATUSES,
  notFound,
  PAID_COMMITMENT_STATUSES,
} from "./shared.js";
import { memberOfferView } from "./views.js";

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

const commitmentSelect = { quantity: true, status: true, savingsCents: true, committedAt: true, paidAt: true, chargeError: true } as const;

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
        { offerType: "GROUP_BUY", status: { in: [...MEMBER_VISIBLE_GROUP_BUY_STATUSES] } },
        { commitments: { some: { userId, status: { not: "CANCELLED" } } }, status: { notIn: ["DRAFT", "PENDING_STEWARD"] } },
      ],
    },
    include: { commitments: { where: { userId }, select: commitmentSelect } },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: 50,
  });
  return offers.map(({ commitments, ...offer }) => memberOfferView(offer, commitments[0] ?? null, now));
}

export async function getOfferForMember(db: Db, userId: string, offerId: string, now = new Date()) {
  const offer = await db.marketplaceOffer.findUnique({
    where: { id: offerId },
    include: { commitments: { where: { userId }, select: commitmentSelect } },
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
    include: { offer: { select: { id: true, title: true, offerType: true, coopId: true, vendorName: true } } },
    orderBy: { paidAt: "desc" },
  });
  return {
    totalSavingsCents: commitments.reduce((sum, c) => sum + c.savingsCents, 0),
    offers: commitments.map((c) => ({
      offerId: c.offer.id,
      title: c.offer.title,
      offerType: c.offer.offerType,
      vendorName: c.offer.vendorName,
      quantity: c.quantity,
      paidCents: c.memberUnitCents * c.quantity,
      savingsCents: c.savingsCents,
      paidAt: c.paidAt,
    })),
  };
}

// ── Money totals (for admins) ──────────────────────────

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

// ── Platform admin ───────────────────────────────────────

export async function listOffersForAdmin(db: Db, coopId: string) {
  const offers = await db.marketplaceOffer.findMany({
    where: { coopId },
    orderBy: { updatedAt: "desc" },
  });
  const money = await offerFinancials(db, offers.map((o) => o.id));
  return offers.map((offer) => ({ ...offer, ...offerSavings(offer.regularPriceCents, offer.memberPriceCents), split: unitSplit(offer), financials: money.get(offer.id)! }));
}

export async function getOfferForAdmin(db: Db, offerId: string) {
  const offer = await db.marketplaceOffer.findUnique({
    where: { id: offerId },
    include: {
      commitments: {
        include: { commerceTransaction: { select: { id: true, status: true, chargedAmount: true, refundedAmount: true, failureReason: true } } },
        orderBy: { committedAt: "asc" },
      },
      vendorPayouts: { orderBy: { paidAt: "desc" } },
    },
  });
  if (!offer) notFound();
  const money = await offerFinancials(db, [offer.id]);
  const exceptions = offer.commitments.filter(
    (c) => c.refundError || c.chargeError || c.status === "LAPSED" || c.commerceTransaction?.status === "FAILED",
  );
  const { commitments, vendorPayouts, ...rest } = offer;
  return {
    ...rest,
    ...offerSavings(offer.regularPriceCents, offer.memberPriceCents),
    split: unitSplit(offer),
    financials: money.get(offer.id)!,
    orders: offerOrders(commitments),
    vendorPay: vendorPayStatus(offer, commitments, vendorPayouts),
    vendorPayouts,
    exceptions: exceptions.map((c) => ({
      commitmentId: c.id,
      status: c.status,
      refundError: c.refundError,
      paymentFailure: c.chargeError ?? c.commerceTransaction?.failureReason ?? null,
    })),
  };
}

type OrderRow = {
  id: string;
  status: string;
  quantity: number;
  contactName: string | null;
  contactPhone: string | null;
  shippingAddress: unknown;
  paidAt: Date | null;
  fulfilledAt: Date | null;
  chargeError: string | null;
};

/**
 * Every order, paid ones first, for the admin to send to the vendor. Only
 * platform admins see this: it has members' names, phones and addresses.
 */
export function offerOrders(commitments: OrderRow[]) {
  const rank = (status: string) => (status === "PAID" ? 0 : status === "FULFILLED" ? 1 : 2);
  return commitments
    .filter((c) => c.status !== "CANCELLED")
    .sort((a, b) => rank(a.status) - rank(b.status))
    .map((c) => ({
      commitmentId: c.id,
      status: c.status,
      quantity: c.quantity,
      name: c.contactName ?? "A member",
      phone: c.contactPhone,
      address: (c.shippingAddress as { name: string; line1: string; line2: string | null; city: string; state: string; postalCode: string } | null) ?? null,
      paid: c.status === "PAID" || c.status === "FULFILLED",
      shipped: c.status === "FULFILLED",
      paidAt: c.paidAt,
      chargeError: c.chargeError,
    }));
}

/** What Cahootz owes the vendor: their amount for every unit paid for and kept, minus what's been paid. */
export function vendorPayStatus(
  offer: { vendorPayoutCents: number },
  commitments: { status: string; quantity: number }[],
  payouts: { amountCents: number }[],
) {
  const unitsSold = commitments
    .filter((c) => c.status === "PAID" || c.status === "FULFILLED")
    .reduce((sum, c) => sum + c.quantity, 0);
  const earnedCents = unitsSold * offer.vendorPayoutCents;
  const paidCents = payouts.reduce((sum, p) => sum + p.amountCents, 0);
  return { unitsSold, earnedCents, paidCents, owedCents: Math.max(0, earnedCents - paidCents) };
}

/** Totals for every offer, split by Commons and vendor, for the platform report. */
export async function offersReport(db: Db) {
  const offers = await db.marketplaceOffer.findMany({
    where: { status: { notIn: ["DRAFT"] } },
    select: { id: true, coopId: true, title: true, offerType: true, status: true, vendorName: true },
  });
  const money = await offerFinancials(db, offers.map((o) => o.id));
  return offers.map((offer) => ({
    offerId: offer.id,
    coopId: offer.coopId,
    title: offer.title,
    offerType: offer.offerType,
    status: offer.status,
    vendorName: offer.vendorName,
    ...money.get(offer.id)!,
  }));
}

export function assertCoop(offer: { coopId: string }, coopId: string) {
  if (offer.coopId !== coopId) throw new TRPCError({ code: "NOT_FOUND", message: "That offer isn't in this Commons." });
}
