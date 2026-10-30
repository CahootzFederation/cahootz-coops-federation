import { auditLogEntry } from "../../lib/audit.js";
import { backfillProcessingFees, cancelOpenOfferCheckouts, refundOfferTransaction } from "./payments.js";
import type { OfferStripe } from "./charges.js";
import { chargeAfterGoal, refundPaidCommitments } from "./lifecycle.js";
import {
  type Db,
  formatCents,
  lockOffer,
  notifyCommitters,
  notifyOnce,
  sumActiveUnits,
  sumPaidUnits,
} from "./shared.js";
import { transitionOffer } from "./transitions.js";

const SYSTEM_ACTOR = "system:offer-sweep";
const HOUR = 60 * 60 * 1000;

export type OfferSweepResult = {
  groupBuysClosed: number;
  groupBuysExpired: number;
  remindersSent: number;
  groupBuysConfirmed: number;
  groupBuysFailed: number;
  refundsRetried: number;
  processingFeesFilled: number;
};

async function audit(db: Db, action: string, offerId: string, metadata?: Record<string, unknown>) {
  await db.auditLog.create({
    data: auditLogEntry({ actorId: SYSTEM_ACTOR, action, resource: "MarketplaceOffer", resourceId: offerId, metadata }),
  });
}

/**
 * Moves offers along when their dates pass. Runs every 15 minutes. Every step
 * claims its change with a status-matched update, so overlapping runs do the
 * work once; notices and refunds are deduped too.
 */
