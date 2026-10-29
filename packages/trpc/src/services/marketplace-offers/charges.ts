import { TRPCError } from "@trpc/server";
import type Stripe from "stripe";

import type { ShippingAddress } from "@repo/validators/marketplace-offers";

import { auditLogEntry } from "../../lib/audit.js";
import { calculateOfferPricing } from "../checkout-pricing-service.js";
import { processSuccessfulPayment } from "../payment-orchestration-service.js";
import { handleOfferPaymentSucceeded } from "./payments.js";
import { type Db, formatCents, formatDate, notifyOnce } from "./shared.js";

/**
 * Cahootz collects every Group Buy payment in its own Stripe
 * account; vendors never sign up. A Group Buy member saves a card when they
 * commit, and that card is charged once the goal is met.
 */
export type OfferStripe = Pick<Stripe, "refunds" | "paymentIntents" | "checkout" | "charges" | "setupIntents" | "paymentMethods" | "customers">;

export async function offerStripe(): Promise<OfferStripe> {
  const StripeCtor = (await import("stripe")).default;
  return new StripeCtor(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2026-02-25.clover" });
}

// ── Saved address and card ───────────────────────────────

/** What the order form fills in for the member: their saved address and card. */
export async function myOrderDefaults(db: Db, userId: string) {
  const [address, card] = await Promise.all([
    db.userShippingAddress.findUnique({ where: { userId } }),
    defaultCard(db, userId),
  ]);
  return {
    shippingAddress: address
      ? { name: address.name, line1: address.line1, line2: address.line2, city: address.city, state: address.state, postalCode: address.postalCode }
      : null,
    card: card ? { brand: card.brand, last4: card.last4, expiryMonth: card.expiryMonth, expiryYear: card.expiryYear } : null,
  };
}

/** Saves the member's delivery address so the next order is filled in for them. */
export async function saveShippingAddress(db: Db, userId: string, address: ShippingAddress) {
  await db.userShippingAddress.upsert({
    where: { userId },
    create: { userId, ...address },
    update: address,
  });
}

async function defaultCard(db: Db, userId: string) {
  return db.paymentMethod.findFirst({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });
}

async function ensureCustomer(db: Db, userId: string, stripe: OfferStripe) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { stripeCustomerId: true, email: true, name: true } });
  if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "We couldn't find your account." });
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const customer = await stripe.customers.create({ email: user.email, name: user.name ?? undefined, metadata: { userId } });
  await db.user.update({ where: { id: userId }, data: { stripeCustomerId: customer.id } });
  return customer.id;
}

/**
 * Starts saving a card with Stripe. On the web the app shows Stripe's card form
 * (a SetupIntent); in the iPhone app it opens Stripe's own page (Checkout in
 * setup mode). Nothing is charged.
 */
export async function startCardSetup(
  db: Db,
  params: { userId: string; paymentUi: "payment_intent" | "hosted_checkout"; successUrl?: string; cancelUrl?: string },
  stripe?: OfferStripe,
) {
  const client = stripe ?? (await offerStripe());
  const customer = await ensureCustomer(db, params.userId, client);
  const metadata = { purpose: "offer-card", userId: params.userId };
  if (params.paymentUi === "hosted_checkout") {
    if (!params.successUrl || !params.cancelUrl) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Saving a card needs a return address." });
    }
    const session = await client.checkout.sessions.create({
      mode: "setup",
      customer,
      currency: "usd",
      payment_method_types: ["card"],
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      metadata,
    });
    return { setupId: session.id, clientSecret: null, checkoutUrl: session.url };
  }
  const intent = await client.setupIntents.create({ customer, usage: "off_session", payment_method_types: ["card"], metadata });
  return { setupId: intent.id, clientSecret: intent.client_secret, checkoutUrl: null };
}

