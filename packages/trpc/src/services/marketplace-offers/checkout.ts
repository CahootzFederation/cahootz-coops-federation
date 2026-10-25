import { TRPCError } from "@trpc/server";

import { requireActiveMember } from "../commons-membership.js";
import { resolveStoreSettlementAccount } from "../funding-settlement-service.js";
import {
  createCommerceTransaction,
  createHostedCommerceCheckoutSession,
  type OfferCheckout,
} from "../payment-orchestration-service.js";
import { type Db, lockOffer, notFound, sumActiveUnits } from "./shared.js";

export type OfferCheckoutInput = {
  userId: string;
  offerId: string;
  quantity?: number;
  paymentUi: "payment_intent" | "hosted_checkout";
  successUrl?: string;
  cancelUrl?: string;
};

/**
 * Starts a Stripe checkout for a Member Deal or for a Group Buy whose payment
 * window is open. The member pays the member price with no markup; the rest of
 * the payment flow (destination charge, webhook, receipts) is the same as any
 * marketplace purchase.
 */
export async function startOfferCheckout(db: Db, input: OfferCheckoutInput, now = new Date()) {
  const offer = await db.marketplaceOffer.findUnique({
    where: { id: input.offerId },
    include: {
      product: { select: { id: true, name: true, kind: true } },
      store: { include: { business: { include: { stripeAccount: true } } } },
    },
  });
  if (!offer) notFound();
  await requireActiveMember(db, input.userId, offer.coopId);
  if (input.paymentUi === "hosted_checkout" && (!input.successUrl || !input.cancelUrl)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Hosted checkout needs a return address." });
  }

  const store = offer.store;
  const settlementAccount = (await resolveStoreSettlementAccount(store, db)) as { id: string; chargesEnabled: boolean } | null;
  if (store.status !== "APPROVED" || store.deletedAt || !store.business || !settlementAccount?.chargesEnabled) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `${store.name} can't take payments right now. Try again later, or ask a steward.`,
    });
  }

  const commitment =
    offer.offerType === "MEMBER_DEAL"
      ? await reserveDealPurchase(db, { offerId: offer.id, userId: input.userId, quantity: input.quantity ?? 1 }, now)
      : await requireGroupBuyPaymentSpot(db, { offerId: offer.id, userId: input.userId }, now);

  const offerCheckout: OfferCheckout = {
    offerId: offer.id,
    commitmentId: commitment.id,
    memberUnitCents: commitment.memberUnitCents,
    quantity: commitment.quantity,
    federationFeeBps: offer.federationFeeBps,
    commonsFeeBps: offer.commonsFeeBps,
  };
  const shared = {
    customerId: input.userId,
    businessId: store.business.id,
    settlementStripeAccountRecordId: settlementAccount.id,
    listedAmountCents: commitment.memberUnitCents * commitment.quantity,
    coopId: offer.coopId,
    applyTreasuryFee: true,
    currency: "USD",
    offer: offerCheckout,
    metadata: {
      items: [
        {
          productId: offer.product.id,
          name: offer.title,
          quantity: commitment.quantity,
          priceUSD: commitment.memberUnitCents / 100,
          regularPriceUSD: commitment.regularUnitCents / 100,
          kind: offer.product.kind,
        },
      ],
      isGuestCheckout: false,
      checkoutMode: offer.offerType === "MEMBER_DEAL" ? "MEMBER_DEAL" : "GROUP_BUY",
      offerId: offer.id,
    },
  };

  if (input.paymentUi === "hosted_checkout") {
    const result = await createHostedCommerceCheckoutSession({
      ...shared,
      successUrl: input.successUrl!,
      cancelUrl: input.cancelUrl!,
    });
    await linkTransaction(db, commitment.id, result.transaction.id);
    return checkoutResponse(result.transaction, { clientSecret: null, checkoutUrl: result.checkoutSession.url, checkoutSessionId: result.checkoutSession.id });
  }

  const result = await createCommerceTransaction(shared);
  await linkTransaction(db, commitment.id, result.transaction.id);
  return checkoutResponse(result.transaction, { clientSecret: result.paymentIntent.clientSecret, checkoutUrl: null, checkoutSessionId: null });
}

