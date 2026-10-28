import { TRPCError } from "@trpc/server";

import { offerInputSchema, type OfferInput, type OfferStatus } from "@repo/validators/marketplace-offers";

import { auditLogEntry } from "../../lib/audit.js";
import { notifyStewards, requireSteward, stewardIdsFor } from "../commons-membership.js";
import { cancelOpenOfferCheckouts, refundOfferTransaction, type StripeClient } from "./payments.js";
import {
  ACTIVE_COMMITMENT_STATUSES,
  type Db,
  formatCents,
  formatDate,
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
  const offer = await db.marketplaceOffer.findUnique({
    where: { id: offerId },
    include: { store: { select: { id: true, name: true, ownerId: true } } },
  });
  if (!offer) notFound();
  return offer;
}

function offerData(input: ReturnType<typeof offerInputSchema.parse>) {
  const { productId: _productId, ...rest } = input;
  return {
    ...rest,
    // Fields that don't apply to this offer type are cleared, not left stale.
    ...(input.offerType === "MEMBER_DEAL"
      ? { minimumCommitments: null, minimumPaidOrders: null, commitmentDeadline: null }
      : { expiresAt: null }),
  };
}

// ── Platform admin ───────────────────────────────────────

/** A platform admin drafts an offer for one Commons, on a vendor's behalf. */
export async function createOffer(db: Db, actorId: string, coopId: string, raw: OfferInput) {
  const input = offerInputSchema.parse(raw);
  const product = await db.product.findUnique({
    where: { id: input.productId },
    include: { store: { select: { id: true, status: true, deletedAt: true, businessId: true } } },
  });
  if (!product || !product.isActive) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "That product isn't available. Pick another one." });
  }
  if (product.store.status !== "APPROVED" || product.store.deletedAt || !product.store.businessId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "That shop isn't approved to sell yet." });
  }
  if (input.sourcedProductId && !(await db.sourcedProduct.findUnique({ where: { id: input.sourcedProductId }, select: { id: true } }))) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "We couldn't find the discovered item this offer came from. Start it again from Vendor outreach." });
  }
  const offer = await db.marketplaceOffer.create({
    data: {
      ...offerData(input),
      coopId,
      productId: product.id,
      storeId: product.store.id,
      businessId: product.store.businessId,
      createdById: actorId,
    },
  });
  await audit(db, actorId, "MARKETPLACE_OFFER_CREATED", offer.id, { coopId, offerType: offer.offerType });
  return offer;
}

/** Drafts can be edited freely. Once a steward is looking at it, it's locked. */
export async function updateOffer(db: Db, actorId: string, offerId: string, raw: OfferInput) {
  const offer = await loadOffer(db, offerId);
  if (offer.status !== "DRAFT") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Only drafts can be edited. Cancel this offer and make a new one instead." });
  }
  const input = offerInputSchema.parse(raw);
  if (input.productId !== offer.productId || input.offerType !== offer.offerType) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "The product and offer type can't change. Make a new offer instead." });
  }
  const updated = await db.marketplaceOffer.update({ where: { id: offer.id }, data: { ...offerData(input), stewardNote: null } });
  await audit(db, actorId, "MARKETPLACE_OFFER_UPDATED", offer.id);
  return updated;
}

export async function submitForStewardApproval(db: Db, actorId: string, offerId: string, now = new Date()) {
  const offer = await loadOffer(db, offerId);
  const deadline = offer.offerType === "MEMBER_DEAL" ? offer.expiresAt : offer.commitmentDeadline;
  if (!deadline || deadline <= now) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "The end date has already passed. Edit the draft first." });
  }
  await requireTransition(db, offer, "PENDING_STEWARD");
  await audit(db, actorId, "MARKETPLACE_OFFER_SUBMITTED", offer.id);
  const stewardCount = (await stewardIdsFor(db, offer.coopId)).length;
  await notifyStewards(db, offer.coopId, {
    type: "OFFER_NEEDS_STEWARD_APPROVAL",
    title: "A new offer needs your OK",
    body: `${offer.store.name} wants to offer "${offer.title}" to your Commons. Take a look before members see it.`,
    data: { offerId: offer.id },
  });
  return { stewardCount };
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
 * Ends a Group Buy's commitment period now instead of at the deadline. Only
 * allowed once the goal is met, so nobody loses a deal that might still fill.
 */
export async function closeCommitmentsEarly(db: Db, actorId: string, offerId: string) {
  const moved = await db.$transaction(async (tx) => {
    await lockOffer(tx, offerId);
    const offer = await tx.marketplaceOffer.findUnique({ where: { id: offerId } });
    if (!offer) notFound();
    const units = await sumActiveUnits(tx, offer.id);
    if (offer.offerType !== "GROUP_BUY" || units < (offer.minimumCommitments ?? Number.POSITIVE_INFINITY)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "This group buy hasn't hit its goal yet, so it can't close early." });
    }
    await requireTransition(tx, offer, "AWAITING_VENDOR", { committedQuantity: units });
    return offer;
  });
  await audit(db, actorId, "MARKETPLACE_OFFER_CLOSED_EARLY", moved.id);
  await askVendorToConfirm(db, moved.id);
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