/** Records the card once Stripe confirms it was saved, and makes it the member's default. */
export async function finishCardSetup(db: Db, params: { userId: string; setupId: string }, stripe?: OfferStripe) {
  const client = stripe ?? (await offerStripe());
  const user = await db.user.findUnique({ where: { id: params.userId }, select: { stripeCustomerId: true } });
  const notSaved = () => new TRPCError({ code: "BAD_REQUEST", message: "Your card wasn't saved. Please add it again." });
  if (!user?.stripeCustomerId) throw notSaved();

  let intent: Stripe.SetupIntent | null = null;
  if (params.setupId.startsWith("cs_")) {
    const session = await client.checkout.sessions.retrieve(params.setupId, { expand: ["setup_intent"] });
    if (session.customer !== user.stripeCustomerId) throw notSaved();
    intent = typeof session.setup_intent === "object" ? session.setup_intent : null;
  } else {
    intent = await client.setupIntents.retrieve(params.setupId);
  }
  const customerId = typeof intent?.customer === "string" ? intent.customer : intent?.customer?.id;
  const paymentMethodId = typeof intent?.payment_method === "string" ? intent.payment_method : intent?.payment_method?.id;
  if (!intent || intent.status !== "succeeded" || customerId !== user.stripeCustomerId || !paymentMethodId) throw notSaved();

  const method = await client.paymentMethods.retrieve(paymentMethodId);
  if (method.type !== "card" || !method.card) throw notSaved();
  const card = method.card;
  await db.$transaction([
    db.paymentMethod.updateMany({ where: { userId: params.userId }, data: { isDefault: false } }),
    db.paymentMethod.upsert({
      where: { stripePaymentMethodId: method.id },
      create: {
        userId: params.userId,
        stripePaymentMethodId: method.id,
        type: "card",
        last4: card.last4,
        brand: card.brand,
        expiryMonth: card.exp_month,
        expiryYear: card.exp_year,
        isDefault: true,
      },
      update: { isDefault: true },
    }),
  ]);
  return { brand: card.brand, last4: card.last4, expiryMonth: card.exp_month, expiryYear: card.exp_year };
}

/** The member's saved card, for committing to a Group Buy. Refuses if there isn't one. */
export async function requireSavedCard(db: Db, userId: string) {
  const card = await defaultCard(db, userId);
  if (!card) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Add a card first. We'll only charge it if the group buy happens." });
  }
  return card;
}

// ── Payments to Cahootz ──────────────────────────────────

type ChargeTarget = {
  offer: { id: string; title: string; coopId: string; offerType: string; vendorPayoutCents: number; commonsSplitBps: number };
  commitment: { id: string; userId: string; quantity: number; memberUnitCents: number; regularUnitCents: number };
};

/** The payment record, with the vendor's amount held for Cahootz to pay out by hand. */
async function createOfferTransaction(db: Db, { offer, commitment }: ChargeTarget) {
  const pricing = calculateOfferPricing({
    memberUnitCents: commitment.memberUnitCents,
    quantity: commitment.quantity,
    vendorUnitCents: offer.vendorPayoutCents,
    commonsSplitBps: offer.commonsSplitBps,
  });
  const transaction = await db.commerceTransaction.create({
    data: {
      customerId: commitment.userId,
      businessId: null,
      coopId: offer.coopId,
      listedAmount: pricing.listedAmount / 100,
      chargedAmount: pricing.chargedAmount / 100,
      merchantSettlementAmount: pricing.merchantSettlementAmount / 100,
      treasuryFeeAmount: pricing.treasuryFeeAmount / 100,
      federationFeeAmount: pricing.federationFeeAmount / 100,
      currency: "USD",
      status: "PENDING",
      platformMarkupBps: 0,
      treasuryFeeBps: offer.commonsSplitBps,
      offerId: offer.id,
      metadata: {
        items: [
          {
            name: offer.title,
            quantity: commitment.quantity,
            priceUSD: commitment.memberUnitCents / 100,
            regularPriceUSD: commitment.regularUnitCents / 100,
          },
        ],
        checkoutMode: offer.offerType,
        offerId: offer.id,
      },
    },
  });
  await db.offerCommitment.update({ where: { id: commitment.id }, data: { commerceTransactionId: transaction.id } });
  return { transaction, amountCents: pricing.chargedAmount };
}

