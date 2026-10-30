import { TRPCError } from "@trpc/server";

import { createOfferPayment, type OfferStripe } from "./charges.js";
import { type Db, memberCommonsFor, notFound } from "./shared.js";

export type OfferCheckoutInput = {
  userId: string;
  offerId: string;
  paymentUi: "payment_intent" | "hosted_checkout";
  successUrl?: string;
  cancelUrl?: string;
};

/**
 * Starts a payment for a Group Buy spot whose saved card didn't go through.
 * The member pays the group price with no markup, to Cahootz; the vendor is
 * paid by hand. Their address is already on the spot from when they committed.
 */
export async function startOfferCheckout(db: Db, input: OfferCheckoutInput, now = new Date(), stripe?: OfferStripe) {
  const offer = await db.marketplaceOffer.findUnique({ where: { id: input.offerId } });
  if (!offer || offer.offerType !== "GROUP_BUY") notFound();
  await memberCommonsFor(db, input.userId, offer);
  if (input.paymentUi === "hosted_checkout" && (!input.successUrl || !input.cancelUrl)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Hosted checkout needs a return address." });
  }

  const commitment = await requireGroupBuyPaymentSpot(db, { offerId: offer.id, userId: input.userId }, now);
  const payment = await createOfferPayment(
    db,
    { offer, commitment, paymentUi: input.paymentUi, successUrl: input.successUrl, cancelUrl: input.cancelUrl },
    stripe,
  );
  await db.offerCommitment.update({ where: { id: commitment.id }, data: { status: "PAYMENT_PENDING" } });
  const vendorCents = offer.vendorPayoutCents * commitment.quantity;
  return {
    transactionId: payment.transaction.id,
    clientSecret: payment.clientSecret,
    checkoutUrl: payment.checkoutUrl,
    checkoutSessionId: payment.checkoutSessionId,
    totalChargedCents: payment.amountCents,
    merchantSettlementCents: vendorCents,
    platformFeeCents: payment.amountCents - vendorCents,
    treasuryFeeCents: Math.round(payment.transaction.treasuryFeeAmount * 100),
    isDemoMode: false,
  };
}

/** The name and phone the vendor gets with the order. */
export async function contactFor(db: Db, userId: string, phone?: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { name: true, nickname: true, handle: true, phone: true },
  });
  return {
    contactName: user?.name || user?.nickname || user?.handle || "A member",
    contactPhone: phone?.trim() || user?.phone || null,
  };
}

async function requireGroupBuyPaymentSpot(db: Db, params: { offerId: string; userId: string }, now: Date) {
  const offer = await db.marketplaceOffer.findUniqueOrThrow({ where: { id: params.offerId } });
  if (offer.status !== "PAYMENT_OPEN" || !offer.paymentDeadline || offer.paymentDeadline <= now) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Payment for this group deal isn't open." });
  }
  const commitment = await db.offerCommitment.findUnique({
    where: { offerId_userId: { offerId: offer.id, userId: params.userId } },
  });
  if (!commitment || (commitment.status !== "COMMITTED" && commitment.status !== "PAYMENT_PENDING")) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: commitment?.status === "PAID" ? "You've already paid for this one." : "Only members who committed can pay for this group deal.",
    });
  }
  return commitment;
}
