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

import { db, PaymentType, PaymentStatus, FulfillmentStatus } from '@repo/db';
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

  // Demo coop bypasses Stripe entirely — demo stores don't have real Stripe accounts
  const isDemoAccount = params.coopId === 'demo';
  if (isDemoAccount) {
    console.log(`🎭 [Payment Orchestration] Demo account detected — skipping Stripe, marking transaction complete`);
    await db.commerceTransaction.update({
      where: { id: transaction.id },
      data: {
        stripePaymentIntentId: `demo_pi_${transaction.id}`,
        stripeDestinationAccountId: business.stripeAccount.stripeAccountId,
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });

    // Create a StoreOrder so the orders list and detail screens have real data to show
    const store = await db.store.findFirst({ where: { businessId } });
    let storeOrderId: string | undefined;
    if (store) {
      const cartItems = (metadata?.items as Array<{ productId: string; quantity: number; priceUSD: number }> | undefined) ?? [];
      const shippingAddress = (metadata?.shippingAddress as string | undefined) ?? '';
      const note = (metadata?.note as string | undefined) ?? '';
      const storeOrder = await db.storeOrder.create({
        data: {
          storeId: store.id,
          buyerId: customerId,
          subtotalUSD: breakdown.listedAmount / 100,
          totalUSD: breakdown.chargedAmount / 100,
          paymentMethod: PaymentType.CARD,
          paymentStatus: PaymentStatus.COMPLETED,
          fulfillmentStatus: FulfillmentStatus.PENDING,
          shippingAddress: shippingAddress || undefined,
          note: note || undefined,
          items: cartItems.length > 0 ? {
            create: cartItems.map(item => ({
              productId: item.productId,
              quantity: item.quantity,
              priceUSD: item.priceUSD,
              totalUSD: item.priceUSD * item.quantity,
            })),
          } : undefined,
        },
      });
      storeOrderId = storeOrder.id;
      console.log(`🎭 [Payment Orchestration] Demo StoreOrder created: ${storeOrderId}`);
    }

    return {
      transaction: {
        id: transaction.id,
        listedAmount: breakdown.listedAmount / 100,
        chargedAmount: breakdown.chargedAmount / 100,
        merchantSettlementAmount: breakdown.merchantSettlementAmount / 100,
        treasuryFeeAmount: breakdown.treasuryFeeAmount / 100,
      },
      paymentIntent: {
        id: `demo_pi_${transaction.id}`,
        clientSecret: `demo_pi_${transaction.id}_secret`,
        amount: breakdown.chargedAmount,
        currency,
      },
      isDemoMode: true,
      storeOrderId,
    };
  }

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

/**
 * Process successful payment (called from webhook handler)
 * 
 * @param params - Payment parameters
 * @returns Processing result
 */
export async function processSuccessfulPayment(params: {
  stripePaymentIntentId: string;
  stripeChargeId: string;
}): Promise<{
  transactionId: string;
  customerId: string;
  businessId: string;
  amountUSD: number;
  treasuryFeeUSD: number;
}> {
  const { stripePaymentIntentId, stripeChargeId } = params;

  console.log(`✅ [Payment Orchestration] Processing successful payment: ${stripePaymentIntentId}`);

  // Find transaction
  const transaction = await db.commerceTransaction.findUnique({
    where: { stripePaymentIntentId },
    include: {
      customer: true,
      business: true,
    },
  });

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
