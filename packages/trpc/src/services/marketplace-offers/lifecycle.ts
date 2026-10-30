import { TRPCError } from "@trpc/server";

import { checkOfferMargin, makeOfferInputSchema, offerInputSchema, type OfferInput, type OfferStatus } from "@repo/validators/marketplace-offers";

import { auditLogEntry } from "../../lib/audit.js";
import { chargeGroupBuy, type OfferStripe } from "./charges.js";
import { cancelOpenOfferCheckouts, refundOfferTransaction, type StripeClient } from "./payments.js";
import { offerPricingSettings } from "./pricing-settings.js";
import {
  ACTIVE_COMMITMENT_STATUSES,
  type Db,
  formatCents,
  lockOffer,
  notFound,
  notifyCommitters,
  notifyOnce,
  PAID_COMMITMENT_STATUSES,
  sumActiveUnits,
} from "./shared.js";
import { requireTransition } from "./transitions.js";

async function audit(db: Db, actorId: string, action: string, offerId: string, metadata?: Record<string, unknown>) {
  await db.auditLog.create({
    data: auditLogEntry({ actorId, action, resource: "MarketplaceOffer", resourceId: offerId, metadata }),
  });
}

async function loadOffer(db: Db, offerId: string) {
  const offer = await db.marketplaceOffer.findUnique({ where: { id: offerId } });
  if (!offer) notFound();
  return offer;
}

function offerData(input: ReturnType<typeof offerInputSchema.parse>) {
  return input;
}

// ── Platform admin ───────────────────────────────────────

/** The offer rules with the admin's current minimum share, so no deal can lose the Commons or Cahootz money. */
async function parseOffer(db: Db, raw: OfferInput) {
  const { minShareCents } = await offerPricingSettings(db);
  return makeOfferInputSchema({ minShareCents }).parse(raw);
}

/**
 * A platform admin drafts an offer for one Commons. The vendor never signs up:
 * the offer just names them, and Cahootz collects the money and sends them the
 * orders.
 */
export async function createOffer(db: Db, actorId: string, coopId: string, raw: OfferInput) {
  const input = await parseOffer(db, raw);
  if (input.sourcedProductId && !(await db.sourcedProduct.findUnique({ where: { id: input.sourcedProductId }, select: { id: true } }))) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "We couldn't find the discovered item this offer came from. Start it again from Vendor outreach." });
  }
  const offer = await db.marketplaceOffer.create({
    data: {
      ...offerData(input),
      coopId,
      createdById: actorId,
    },
  });
  await audit(db, actorId, "MARKETPLACE_OFFER_CREATED", offer.id, { coopId, offerType: offer.offerType });
  if (offer.vendorProspectId) {
    // The outreach business that said yes now has a deal; the funnel counts it as converted.
    await db.vendorProspect.updateMany({
      where: { id: offer.vendorProspectId, convertedOfferId: null },
      data: { convertedOfferId: offer.id, status: "CONVERTED" },
    });
  }
  return offer;
}

/** Drafts can be edited freely. Once it's published, it's locked. */
export async function updateOffer(db: Db, actorId: string, offerId: string, raw: OfferInput) {
  const offer = await loadOffer(db, offerId);
  if (offer.status !== "DRAFT") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Only drafts can be edited. Cancel this offer and make a new one instead." });
  }
  const input = await parseOffer(db, raw);
  const updated = await db.marketplaceOffer.update({ where: { id: offer.id }, data: { ...offerData(input), stewardNote: null } });
  await audit(db, actorId, "MARKETPLACE_OFFER_UPDATED", offer.id);
  return updated;
}

/**
 * A platform admin publishes a draft, and members of that Commons see it right
 * away. There's no steward step: the admin set the deal up with the vendor.
 */
