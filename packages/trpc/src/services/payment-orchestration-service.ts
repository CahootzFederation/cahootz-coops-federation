/**
 * Payment Orchestration Service - Commerce transaction creation and Stripe Connect charges
 * 
 * Responsibilities:
 * - Create commerce transaction intents
 * - Calculate fee splits from FeeConfig
 * - Create Stripe payment intents with destination charges
 * - Link Stripe payment to internal commerce transaction
 * 
 * Uses Stripe Connect "Destination Charges" model:
 * - Platform charges customer
 * - Platform routes merchant share to connected account
 * - Platform retains treasury/platform fees automatically
 */

import { db } from '@repo/db';
import type Stripe from 'stripe';
import { TRPCError } from '@trpc/server';
import { calculateCheckoutPricing } from './checkout-pricing-service.js';

export { calculatePriceBreakdown } from './checkout-pricing-service.js';

/**
 * Get active fee configuration
 * 
 * @returns Active fee config
 */
export async function getActiveFeeConfig(): Promise<{
  id: string;
  platformMarkupBps: number;
  merchantFeeBps: number;
  treasuryFeeBps: number;
}> {
  const config = await db.feeConfig.findFirst({
    where: {
      isActive: true,
      effectiveFrom: {
        lte: new Date(),
      },
      OR: [
        { effectiveTo: null },
        { effectiveTo: { gt: new Date() } },
      ],
    },
    orderBy: {
      effectiveFrom: 'desc',
    },
  });

  if (!config) {
    // Default fallback config
    console.warn(`⚠️ [Payment Orchestration] No active fee config found, using defaults`);
    return {
      id: 'default',
      platformMarkupBps: 400, // 4%
      merchantFeeBps: 0,
      treasuryFeeBps: 400, // 4%
    };
  }

  return {
    id: config.id,
    platformMarkupBps: config.platformMarkupBps,
    merchantFeeBps: config.merchantFeeBps,
    treasuryFeeBps: config.treasuryFeeBps,
  };
}

/**
 * Create a commerce transaction and Stripe payment intent
 * 
 * @param params - Transaction parameters
 * @returns Created transaction and payment intent
 */