function stripeMetadata(transactionId: string, target: ChargeTarget) {
  return {
    commerceTransactionId: transactionId,
    customerId: target.commitment.userId,
    offerId: target.offer.id,
    offerCommitmentId: target.commitment.id,
  };
}

function withReturnParams(url: string, transactionId: string) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}transactionId=${encodeURIComponent(transactionId)}&checkoutSessionId={CHECKOUT_SESSION_ID}`;
}

/**
 * A member pays now for a Group Buy spot whose saved card didn't go through.
 * The card is saved for their next order.
 */
export async function createOfferPayment(
  db: Db,
  target: ChargeTarget & { paymentUi: "payment_intent" | "hosted_checkout"; successUrl?: string; cancelUrl?: string },
  stripe?: OfferStripe,
) {
  const client = stripe ?? (await offerStripe());
  const customer = await ensureCustomer(db, target.commitment.userId, client);
  const { transaction, amountCents } = await createOfferTransaction(db, target);
  const metadata = stripeMetadata(transaction.id, target);

  if (target.paymentUi === "hosted_checkout") {
    const session = await client.checkout.sessions.create({
      mode: "payment",
      customer,
      success_url: withReturnParams(target.successUrl!, transaction.id),
      cancel_url: withReturnParams(target.cancelUrl!, transaction.id),
      client_reference_id: transaction.id,
      line_items: [
        {
          quantity: target.commitment.quantity,
          price_data: { currency: "usd", unit_amount: target.commitment.memberUnitCents, product_data: { name: target.offer.title } },
        },
      ],
      payment_intent_data: { setup_future_usage: "off_session", metadata },
      metadata,
    });
    await db.commerceTransaction.update({
      where: { id: transaction.id },
      data: { status: "PROCESSING", metadata: { ...(transaction.metadata as object), stripeCheckoutSessionId: session.id } },
    });
    return { transaction, amountCents, clientSecret: null, checkoutUrl: session.url, checkoutSessionId: session.id };
  }

  const intent = await client.paymentIntents.create({
    amount: amountCents,
    currency: "usd",
    customer,
    setup_future_usage: "off_session",
    automatic_payment_methods: { enabled: true, allow_redirects: "never" },
    metadata,
  });
  await db.commerceTransaction.update({
    where: { id: transaction.id },
    data: { stripePaymentIntentId: intent.id, status: "PROCESSING" },
  });
  return { transaction, amountCents, clientSecret: intent.client_secret, checkoutUrl: null, checkoutSessionId: null };
}

/**
 * Marks a payment done right away when Stripe confirms it on the spot, so an
 * automatic charge doesn't wait for the webhook. The webhook later finds it
 * already recorded.
 */
async function settleNow(db: Db, transactionId: string, intent: Stripe.PaymentIntent) {
  await processSuccessfulPayment({
    stripePaymentIntentId: intent.id,
    stripeChargeId: typeof intent.latest_charge === "string" ? intent.latest_charge : intent.latest_charge?.id ?? "",
    commerceTransactionId: transactionId,
  });
  await handleOfferPaymentSucceeded(db, transactionId);
}

function declineMessage(error: unknown) {
  const stripeError = error as { code?: string; decline_code?: string; message?: string };
  if (stripeError?.code === "authentication_required") return "Your bank wants to confirm this payment.";
  if (stripeError?.code === "card_declined" || stripeError?.decline_code) return "Your card was declined.";
  if (stripeError?.code === "expired_card") return "Your card has expired.";
  return "Your card didn't go through.";
}

/**
 * Charges one Group Buy member's saved card, off-session. Claimed first, so two
 * sweeps can't charge the same spot twice; Stripe also dedupes on the key.
 * A declined card leaves the spot open for the member to pay another way
 * before the payment deadline.
 */
export async function chargeSavedCard(db: Db, commitmentId: string, stripe?: OfferStripe) {
  const claimed = await db.offerCommitment.updateMany({
    where: { id: commitmentId, status: "COMMITTED", commerceTransactionId: null, chargeError: null },
    data: { status: "PAYMENT_PENDING" },
  });
  if (claimed.count === 0) return { outcome: "SKIPPED" as const };

  const commitment = await db.offerCommitment.findUniqueOrThrow({
    where: { id: commitmentId },
    include: { offer: true, user: { select: { stripeCustomerId: true } } },
  });
  const { offer } = commitment;
  const target: ChargeTarget = { offer, commitment };

  const fail = async (reason: string, transactionId?: string) => {
    if (transactionId) {
      await db.commerceTransaction.update({
        where: { id: transactionId },
        data: { status: "FAILED", failedAt: new Date(), failureReason: reason },
      });
    }
    await db.offerCommitment.update({
      where: { id: commitment.id },
      data: { status: "COMMITTED", chargeError: reason, commerceTransactionId: null },
    });
    await notifyOnce(db, {
      offer,
      userId: commitment.userId,
      kind: "charge-failed",
      type: "GROUP_BUY_PAYMENT_OPEN",
      title: `Your payment for ${offer.title} didn't go through`,
      body: `${reason} Pay ${formatCents(commitment.memberUnitCents * commitment.quantity)} in the app${offer.paymentDeadline ? ` by ${formatDate(offer.paymentDeadline)}` : ""} to keep your spot.`,
    });
    return { outcome: "FAILED" as const, reason };
  };

  if (!commitment.stripePaymentMethodId || !commitment.user.stripeCustomerId) {
    return fail("We didn't have a card saved for you.");
  }

  const { transaction, amountCents } = await createOfferTransaction(db, target);
  let intent: Stripe.PaymentIntent;
  try {
    const client = stripe ?? (await offerStripe());
    intent = await client.paymentIntents.create(
      {
        amount: amountCents,
        currency: "usd",
        customer: commitment.user.stripeCustomerId,
        payment_method: commitment.stripePaymentMethodId,
        off_session: true,
        confirm: true,
        metadata: stripeMetadata(transaction.id, target),
      },
      { idempotencyKey: `offer-charge:${commitment.id}` },
    );
  } catch (error) {
    console.warn(`[Offers] Saved card charge failed for ${commitment.id}:`, error instanceof Error ? error.message : error);
    return fail(declineMessage(error), transaction.id);
  }

  await db.commerceTransaction.update({
    where: { id: transaction.id },
    data: { stripePaymentIntentId: intent.id, status: "PROCESSING" },
  });
  await db.auditLog.create({
    data: auditLogEntry({
      actorId: "system:offer-charge",
      action: "OFFER_SAVED_CARD_CHARGED",
      resource: "MarketplaceOffer",
      resourceId: offer.id,
      metadata: { commitmentId: commitment.id, amountCents, status: intent.status },
    }),
  });
  if (intent.status === "succeeded") {
    await settleNow(db, transaction.id, intent);
    return { outcome: "PAID" as const };
  }
  // Processing: the webhook finishes it.
  return { outcome: "PROCESSING" as const };
}

/** Charges every committed member's saved card for a Group Buy that just opened payment. */
export async function chargeGroupBuy(db: Db, offerId: string, stripe?: OfferStripe) {
  const committed = await db.offerCommitment.findMany({
    where: { offerId, status: "COMMITTED", commerceTransactionId: null, chargeError: null },
    select: { id: true },
  });
  const result = { paid: 0, processing: 0, failed: 0 };
  for (const { id } of committed) {
    const outcome = await chargeSavedCard(db, id, stripe);
    if (outcome.outcome === "PAID") result.paid++;
    else if (outcome.outcome === "PROCESSING") result.processing++;
    else if (outcome.outcome === "FAILED") result.failed++;
  }
  return result;
}