export async function publishOffer(db: Db, actorId: string, offerId: string, now = new Date()) {
  const offer = await loadOffer(db, offerId);
  const deadline = offer.commitmentDeadline;
  if (!deadline || deadline <= now) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "The end date has already passed. Edit the draft first." });
  }
  // Checked again here: the minimum share may have been raised since the draft was saved.
  const { minShareCents } = await offerPricingSettings(db);
  const margin = checkOfferMargin({ ...offer, minShareCents });
  if (!margin.ok) throw new TRPCError({ code: "BAD_REQUEST", message: `${margin.message} Edit the draft first.` });
  await requireTransition(db, offer, "LIVE", { publishedAt: now });
  await audit(db, actorId, "MARKETPLACE_OFFER_PUBLISHED", offer.id);
}

export async function pauseOffer(db: Db, actorId: string, offerId: string) {
  const offer = await loadOffer(db, offerId);
  await requireTransition(db, offer, "PAUSED");
  await audit(db, actorId, "MARKETPLACE_OFFER_PAUSED", offer.id);
}

export async function resumeOffer(db: Db, actorId: string, offerId: string) {
  const offer = await loadOffer(db, offerId);
  await requireTransition(db, offer, "LIVE");
  await audit(db, actorId, "MARKETPLACE_OFFER_RESUMED", offer.id);
}

/**
 * Ends a Group Buy's commitment period now instead of at the deadline and
 * charges everyone's saved card. Only allowed once the goal is met, so nobody
 * loses a deal that might still fill.
 */
export async function closeCommitmentsEarly(db: Db, actorId: string, offerId: string, stripe?: OfferStripe, now = new Date()) {
  const moved = await db.$transaction(async (tx) => {
    await lockOffer(tx, offerId);
    const offer = await tx.marketplaceOffer.findUnique({ where: { id: offerId } });
    if (!offer) notFound();
    const units = await sumActiveUnits(tx, offer.id);
    if (offer.offerType !== "GROUP_BUY" || units < (offer.minimumCommitments ?? Number.POSITIVE_INFINITY)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "This group buy hasn't hit its goal yet, so it can't close early." });
    }
    await requireTransition(tx, offer, "PAYMENT_OPEN", { committedQuantity: units, ...paymentWindow(offer, now) });
    return offer;
  });
  await audit(db, actorId, "MARKETPLACE_OFFER_CLOSED_EARLY", moved.id);
  return chargeAfterGoal(db, moved.id, stripe);
}

function paymentWindow(offer: { paymentWindowHours: number }, now: Date) {
  return { paymentOpensAt: now, paymentDeadline: new Date(now.getTime() + offer.paymentWindowHours * 60 * 60 * 1000) };
}

/**
 * The goal was met: tell everyone, then charge each saved card. A member whose
 * card is declined gets a notice and until the payment deadline to pay another
 * way. Used by the sweep at the deadline and by an admin closing early.
 */
export async function chargeAfterGoal(db: Db, offerId: string, stripe?: OfferStripe) {
  const offer = await loadOffer(db, offerId);
  await notifyCommitters(db, offer, ["COMMITTED"], {
    kind: "payment-open",
    type: "GROUP_BUY_PAYMENT_OPEN",
    title: `${offer.title} is happening`,
    body: `It reached its goal, so we're charging your saved card ${formatCents(offer.memberPriceCents)} each. We'll let you know when it ships.`,
  });
  return chargeGroupBuy(db, offer.id, stripe);
}

/** Cancels an offer at any point before it's finished and refunds everyone who paid. */
export async function cancelOffer(
  db: Db,
  actorId: string,
  offerId: string,
  reason: string,
  stripe?: StripeClient,
  now = new Date(),
) {
  const offer = await loadOffer(db, offerId);
  await requireTransition(db, offer, "CANCELLED", { cancelledAt: now, cancelReason: reason.slice(0, 500) });
  await audit(db, actorId, "MARKETPLACE_OFFER_CANCELLED", offer.id, { reason });
  const refunds = await refundPaidCommitments(db, offer.id, `Offer cancelled: ${reason}`, actorId, stripe);
  await cancelOpenOfferCheckouts(db, offer.id, stripe).catch(() => 0);
  await notifyCommitters(db, offer, ACTIVE_COMMITMENT_STATUSES, {
    kind: "offer-cancelled",
    type: "OFFER_CANCELLED",
    title: `${offer.title} was cancelled`,
    body: "We're sorry. If you paid, your full refund is on the way. If you didn't, you won't be charged.",
  });
  return refunds;
}