async function linkTransaction(db: Db, commitmentId: string, transactionId: string) {
  // A retry points the spot at the newest checkout. An older one that still gets
  // paid is caught in the webhook and refunded as a duplicate.
  await db.offerCommitment.update({
    where: { id: commitmentId },
    data: { commerceTransactionId: transactionId, status: "PAYMENT_PENDING" },
  });
}

function checkoutResponse(
  transaction: { id: string; chargedAmount: number; merchantSettlementAmount: number; treasuryFeeAmount: number },
  ui: { clientSecret: string | null; checkoutUrl: string | null; checkoutSessionId: string | null },
) {
  return {
    transactionId: transaction.id,
    ...ui,
    totalChargedCents: Math.round(transaction.chargedAmount * 100),
    merchantSettlementCents: Math.round(transaction.merchantSettlementAmount * 100),
    platformFeeCents: Math.round((transaction.chargedAmount - transaction.merchantSettlementAmount) * 100),
    treasuryFeeCents: Math.round(transaction.treasuryFeeAmount * 100),
    isDemoMode: false,
  };
}

/**
 * Holds a Member Deal unit for the member while they pay. One purchase per
 * member per deal in the pilot; a failed or abandoned payment can be retried.
 */
async function reserveDealPurchase(db: Db, params: { offerId: string; userId: string; quantity: number }, now: Date) {
  return db.$transaction(async (tx) => {
    await lockOffer(tx, params.offerId);
    const offer = await tx.marketplaceOffer.findUniqueOrThrow({ where: { id: params.offerId } });
    if (offer.status !== "LIVE" || !offer.expiresAt || offer.expiresAt <= now) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "This deal has ended." });
    }
    if (params.quantity < 1 || params.quantity > offer.quantityPerMember) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `You can buy up to ${offer.quantityPerMember} with this deal.` });
    }
    const existing = await tx.offerCommitment.findUnique({
      where: { offerId_userId: { offerId: offer.id, userId: params.userId } },
    });
    if (existing && (existing.status === "PAID" || existing.status === "FULFILLED")) {
      throw new TRPCError({ code: "CONFLICT", message: "You've already used this deal." });
    }
    const othersUnits = await sumActiveUnits(tx, offer.id, params.userId);
    if (offer.maximumQuantity != null && othersUnits + params.quantity > offer.maximumQuantity) {
      throw new TRPCError({ code: "CONFLICT", message: "This deal just sold out." });
    }
    const commitment = await tx.offerCommitment.upsert({
      where: { offerId_userId: { offerId: offer.id, userId: params.userId } },
      create: {
        offerId: offer.id,
        userId: params.userId,
        quantity: params.quantity,
        status: "PAYMENT_PENDING",
        regularUnitCents: offer.regularPriceCents,
        memberUnitCents: offer.memberPriceCents,
        committedAt: now,
      },
      update: { quantity: params.quantity, status: "PAYMENT_PENDING", cancelledAt: null },
    });
    await tx.marketplaceOffer.update({
      where: { id: offer.id },
      data: { committedQuantity: othersUnits + params.quantity },
    });
    return commitment;
  });
}

async function requireGroupBuyPaymentSpot(db: Db, params: { offerId: string; userId: string }, now: Date) {
  const offer = await db.marketplaceOffer.findUniqueOrThrow({ where: { id: params.offerId } });
  if (offer.status !== "PAYMENT_OPEN" || !offer.paymentDeadline || offer.paymentDeadline <= now) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Payment for this group buy isn't open." });
  }
  const commitment = await db.offerCommitment.findUnique({
    where: { offerId_userId: { offerId: offer.id, userId: params.userId } },
  });
  if (!commitment || (commitment.status !== "COMMITTED" && commitment.status !== "PAYMENT_PENDING")) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: commitment?.status === "PAID" ? "You've already paid for this one." : "Only members who committed can pay for this group buy.",
    });
  }
  return commitment;
}