export async function createCommerceTransaction(params: {
  customerId: string;
  businessId: string;
  listedAmountCents: number;
  coopId: string;
  applyTreasuryFee?: boolean;
  currency?: string;
  metadata?: Record<string, unknown>;
}): Promise<{
  transaction: {
    id: string;
    listedAmount: number;
    chargedAmount: number;
    merchantSettlementAmount: number;
    treasuryFeeAmount: number;
  };
  paymentIntent: {
    id: string;
    clientSecret: string;
    amount: number;
    currency: string;
  };
  isDemoMode: boolean;
  storeOrderId?: string;
}> {
  const { customerId, businessId, listedAmountCents, applyTreasuryFee = true, currency = 'usd', metadata } = params;

  console.log(`💳 [Payment Orchestration] Creating commerce transaction: $${listedAmountCents / 100} for business ${businessId}`);

  // Get business and connected account
  const business = await db.business.findUnique({
    where: { id: businessId },
    include: {
      stripeAccount: true,
    },
  });

  if (!business) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Business not found',
    });
  }

  if (!business.stripeAccount) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Business does not have a Stripe Connect account',
    });
  }

  if (!business.stripeAccount.chargesEnabled) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Business is not yet enabled to accept charges',
    });
  }

  // Get active fee config
  const feeConfig = await getActiveFeeConfig();
  const pricing = calculateCheckoutPricing({
    listedAmountCents,
    feeConfig,
    applyTreasuryFee,
  });
  const breakdown = pricing.breakdown;

  console.log(`💰 [Payment Orchestration] Price breakdown:`, {
    listed: `$${breakdown.listedAmount / 100}`,
    charged: `$${breakdown.chargedAmount / 100}`,
    merchantSettlement: `$${breakdown.merchantSettlementAmount / 100}`,
    treasuryFee: `$${breakdown.treasuryFeeAmount / 100}`,
    platformFee: `$${breakdown.platformFeeAmount / 100}`,
  });

  // Create commerce transaction record
  const transaction = await db.commerceTransaction.create({
    data: {
      customerId,
      businessId,
      coopId: params.coopId,
      listedAmount: breakdown.listedAmount / 100, // Store as dollars
      chargedAmount: breakdown.chargedAmount / 100,
      merchantSettlementAmount: breakdown.merchantSettlementAmount / 100,
      treasuryFeeAmount: breakdown.treasuryFeeAmount / 100,
      currency: currency.toUpperCase(),
      status: 'PENDING',
      metadata: metadata as any,
      // Store fee snapshot for historical accuracy
      platformMarkupBps: pricing.feeConfig.platformMarkupBps,
      treasuryFeeBps: pricing.feeConfig.treasuryFeeBps,
    },
  });

  console.log(`✅ [Payment Orchestration] Transaction created: ${transaction.id}`);

  // Create Stripe payment intent with destination charge
  const Stripe = (await import('stripe')).default;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2026-02-25.clover',
  });

  const paymentIntent = await stripe.paymentIntents.create({
    amount: breakdown.chargedAmount, // Total charged to customer
    currency,
    automatic_payment_methods: {
      enabled: true,
      allow_redirects: 'never',
    },
    // Destination charge: route merchant share to connected account
    transfer_data: {
      destination: business.stripeAccount.stripeAccountId,
      amount: breakdown.merchantSettlementAmount, // Amount merchant receives
    },
    metadata: {
      commerceTransactionId: transaction.id,
      customerId,
      businessId,
    },
  });

  console.log(`✅ [Payment Orchestration] Payment intent created: ${paymentIntent.id}`);

  // Update transaction with payment intent ID
  await db.commerceTransaction.update({
    where: { id: transaction.id },
    data: {
      stripePaymentIntentId: paymentIntent.id,
      stripeDestinationAccountId: business.stripeAccount.stripeAccountId,
      status: 'PROCESSING',
    },
  });

  return {
    transaction: {
      id: transaction.id,
      listedAmount: breakdown.listedAmount / 100,
      chargedAmount: breakdown.chargedAmount / 100,
      merchantSettlementAmount: breakdown.merchantSettlementAmount / 100,
      treasuryFeeAmount: breakdown.treasuryFeeAmount / 100,
    },
    paymentIntent: {
      id: paymentIntent.id,
      clientSecret: paymentIntent.client_secret!,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
    },
    isDemoMode: false,
  };
}

