import type Stripe from "stripe";

import { auditLogEntry } from "../../lib/audit.js";
import { createNotificationAndPush } from "../push-notification-service.js";
import { splitOfferPayment } from "@repo/validators/marketplace-offers";

import {
  recordFederationFee,
  recordFederationFeeRefund,
  recordFeeCollection,
  recordRefund,
  recordStripeFeeShortfall,
} from "../treasury-ledger-service.js";
import { type Db, formatCents, notifyOnce } from "./shared.js";

export type StripeClient = Pick<Stripe, "refunds" | "paymentIntents" | "checkout" | "charges">;

export async function defaultStripe(): Promise<Stripe> {
  const StripeCtor = (await import("stripe")).default;
  return new StripeCtor(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2026-02-25.clover" });
}

/**
 * Refunds one offer payment in full and pulls the vendor's share back from
 * their Stripe account. The ledger, savings and SC reversal happen when
 * Stripe sends charge.refunded, the same as any other refund.
 *
 * Safe to call twice: Stripe dedupes on the idempotency key. On failure the
 * error is saved on the commitment so admins see it and the sweep retries.
 */
export async function refundOfferTransaction(
  db: Db,
  params: { transactionId: string; reason: string; actorId: string },
  stripe?: StripeClient,
) {
  const transaction = await db.commerceTransaction.findUnique({
    where: { id: params.transactionId },
    select: { id: true, offerId: true, status: true, stripePaymentIntentId: true, offerCommitment: { select: { id: true } } },
  });
  if (!transaction?.offerId || !transaction.stripePaymentIntentId) return { refunded: false, reason: "NOT_AN_OFFER_PAYMENT" as const };
  if (transaction.status === "REFUNDED") return { refunded: true, reason: "ALREADY_REFUNDED" as const };

  try {
    const client = stripe ?? (await defaultStripe());
    await client.refunds.create(
      {
        payment_intent: transaction.stripePaymentIntentId,
        reverse_transfer: true,
        metadata: { commerceTransactionId: transaction.id, offerId: transaction.offerId, reason: params.reason },
      },
      { idempotencyKey: `offer-refund:${transaction.id}` },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Refund failed";
    console.error(`❌ [Offers] Refund failed for ${transaction.id}:`, error);
    if (transaction.offerCommitment) {
      await db.offerCommitment.update({ where: { id: transaction.offerCommitment.id }, data: { refundError: message.slice(0, 500) } });
    }
    return { refunded: false, reason: "STRIPE_ERROR" as const };
  }

  if (transaction.offerCommitment) {
    await db.offerCommitment.update({ where: { id: transaction.offerCommitment.id }, data: { refundError: null } });
  }
  await db.auditLog.create({
    data: auditLogEntry({
      actorId: params.actorId,
      action: "OFFER_REFUND_ISSUED",
      resource: "CommerceTransaction",
      resourceId: transaction.id,
      metadata: { offerId: transaction.offerId, reason: params.reason },
    }),
  });
  return { refunded: true, reason: "REQUESTED" as const };
}

/**
 * Called from the Stripe webhook once an offer payment succeeds. Marks the
 * member's commitment paid and records their saving. A payment that arrives
 * after the window closed, or a second payment for the same spot, is refunded.
 */
export async function handleOfferPaymentSucceeded(db: Db, transactionId: string, stripe?: StripeClient) {
  const transaction = await db.commerceTransaction.findUnique({
    where: { id: transactionId },
    include: { offer: { include: { store: { select: { ownerId: true } } } } },
  });
  const offer = transaction?.offer;
  if (!transaction || !offer) return { outcome: "NOT_AN_OFFER" as const };

  const commitment = await db.offerCommitment.findUnique({
    where: { offerId_userId: { offerId: offer.id, userId: transaction.customerId } },
  });

  const alreadyPaidElsewhere =
    !!commitment &&
    (commitment.status === "PAID" || commitment.status === "FULFILLED") &&
    commitment.commerceTransactionId !== transaction.id;
  const stillPayable =
    offer.offerType === "MEMBER_DEAL"
      ? ["LIVE", "PAUSED", "EXPIRED"].includes(offer.status) // started before the deal ended
      : offer.status === "PAYMENT_OPEN";
  // A slow Member Deal payment still counts after the sweep released its hold.
  const payableStatuses = offer.offerType === "MEMBER_DEAL" ? ["PAYMENT_PENDING", "COMMITTED", "CANCELLED"] : ["PAYMENT_PENDING", "COMMITTED"];
  const ownsSpot =
    !!commitment &&
    commitment.commerceTransactionId === transaction.id &&
    payableStatuses.includes(commitment.status);

  if (alreadyPaidElsewhere || !stillPayable || !ownsSpot) {
    if (commitment?.commerceTransactionId === transaction.id && commitment.status === "PAID") {
      return { outcome: "ALREADY_RECORDED" as const };
    }
    await refundOfferTransaction(
      db,
      { transactionId: transaction.id, reason: alreadyPaidElsewhere ? "Duplicate payment" : "Paid after the offer closed", actorId: "system:offer-webhook" },
      stripe,
    );
    await createNotificationAndPush(db, {
      userId: transaction.customerId,
      coopId: offer.coopId,
      type: "OFFER_REFUNDED",
      title: "We're refunding a payment",
      body: alreadyPaidElsewhere
        ? `You'd already paid for ${offer.title}, so we're refunding the extra ${formatCents(Math.round(transaction.chargedAmount * 100))}.`
        : `${offer.title} closed before your payment went through, so we're refunding ${formatCents(Math.round(transaction.chargedAmount * 100))}.`,
      data: { offerId: offer.id, coopId: offer.coopId },
    }).catch((error) => console.error("Failed to send late-payment notice:", error));
    return { outcome: "REFUNDED_LATE_OR_DUPLICATE" as const };
  }

  const savingsCents = Math.max(0, commitment.regularUnitCents - commitment.memberUnitCents) * commitment.quantity;
  const marked = await db.offerCommitment.updateMany({
    where: { id: commitment.id, status: { in: payableStatuses as any } },
    data: { status: "PAID", paidAt: new Date(), savingsCents, cancelledAt: null },
  });
  if (marked.count === 0) return { outcome: "ALREADY_RECORDED" as const };

  // Shares are recorded once Stripe's real fee is known (now, or by the sweep later).
  await finalizeOfferShares(db, transaction.id);

  await notifyOnce(db, {
    offer,
    userId: transaction.customerId,
    kind: `paid:${transaction.id}`,
    type: "OFFER_PAID",
    title: "You're all paid",
    body: `You paid ${formatCents(Math.round(transaction.chargedAmount * 100))} for ${offer.title} and saved ${formatCents(savingsCents)}.`,
  });
  await notifyOnce(db, {
    offer,
    userId: offer.store.ownerId,
    kind: `vendor-paid:${transaction.id}`,
    type: "VENDOR_OFFER_PAID",
    title: "New paid order",
    body: `${commitment.contactName ?? "A member"} paid for ${commitment.quantity} × ${offer.title}.`,
    push: offer.offerType === "MEMBER_DEAL",
  });
  return { outcome: "PAID" as const, savingsCents };
}

/**
 * Called from the Stripe webhook after a refund on an offer payment. A full
 * refund removes the saving; a partial refund shrinks it by the same share.
 */
export async function handleOfferPaymentRefunded(
  db: Db,
  params: { transactionId: string; refundedAmount: number; chargedAmount: number; incrementalRatio: number; idempotencyKey: string },
) {
  const transaction = await db.commerceTransaction.findUnique({
    where: { id: params.transactionId },
    include: { offer: true, offerCommitment: true },
  });
  if (!transaction?.offer) return;

  // Reverse what was actually credited for this payment, in proportion to the refund.
  // Shares not recorded yet (Stripe's fee wasn't known) get scaled down when they are.
  const credits = await db.treasuryLedgerEntry.findMany({
    where: { sourceTransactionId: transaction.id, direction: "CREDIT", sourceTransactionType: { in: ["COMMERCE_FEE", "FEDERATION_FEE"] } },
    select: { sourceTransactionType: true, amount: true },
  });
  const credited = (type: string) => credits.filter((entry) => entry.sourceTransactionType === type).reduce((sum, entry) => sum + entry.amount, 0);
  const commonsReversal = credited("COMMERCE_FEE") * params.incrementalRatio;
  const federationReversal = credited("FEDERATION_FEE") * params.incrementalRatio;
  if (commonsReversal > 0) {
    await recordRefund({
      sourceTransactionId: transaction.id,
      coopId: transaction.coopId,
      amount: commonsReversal,
      currency: transaction.currency,
      reason: "Member offer payment refunded",
      idempotencyKey: params.idempotencyKey,
    });
  }
  if (federationReversal > 0) {
    await recordFederationFeeRefund({
      sourceTransactionId: transaction.id,
      coopId: transaction.coopId,
      amount: federationReversal,
      currency: transaction.currency,
      idempotencyKey: params.idempotencyKey,
    });
  }

  const commitment = transaction.offerCommitment;
  if (!commitment) return;
  const isFull = params.refundedAmount >= params.chargedAmount;
  const fullSavings = Math.max(0, commitment.regularUnitCents - commitment.memberUnitCents) * commitment.quantity;
  const remainingShare = params.chargedAmount > 0 ? Math.max(0, 1 - params.refundedAmount / params.chargedAmount) : 0;
  await db.offerCommitment.update({
    where: { id: commitment.id },
    data: isFull
      ? { status: "REFUNDED", savingsCents: 0, refundedAt: new Date(), refundError: null }
      : { savingsCents: Math.floor(fullSavings * remainingShare) },
  });
  await notifyOnce(db, {
    offer: transaction.offer,
    userId: transaction.customerId,
    kind: `refunded:${params.idempotencyKey}`,
    type: "OFFER_REFUNDED",
    title: "Your refund is on the way",
    body: `We refunded ${formatCents(Math.round((params.chargedAmount * params.incrementalRatio) * 100))} for ${transaction.offer.title}. It usually shows on your card in 5–10 business days.`,
  });
}

/**
 * Fills in Stripe's processing fee on offer payments that don't have it yet.
 * With newer Stripe API versions the balance transaction often isn't ready when
 * payment_intent.succeeded arrives, so the webhook can't always read it.
 */
export async function backfillProcessingFees(db: Db, stripe?: StripeClient, limit = 50) {
  const missing = await db.commerceTransaction.findMany({
    where: {
      offerId: { not: null },
      processingFeeAmount: null,
      stripeChargeId: { not: null },
      status: { in: ["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"] },
    },
    select: { id: true, stripeChargeId: true },
    take: limit,
  });
  if (missing.length === 0) return 0;
  const client = stripe ?? (await defaultStripe());
  let filled = 0;
  for (const transaction of missing) {
    try {
      const charge = await client.charges.retrieve(transaction.stripeChargeId!, { expand: ["balance_transaction"] });
      const balance = charge.balance_transaction;
      if (balance && typeof balance === "object") {
        await db.commerceTransaction.update({ where: { id: transaction.id }, data: { processingFeeAmount: balance.fee / 100 } });
        await finalizeOfferShares(db, transaction.id);
        filled++;
      }
    } catch (error) {
      console.warn(`[Offers] Couldn't read the processing fee for ${transaction.id}:`, error instanceof Error ? error.message : error);
    }
  }
  return filled;
}

/**
 * Records the Commons and Cahootz shares of an offer payment using Stripe's real
 * fee: Stripe's fee comes off what the member paid, the vendor gets their fixed
 * amount, and what's left is split by the offer's commonsSplitBps. Waits until
 * Stripe's fee is known. Safe to run twice: each ledger write is idempotent.
 */
export async function finalizeOfferShares(db: Db, transactionId: string) {
  const transaction = await db.commerceTransaction.findUnique({
    where: { id: transactionId },
    include: { offer: { select: { commonsSplitBps: true } } },
  });
  if (!transaction?.offer || transaction.processingFeeAmount == null) return { finalized: false as const };
  if (!["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(transaction.status)) return { finalized: false as const };

  const cents = (dollars: number) => Math.round(dollars * 100);
  const split = splitOfferPayment({
    chargedCents: cents(transaction.chargedAmount),
    vendorCents: cents(transaction.merchantSettlementAmount),
    stripeFeeCents: cents(transaction.processingFeeAmount),
    commonsSplitBps: transaction.offer.commonsSplitBps,
  });
  await db.commerceTransaction.update({
    where: { id: transaction.id },
    data: { treasuryFeeAmount: split.commonsCents / 100, federationFeeAmount: split.cahootzCents / 100 },
  });

  // A refund that happened before this point already returned the money; only the kept part earns shares.
  const kept = transaction.chargedAmount > 0 ? Math.max(0, 1 - transaction.refundedAmount / transaction.chargedAmount) : 0;
  if (split.commonsCents > 0 && kept > 0) {
    await recordFeeCollection({
      sourceTransactionId: transaction.id,
      coopId: transaction.coopId,
      amount: (split.commonsCents / 100) * kept,
      currency: transaction.currency,
      metadata: { stripeFeeCents: split.stripeFeeCents, vendorCents: split.vendorCents, commonsSplitBps: transaction.offer.commonsSplitBps },
    });
  }
  if (split.cahootzCents > 0 && kept > 0) {
    await recordFederationFee({
      sourceTransactionId: transaction.id,
      coopId: transaction.coopId,
      amount: (split.cahootzCents / 100) * kept,
      currency: transaction.currency,
    });
  } else if (split.cahootzCents < 0) {
    // Stripe's fee was more than what was left after the vendor, so Cahootz covers the gap.
    await recordStripeFeeShortfall({
      sourceTransactionId: transaction.id,
      coopId: transaction.coopId,
      amount: -split.cahootzCents / 100,
      currency: transaction.currency,
    });
  }
  return { finalized: true as const, split };
}

/** Stops unpaid checkouts for an offer once its payment window closes. Best effort. */
export async function cancelOpenOfferCheckouts(db: Db, offerId: string, stripe?: StripeClient) {
  const open = await db.commerceTransaction.findMany({
    where: { offerId, status: { in: ["PENDING", "PROCESSING"] } },
    select: { id: true, stripePaymentIntentId: true, metadata: true },
  });
  if (open.length === 0) return 0;
  const client = stripe ?? (await defaultStripe());
  let cancelled = 0;
  for (const transaction of open) {
    const sessionId = (transaction.metadata as Record<string, unknown> | null)?.stripeCheckoutSessionId;
    try {
      if (typeof sessionId === "string") {
        await client.checkout.sessions.expire(sessionId);
      } else if (transaction.stripePaymentIntentId) {
        await client.paymentIntents.cancel(transaction.stripePaymentIntentId);
      }
      await db.commerceTransaction.update({
        where: { id: transaction.id },
        data: { status: "FAILED", failedAt: new Date(), failureReason: "Offer payment window closed" },
      });
      cancelled++;
    } catch (error) {
      // Already paid or already closed. A payment that slips through is refunded by the webhook.
      console.warn(`[Offers] Couldn't cancel checkout ${transaction.id}:`, error instanceof Error ? error.message : error);
    }
  }
  return cancelled;
}