export async function runOfferSweep(db: Db, now = new Date(), stripe?: OfferStripe): Promise<OfferSweepResult> {
  const result: OfferSweepResult = {
    groupBuysClosed: 0,
    groupBuysExpired: 0,
    remindersSent: 0,
    groupBuysConfirmed: 0,
    groupBuysFailed: 0,
    refundsRetried: 0,
    processingFeesFilled: 0,
  };

  // 1. Group Buys whose commitment deadline passed: charge saved cards, or expired.
  const closingGroupBuys = await db.marketplaceOffer.findMany({
    where: { offerType: "GROUP_BUY", status: "LIVE", commitmentDeadline: { lte: now } },
  });
  for (const candidate of closingGroupBuys) {
    const outcome = await db.$transaction(async (tx) => {
      await lockOffer(tx, candidate.id);
      const offer = await tx.marketplaceOffer.findUniqueOrThrow({ where: { id: candidate.id } });
      if (offer.status !== "LIVE") return null;
      const units = await sumActiveUnits(tx, offer.id);
      const met = units >= (offer.minimumCommitments ?? Number.POSITIVE_INFINITY);
      const window = { paymentOpensAt: now, paymentDeadline: new Date(now.getTime() + offer.paymentWindowHours * HOUR) };
      const moved = await transitionOffer(tx, offer, met ? "PAYMENT_OPEN" : "EXPIRED", { committedQuantity: units, ...(met ? window : {}) });
      return moved ? { met, units } : null;
    });
    if (!outcome) continue;
    const offer = candidate;
    await audit(db, outcome.met ? "MARKETPLACE_OFFER_COMMITMENTS_CLOSED" : "MARKETPLACE_OFFER_EXPIRED", offer.id, { units: outcome.units });
    if (outcome.met) {
      result.groupBuysClosed++;
      await chargeAfterGoal(db, offer.id, stripe);
    } else {
      result.groupBuysExpired++;
      await notifyCommitters(db, offer, ["COMMITTED"], {
        kind: "expired",
        type: "GROUP_BUY_EXPIRED",
        title: `${offer.title} didn't happen this time`,
        body: `Not enough people committed by the deadline (${outcome.units} of ${offer.minimumCommitments}). You weren't charged.`,
      });
    }
  }

  // 2. Reminders for members whose saved card didn't go through, 24 hours and 2 hours before the deadline.
  const openWindows = await db.marketplaceOffer.findMany({
    where: { offerType: "GROUP_BUY", status: "PAYMENT_OPEN", paymentDeadline: { gt: now, lte: new Date(now.getTime() + 24 * HOUR) } },
  });
  for (const offer of openWindows) {
    const hoursLeft = (offer.paymentDeadline!.getTime() - now.getTime()) / HOUR;
    const kind = hoursLeft <= 2 ? "payment-reminder-2h" : "payment-reminder-24h";
    const unpaid = await db.offerCommitment.findMany({
      where: { offerId: offer.id, status: { in: ["COMMITTED", "PAYMENT_PENDING"] }, chargeError: { not: null } },
      select: { userId: true, quantity: true },
    });
    for (const commitment of unpaid) {
      const sent = await notifyOnce(db, {
        offer,
        userId: commitment.userId,
        kind,
        type: "GROUP_BUY_PAYMENT_REMINDER",
        title: hoursLeft <= 2 ? "Last call to pay" : "Reminder: pay for your group deal",
        body: `Pay ${formatCents(offer.memberPriceCents * commitment.quantity)} for ${offer.title} in the next ${hoursLeft <= 2 ? "2 hours" : "day"} to keep your spot.`,
      });
      if (sent) result.remindersSent++;
    }
  }

  // 3. Payment windows that closed: confirmed, or called off with refunds.
  const closedWindows = await db.marketplaceOffer.findMany({
    where: { offerType: "GROUP_BUY", status: "PAYMENT_OPEN", paymentDeadline: { lte: now } },
  });
  for (const candidate of closedWindows) {
    const outcome = await db.$transaction(async (tx) => {
      await lockOffer(tx, candidate.id);
      const offer = await tx.marketplaceOffer.findUniqueOrThrow({ where: { id: candidate.id } });
      if (offer.status !== "PAYMENT_OPEN") return null;
      const paidUnits = await sumPaidUnits(tx, offer.id);
      const met = paidUnits >= (offer.minimumPaidOrders ?? Number.POSITIVE_INFINITY);
      const moved = await transitionOffer(tx, offer, met ? "CONFIRMED" : "FAILED");
      if (!moved) return null;
      await tx.offerCommitment.updateMany({
        where: { offerId: offer.id, status: { in: ["COMMITTED", "PAYMENT_PENDING"] } },
        data: { status: "LAPSED" },
      });
      return { met, paidUnits };
    });
    if (!outcome) continue;
    const offer = candidate;
    await cancelOpenOfferCheckouts(db, offer.id, stripe).catch((error) => console.error("[Offers] Couldn't cancel open checkouts:", error));
    await audit(db, outcome.met ? "MARKETPLACE_OFFER_CONFIRMED" : "MARKETPLACE_OFFER_FAILED", offer.id, { paidUnits: outcome.paidUnits });
    await notifyCommitters(db, offer, ["LAPSED"], {
      kind: "lapsed",
      type: "GROUP_BUY_EXPIRED",
      title: `Payment for ${offer.title} closed`,
      body: "Your card didn't go through and the deadline passed, so your spot was released. You weren't charged."
    });
    if (outcome.met) {
      result.groupBuysConfirmed++;
      await notifyCommitters(db, offer, ["PAID"], {
        kind: "confirmed",
        type: "GROUP_BUY_CONFIRMED",
        title: `${offer.title} is a go`,
        body: "Enough people paid, so we're sending the order to the vendor. We'll tell you when it ships.",
      });
    } else {
      result.groupBuysFailed++;
      await refundPaidCommitments(db, offer.id, "Group deal didn't reach its paid minimum", SYSTEM_ACTOR, stripe);
      await notifyCommitters(db, offer, ["PAID", "REFUNDED"], {
        kind: "failed",
        type: "GROUP_BUY_FAILED_REFUNDED",
        title: `${offer.title} didn't happen`,
        body: `Only ${outcome.paidUnits} of the ${offer.minimumPaidOrders} needed were paid for. We're refunding your full payment.`,
      });
    }
  }

  // 4. Retry refunds that failed earlier.
  const stuckRefunds = await db.offerCommitment.findMany({
    where: {
      status: { in: ["PAID", "FULFILLED"] },
      refundError: { not: null },
      commerceTransactionId: { not: null },
      offer: { status: { in: ["FAILED", "CANCELLED"] } },
    },
    select: { commerceTransactionId: true },
  });
  for (const { commerceTransactionId } of stuckRefunds) {
    const retried = await refundOfferTransaction(
      db,
      { transactionId: commerceTransactionId!, reason: "Retrying a refund that failed", actorId: SYSTEM_ACTOR },
      stripe,
    );
    if (retried.refunded) result.refundsRetried++;
  }

  // 5. Stripe's fee, for payments whose webhook arrived before Stripe had it.
  result.processingFeesFilled = await backfillProcessingFees(db, stripe).catch((error) => {
    console.error("[Offers] Processing fee backfill failed:", error);
    return 0;
  });

  return result;
}