function appendCheckoutReturnParams(url: string, transactionId: string) {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}transactionId=${encodeURIComponent(transactionId)}&checkoutSessionId={CHECKOUT_SESSION_ID}`;
}

function buildCheckoutLineItems(params: {
  businessName: string;
  breakdown: {
    listedAmount: number;
    chargedAmount: number;
    platformMarkupAmount: number;
  };
  currency: string;
}): Stripe.Checkout.SessionCreateParams.LineItem[] {
  const { businessName, breakdown, currency } = params;
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    {
      quantity: 1,
      price_data: {
        currency,
        unit_amount: breakdown.listedAmount,
        product_data: {
          name: `${businessName} order`,
        },
      },
    },
  ];

  if (breakdown.platformMarkupAmount > 0) {
    lineItems.push({
      quantity: 1,
      price_data: {
        currency,
        unit_amount: breakdown.platformMarkupAmount,
        product_data: {
          name: 'Checkout fee',
        },
      },
    });
  }

  return lineItems;
}

/**
 * Create a commerce transaction and Stripe-hosted Checkout Session.
 *
 * This avoids native Stripe SDK usage in mobile apps while keeping the same
 * destination-charge settlement model used by PaymentIntents.
 */
export async function createHostedCommerceCheckoutSession(params: {
  customerId: string;
  businessId: string;
  listedAmountCents: number;
  coopId: string;
  successUrl: string;
  cancelUrl: string;
  applyTreasuryFee?: boolean;
  currency?: string;
  metadata?: Record<string, unknown>;
}): Promise<{
  transaction: {
    id: string;
    listedAmount: number;
    chargedAmount: number;
    merchantSettlementAmount: number;
    treasuryFeeAmount: number;
  };
  checkoutSession: {
    id: string;
    url: string;
    amount: number;
    currency: string;
  };
  isDemoMode: false;
}> {
  const {
    customerId,
    businessId,
    listedAmountCents,
    applyTreasuryFee = true,
    currency = 'usd',
    metadata,
  } = params;
  const stripeCurrency = currency.toLowerCase();

  console.log(`💳 [Payment Orchestration] Creating hosted checkout: $${listedAmountCents / 100} for business ${businessId}`);

  const business = await db.business.findUnique({
    where: { id: businessId },
    include: {
      stripeAccount: true,
    },
  });

  if (!business) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Business not found',
    });
  }

  if (!business.stripeAccount) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Business does not have a Stripe Connect account',
    });
  }

  if (!business.stripeAccount.chargesEnabled) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Business is not yet enabled to accept charges',
    });
  }

  const feeConfig = await getActiveFeeConfig();
  const pricing = calculateCheckoutPricing({
    listedAmountCents,
    feeConfig,
    applyTreasuryFee,
  });
  const breakdown = pricing.breakdown;

  const transaction = await db.commerceTransaction.create({
    data: {
      customerId,
      businessId,
      coopId: params.coopId,
      listedAmount: breakdown.listedAmount / 100,
      chargedAmount: breakdown.chargedAmount / 100,
      merchantSettlementAmount: breakdown.merchantSettlementAmount / 100,
      treasuryFeeAmount: breakdown.treasuryFeeAmount / 100,
      currency: currency.toUpperCase(),
      status: 'PENDING',
      metadata: metadata as any,
      platformMarkupBps: pricing.feeConfig.platformMarkupBps,
      treasuryFeeBps: pricing.feeConfig.treasuryFeeBps,
    },
  });

  const Stripe = (await import('stripe')).default;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2026-02-25.clover',
  });

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    success_url: appendCheckoutReturnParams(params.successUrl, transaction.id),
    cancel_url: appendCheckoutReturnParams(params.cancelUrl, transaction.id),
    client_reference_id: transaction.id,
    customer_email: typeof metadata?.guestEmail === 'string' ? metadata.guestEmail : undefined,
    line_items: buildCheckoutLineItems({
      businessName: business.name,
      breakdown,
      currency: stripeCurrency,
    }),
    metadata: {
      commerceTransactionId: transaction.id,
      customerId,
      businessId,
    },
    payment_intent_data: {
      transfer_data: {
        destination: business.stripeAccount.stripeAccountId,
        amount: breakdown.merchantSettlementAmount,
      },
      metadata: {
        commerceTransactionId: transaction.id,
        customerId,
        businessId,
      },
    },
    expand: ['payment_intent'],
  });

  const paymentIntent = session.payment_intent;
  const paymentIntentId = typeof paymentIntent === 'string' ? paymentIntent : paymentIntent?.id;

  await db.commerceTransaction.update({
    where: { id: transaction.id },
    data: {
      stripePaymentIntentId: paymentIntentId,
      stripeDestinationAccountId: business.stripeAccount.stripeAccountId,
      status: 'PROCESSING',
      metadata: {
        ...(metadata ?? {}),
        stripeCheckoutSessionId: session.id,
      } as any,
    },
  });

  console.log(`✅ [Payment Orchestration] Checkout Session created: ${session.id}`);

  return {
    transaction: {
      id: transaction.id,
      listedAmount: breakdown.listedAmount / 100,
      chargedAmount: breakdown.chargedAmount / 100,
      merchantSettlementAmount: breakdown.merchantSettlementAmount / 100,
      treasuryFeeAmount: breakdown.treasuryFeeAmount / 100,
    },
    checkoutSession: {
      id: session.id,
      url: session.url!,
      amount: breakdown.chargedAmount,
      currency: stripeCurrency,
    },
    isDemoMode: false,
  };
}

/**
 * Process successful payment (called from webhook handler)
 * 
 * @param params - Payment parameters
 * @returns Processing result
 */
export async function processSuccessfulPayment(params: {
  stripePaymentIntentId: string;
  stripeChargeId: string;
  commerceTransactionId?: string;
}): Promise<{
  transactionId: string;
  customerId: string;
  businessId: string;
  amountUSD: number;
  treasuryFeeUSD: number;
}> {
  const { stripePaymentIntentId, stripeChargeId, commerceTransactionId } = params;

  console.log(`✅ [Payment Orchestration] Processing successful payment: ${stripePaymentIntentId}`);

  // Find transaction
  let transaction = await db.commerceTransaction.findUnique({
    where: { stripePaymentIntentId },
    include: {
      customer: true,
      business: true,
    },
  });

  if (!transaction && commerceTransactionId) {
    transaction = await db.commerceTransaction.findUnique({
      where: { id: commerceTransactionId },
      include: {
        customer: true,
        business: true,
      },
    });
  }

  if (!transaction) {
    throw new Error(`Transaction not found for payment intent: ${stripePaymentIntentId}`);
  }

  // Check if already completed (idempotency)
  if (transaction.status === 'COMPLETED') {
    console.log(`⚠️ [Payment Orchestration] Transaction already completed: ${transaction.id}`);
    return {
      transactionId: transaction.id,
      customerId: transaction.customerId,
      businessId: transaction.businessId,
      amountUSD: transaction.listedAmount,
      treasuryFeeUSD: transaction.treasuryFeeAmount,
    };
  }

  // Update transaction as completed
  await db.commerceTransaction.update({
    where: { id: transaction.id },
    data: {
      status: 'COMPLETED',
      stripePaymentIntentId,
      stripeChargeId,
      completedAt: new Date(),
    },
  });

  console.log(`✅ [Payment Orchestration] Transaction completed: ${transaction.id}`);

  return {
    transactionId: transaction.id,
    customerId: transaction.customerId,
    businessId: transaction.businessId,
    amountUSD: transaction.listedAmount,
    treasuryFeeUSD: transaction.treasuryFeeAmount,
  };
}

/**
 * Process failed payment (called from webhook handler)
 * 
 * @param params - Payment parameters
 */
export async function processFailedPayment(params: {
  stripePaymentIntentId: string;
  failureReason: string;
}): Promise<void> {
  const { stripePaymentIntentId, failureReason } = params;

  console.log(`❌ [Payment Orchestration] Processing failed payment: ${stripePaymentIntentId}`);

  const transaction = await db.commerceTransaction.findUnique({
    where: { stripePaymentIntentId },
  });

  if (!transaction) {
    console.warn(`⚠️ [Payment Orchestration] Transaction not found for failed payment: ${stripePaymentIntentId}`);
    return;
  }

  await db.commerceTransaction.update({
    where: { id: transaction.id },
    data: {
      status: 'FAILED',
      failedAt: new Date(),
      failureReason,
    },
  });

  console.log(`✅ [Payment Orchestration] Transaction marked as failed: ${transaction.id}`);
}

/**
 * Get transaction by Stripe payment intent ID
 * 
 * @param stripePaymentIntentId - Stripe payment intent ID
 * @returns Transaction data or null
 */
export async function getTransactionByPaymentIntent(
  stripePaymentIntentId: string
): Promise<{
  id: string;
  customerId: string;
  businessId: string;
  status: string;
  listedAmount: number;
  chargedAmount: number;
  merchantSettlementAmount: number;
  treasuryFeeAmount: number;
} | null> {
  const transaction = await db.commerceTransaction.findUnique({
    where: { stripePaymentIntentId },
  });

  if (!transaction) {
    return null;
  }

  return {
    id: transaction.id,
    customerId: transaction.customerId,
    businessId: transaction.businessId,
    status: transaction.status,
    listedAmount: transaction.listedAmount,
    chargedAmount: transaction.chargedAmount,
    merchantSettlementAmount: transaction.merchantSettlementAmount,
    treasuryFeeAmount: transaction.treasuryFeeAmount,
  };
}