async function askVendorToConfirm(db: Db, offerId: string) {
  const offer = await loadOffer(db, offerId);
  await notifyOnce(db, {
    offer,
    userId: offer.store.ownerId,
    kind: "vendor-confirm",
    type: "VENDOR_OFFER_READY_TO_CONFIRM",
    title: "Your group buy hit its goal",
    body: `${offer.committedQuantity} committed to ${offer.title}. Confirm you can fill it, and we'll open payment for members.`,
  });
}

/**
 * The vendor (or a platform admin for them) confirms they can fill the order.
 * Members who committed then get a set window to pay.
 */
export async function openPayment(db: Db, actorId: string, offerId: string, now = new Date()) {
  const offer = await loadOffer(db, offerId);
  const paymentDeadline = new Date(now.getTime() + offer.paymentWindowHours * 60 * 60 * 1000);
  await requireTransition(db, offer, "PAYMENT_OPEN", { paymentOpensAt: now, paymentDeadline });
  await audit(db, actorId, "MARKETPLACE_OFFER_PAYMENT_OPENED", offer.id, { paymentDeadline });
  await notifyCommitters(db, offer, ["COMMITTED"], {
    kind: "payment-open",
    type: "GROUP_BUY_PAYMENT_OPEN",
    title: "Time to pay for your group buy",
    body: `${offer.title} is confirmed. Pay ${formatCents(offer.memberPriceCents)} each by ${formatDate(paymentDeadline)} to keep your spot.`,
  });
  return { paymentDeadline };
}

const FULFILLMENT_NOTICES: Partial<Record<OfferStatus, { type: string; title: (t: string) => string; body: (o: { fulfillmentMethod: string; pickupLocation: string | null }) => string }>> = {
  ORDERED: {
    type: "OFFER_ORDERED",
    title: (title) => `${title} is ordered`,
    body: () => "The vendor placed the order. We'll tell you when it's ready.",
  },
  READY: {
    type: "OFFER_READY",
    title: (title) => `${title} is ready`,
    body: (offer) =>
      offer.fulfillmentMethod === "DELIVERY"
        ? "Your order is out for delivery."
        : `Your order is ready for pickup${offer.pickupLocation ? ` at ${offer.pickupLocation}` : ""}.`,
  },
};

/** Moves a confirmed Group Buy through ordered → ready → finished. */
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

// ── Stewards ─────────────────────────────────────────────

export async function stewardApprove(db: Db, userId: string, offerId: string, now = new Date()) {
  const offer = await loadOffer(db, offerId);
  await requireSteward(db, userId, offer.coopId);
  const deadline = offer.offerType === "MEMBER_DEAL" ? offer.expiresAt : offer.commitmentDeadline;
  if (!deadline || deadline <= now) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "This offer's end date has passed. Send it back so it can be fixed." });
  }
  await requireTransition(db, offer, "LIVE", { stewardApprovedById: userId, stewardApprovedAt: now, publishedAt: now, stewardNote: null });
  await audit(db, userId, "MARKETPLACE_OFFER_STEWARD_APPROVED", offer.id);
}

export async function stewardSendBack(db: Db, userId: string, offerId: string, note: string) {
  const offer = await loadOffer(db, offerId);
  await requireSteward(db, userId, offer.coopId);
  await requireTransition(db, offer, "DRAFT", { stewardNote: note.slice(0, 1000) });
  await audit(db, userId, "MARKETPLACE_OFFER_STEWARD_SENT_BACK", offer.id, { note });
}

// ── Vendors ──────────────────────────────────────────────

export async function requireStoreOwner(db: Db, userId: string, offerId: string) {
  const offer = await loadOffer(db, offerId);
  if (offer.store.ownerId !== userId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only the shop owner can do that." });
  }
  return offer;
}

export async function vendorMarkPickedUp(db: Db, userId: string, commitmentId: string, now = new Date()) {
  const commitment = await db.offerCommitment.findUnique({ where: { id: commitmentId } });
  if (!commitment) throw new TRPCError({ code: "NOT_FOUND", message: "We couldn't find that order." });
  const offer = await requireStoreOwner(db, userId, commitment.offerId);
  const marked = await db.offerCommitment.updateMany({
    where: { id: commitment.id, status: "PAID" },
    data: { status: "FULFILLED", fulfilledAt: now },
  });
  if (marked.count === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Only paid orders can be marked picked up." });
  }
  await audit(db, userId, "OFFER_COMMITMENT_FULFILLED", offer.id, { commitmentId });
}