export async function refundPaidCommitments(
  db: Db,
  offerId: string,
  reason: string,
  actorId: string,
  stripe?: StripeClient,
) {
  const paid = await db.offerCommitment.findMany({
    where: { offerId, status: { in: [...PAID_COMMITMENT_STATUSES] }, commerceTransactionId: { not: null } },
    select: { commerceTransactionId: true },
  });
  let failed = 0;
  for (const { commerceTransactionId } of paid) {
    const result = await refundOfferTransaction(db, { transactionId: commerceTransactionId!, reason, actorId }, stripe);
    if (!result.refunded) failed++;
  }
  return { requested: paid.length, failed };
}

/** Refunds one member's payment, for a missing item or a member who can't pick up. */
export async function refundCommitment(db: Db, actorId: string, commitmentId: string, reason: string, stripe?: StripeClient) {
  const commitment = await db.offerCommitment.findUnique({ where: { id: commitmentId } });
  if (!commitment?.commerceTransactionId || !["PAID", "FULFILLED"].includes(commitment.status)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "That member hasn't paid, so there's nothing to refund." });
  }
  return refundOfferTransaction(db, { transactionId: commitment.commerceTransactionId, reason, actorId }, stripe);
}

const FULFILLMENT_NOTICES: Partial<Record<OfferStatus, { type: string; title: (t: string) => string; body: (o: { fulfillmentMethod: string; pickupLocation: string | null }) => string }>> = {
  ORDERED: {
    type: "OFFER_ORDERED",
    title: (title) => `${title} is ordered`,
    body: () => "We sent your order to the vendor. We'll tell you when it ships.",
  },
  READY: {
    type: "OFFER_READY",
    title: (title) => `${title} is on its way`,
    body: (offer) =>
      offer.fulfillmentMethod === "PICKUP"
        ? `Your order is ready for pickup${offer.pickupLocation ? ` at ${offer.pickupLocation}` : ""}.`
        : "The vendor shipped your order to the address you gave us.",
  },
};

/** Moves a confirmed Group Buy through ordered → shipped (READY) → finished. */
export async function updateFulfillment(db: Db, actorId: string, offerId: string, to: "ORDERED" | "READY" | "FULFILLED", now = new Date()) {
  const offer = await loadOffer(db, offerId);
  await requireTransition(db, offer, to);
  if (to === "FULFILLED") {
    await db.offerCommitment.updateMany({ where: { offerId, status: "PAID" }, data: { status: "FULFILLED", fulfilledAt: now } });
  }
  await audit(db, actorId, "MARKETPLACE_OFFER_STATUS_CHANGED", offer.id, { to });
  const notice = FULFILLMENT_NOTICES[to];
  if (notice) {
    await notifyCommitters(db, offer, ["PAID"], {
      kind: `fulfillment:${to}`,
      type: notice.type,
      title: notice.title(offer.title),
      body: notice.body(offer),
    });
  }
}

// ── Orders and vendor payouts ────────────────────────────

/**
 * Records a payment Cahootz made to the vendor by hand (check, Zelle, ACH).
 * What's owed is the vendor's amount for every unit paid for and not refunded.
 */
export async function recordVendorPayout(
  db: Db,
  actorId: string,
  offerId: string,
  payout: { amountCents: number; paidAt: Date; method: string; note?: string | null },
) {
  const offer = await loadOffer(db, offerId);
  if (!Number.isInteger(payout.amountCents) || payout.amountCents <= 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Enter the amount you paid the vendor." });
  }
  const row = await db.offerVendorPayout.create({
    data: {
      offerId: offer.id,
      amountCents: payout.amountCents,
      paidAt: payout.paidAt,
      method: payout.method.trim().slice(0, 60),
      note: payout.note?.trim().slice(0, 500) || null,
      recordedById: actorId,
    },
  });
  await audit(db, actorId, "OFFER_VENDOR_PAID", offer.id, { amountCents: payout.amountCents, method: row.method });
  return row;
}
