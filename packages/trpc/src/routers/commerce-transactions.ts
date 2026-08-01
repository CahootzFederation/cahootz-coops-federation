import { z } from 'zod';
import { router, publicProcedure } from '../trpc.js';
import { authenticatedProcedure, privateProcedure } from '../procedures/index.js';
import { db } from '@repo/db';
import { 
  getActiveFeeConfig, 
  createCommerceTransaction,
  createHostedCommerceCheckoutSession,
  getTransactionByPaymentIntent 
} from '../services/payment-orchestration-service.js';
import { calculateCheckoutPricing } from '../services/checkout-pricing-service.js';
import { validateRewardEligibility } from '../services/reward-policy-service.js';
import { getUserWalletInfo } from '../services/wallet-service.js';
import { AuthenticatedContext, CoopScopedContext } from '../context.js';

async function getUserForWallet(walletAddress: string) {
  const user = await db.user.findFirst({
    where: {
      OR: [
        {
          walletAddress: {
            equals: walletAddress,
            mode: 'insensitive',
          },
        },
        {
          wallets: {
            some: {
              address: {
                equals: walletAddress,
                mode: 'insensitive',
              },
            },
          },
        },
      ],
    },
    select: {
      id: true,
      email: true,
      name: true,
    },
  });

  if (!user) return null;

  const walletInfo = await getUserWalletInfo(user.id, db);

  return {
    ...user,
    walletInfo,
  };
}

async function getCoopMembershipStatus(userId: string, coopId: string) {
  const membership = await db.userCoopMembership.findUnique({
    where: {
      userId_coopId: {
        userId,
        coopId,
      },
    },
    select: {
      status: true,
    },
  });

  return membership?.status ?? null;
}

export const commerceTransactionsRouter = router({
  /**
   * Preview commerce checkout pricing before creating payment intent
   */
  previewCheckout: authenticatedProcedure
    .input(z.object({
      userId: z.string(),
      businessId: z.string(),
      listedAmountCents: z.number().int().positive(),
      currency: z.string().default('USD'),
      coopId: z.string().default('???'),
    }))
    .query(async ({ input, ctx }) => {
      const context = ctx as AuthenticatedContext;
      const { userId, businessId, listedAmountCents, currency, coopId } = input;
      const authenticatedUser = await getUserForWallet(context.walletAddress);

      if (!authenticatedUser || authenticatedUser.id !== userId) {
        throw new Error('Authenticated wallet does not match checkout user');
      }

      // Get business and check eligibility
      const business = await db.business.findUnique({
        where: { id: businessId },
        include: {
          stripeAccount: true,
          owner: true,
        },
      });
      
      if (!business) {
        throw new Error('Business not found');
      }

      // Get active fee config
      const feeConfig = await getActiveFeeConfig();
      const membershipStatus = await getCoopMembershipStatus(userId, coopId);
      const pricing = calculateCheckoutPricing({
        listedAmountCents,
        feeConfig,
        applyTreasuryFee: membershipStatus === 'ACTIVE',
      });
      const breakdown = pricing.breakdown;

      // Check SC reward eligibility
      const customerWallet = authenticatedUser.walletInfo.hasWallet
        ? authenticatedUser.walletInfo
        : null;
      const merchantWalletInfo = business.ownerId
        ? await getUserWalletInfo(business.ownerId, db)
        : null;
      const merchantWallet = merchantWalletInfo?.hasWallet
        ? merchantWalletInfo
        : null;

      const eligibility = (customerWallet && merchantWallet)
        ? await validateRewardEligibility({
            customerId: userId,
            customerWalletAddress: customerWallet.address,
            businessId,
            businessOwnerId: business.ownerId,
            businessOwnerWalletAddress: merchantWallet.address,
            amountUSD: listedAmountCents / 100,
            coopId,
          })
        : { customerEligible: false, customerReason: 'NO_WALLET', merchantEligible: false, merchantReason: 'NO_WALLET', customerEstimatedReward: 0, merchantEstimatedReward: 0, businessScVerified: false };

      return {
        listedAmountCents,
        platformMarkupCents: breakdown.platformMarkupAmount,
        treasuryFeeCents: breakdown.treasuryFeeAmount,
        totalChargedCents: breakdown.chargedAmount,
        merchantSettlementCents: breakdown.merchantSettlementAmount,
        currency,
        appliesTreasuryFee: pricing.appliesTreasuryFee,
        membershipStatus,
        feeConfig: {
          platformMarkupBps: pricing.feeConfig.platformMarkupBps,
          treasuryFeeBps: pricing.feeConfig.treasuryFeeBps,
        },
        customerReward: {
          eligible: eligibility.customerEligible,
          estimatedAmount: eligibility.customerEstimatedReward,
          reason: eligibility.customerReason,
        },
        merchantReward: {
          eligible: eligibility.merchantEligible,
          estimatedAmount: eligibility.merchantEstimatedReward,
          reason: eligibility.merchantReason,
        },
        businessEligible: !!business.stripeAccount?.chargesEnabled,
      };
    }),

  /**
   * Create commerce transaction and Stripe payment intent
   * Supports both authenticated users and guest checkout
   */
  createCheckout: publicProcedure
    .input(z.object({
      userId: z.string().optional(),
      guestEmail: z.string().email().optional(),
      guestName: z.string().optional(),
      coopId: z.string(),
      businessId: z.string(),
      listedAmountCents: z.number().int().positive(),
      currency: z.string().default('USD'),
      metadata: z.record(z.unknown()).optional(),
    }))
    .mutation(async ({ input }) => {
      const { userId, guestEmail, guestName, coopId, businessId, listedAmountCents, currency, metadata } = input;
      if (userId) {
        throw new Error('Public checkout does not support logged-in purchases yet');
      }

      const isLoggedInCheckout = false;

      let customerId = userId;

      // Handle guest checkout
      if (!customerId && guestEmail) {
        let guestUser = await db.user.findUnique({
          where: { email: guestEmail },
        });

        if (!guestUser) {
          guestUser = await db.user.create({
            data: {
              email: guestEmail,
              name: guestName || guestEmail.split('@')[0],
              walletAddress: `guest_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            },
          });
        }

        customerId = guestUser.id;
      }

      if (!customerId) {
        throw new Error('Either userId or guestEmail must be provided');
      }

      const result = await createCommerceTransaction({
        customerId,
        businessId,
        listedAmountCents,
        coopId,
        applyTreasuryFee: isLoggedInCheckout,
        currency,
        metadata: {
          ...metadata,
          isGuestCheckout: !isLoggedInCheckout,
          guestEmail,
          guestName,
        },
      });

      return {
        transactionId: result.transaction.id,
        clientSecret: result.paymentIntent.clientSecret,
        totalChargedCents: Math.round(result.transaction.chargedAmount * 100),
        merchantSettlementCents: Math.round(result.transaction.merchantSettlementAmount * 100),
        platformFeeCents: Math.round((result.transaction.chargedAmount - result.transaction.merchantSettlementAmount) * 100),
        treasuryFeeCents: Math.round(result.transaction.treasuryFeeAmount * 100),
      };
    }),

  /**
   * Create commerce transaction and Stripe payment intent for a signed-in coop checkout.
   */
  createMemberCheckout: authenticatedProcedure
    .input(z.object({
      coopId: z.string(),
      businessId: z.string(),
      listedAmountCents: z.number().int().positive(),
      currency: z.string().default('USD'),
      paymentUi: z.enum(['payment_intent', 'hosted_checkout']).default('payment_intent'),
      successUrl: z.string().optional(),
      cancelUrl: z.string().optional(),
      metadata: z.record(z.unknown()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as AuthenticatedContext;
      const { coopId, businessId, listedAmountCents, currency, metadata, paymentUi, successUrl, cancelUrl } = input;

      const user = await getUserForWallet(context.walletAddress);
      if (!user) {
        throw new Error('Signed-in checkout user not found');
      }
      const membershipStatus = await getCoopMembershipStatus(user.id, coopId);
      const applyTreasuryFee = membershipStatus === 'ACTIVE';
      const checkoutMetadata = {
        ...metadata,
        isGuestCheckout: false,
        checkoutMode: applyTreasuryFee ? 'COOP_MEMBER' : 'SIGNED_IN_NON_MEMBER',
      };

      if (paymentUi === 'hosted_checkout') {
        if (!successUrl || !cancelUrl) {
          throw new Error('Hosted checkout requires successUrl and cancelUrl');
        }

        const result = await createHostedCommerceCheckoutSession({
          customerId: user.id,
          businessId,
          listedAmountCents,
          coopId,
          applyTreasuryFee,
          currency,
          successUrl,
          cancelUrl,
          metadata: checkoutMetadata,
        });

        return {
          transactionId: result.transaction.id,
          clientSecret: null,
          checkoutUrl: result.checkoutSession.url,
          checkoutSessionId: result.checkoutSession.id,
          totalChargedCents: Math.round(result.transaction.chargedAmount * 100),
          merchantSettlementCents: Math.round(result.transaction.merchantSettlementAmount * 100),
          platformFeeCents: Math.round((result.transaction.chargedAmount - result.transaction.merchantSettlementAmount) * 100),
          treasuryFeeCents: Math.round(result.transaction.treasuryFeeAmount * 100),
          isDemoMode: result.isDemoMode,
          storeOrderId: undefined,
        };
      }

      const result = await createCommerceTransaction({
        customerId: user.id,
        businessId,
        listedAmountCents,
        coopId,
        applyTreasuryFee,
        currency,
        metadata: checkoutMetadata,
      });

      return {
        transactionId: result.transaction.id,
        clientSecret: result.paymentIntent.clientSecret,
        checkoutUrl: null,
        checkoutSessionId: null,
        totalChargedCents: Math.round(result.transaction.chargedAmount * 100),
        merchantSettlementCents: Math.round(result.transaction.merchantSettlementAmount * 100),
        platformFeeCents: Math.round((result.transaction.chargedAmount - result.transaction.merchantSettlementAmount) * 100),
        treasuryFeeCents: Math.round(result.transaction.treasuryFeeAmount * 100),
        isDemoMode: result.isDemoMode,
        storeOrderId: result.storeOrderId,
      };
    }),

  /**
   * Get commerce transaction detail
   */
  getTransaction: authenticatedProcedure
    .input(z.object({
      userId: z.string(),
      transactionId: z.string(),
    }))
    .query(async ({ input }) => {
      const transaction = await db.commerceTransaction.findUnique({
        where: { id: input.transactionId },
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          business: {
            select: {
              id: true,
              name: true,
            },
          },
          scMintEvents: {
            select: {
              id: true,
              userId: true,
              requestedAmount: true,
              status: true,
              sourceType: true,
              createdAt: true,
            },
          },
          treasuryLedgerEntries: {
            select: {
              id: true,
              accountType: true,
              entryType: true,
              amount: true,
              direction: true,
              occurredAt: true,
            },
          },
        },
      });

      if (!transaction) {
        throw new Error('Transaction not found');
      }

      // Check access
      const userBusiness = await db.business.findFirst({
        where: { ownerId: input.userId },
        select: { id: true },
      });
      
      if (transaction.customerId !== input.userId && userBusiness?.id !== transaction.businessId) {
        throw new Error('Unauthorized');
      }

      return {
        ...transaction,
        // Include the fee snapshot that was used at purchase time
        feeSnapshot: {
          platformMarkupBps: transaction.platformMarkupBps,
          treasuryFeeBps: transaction.treasuryFeeBps,
        },
      };
    }),

  /**
   * List commerce transactions
   */
  listTransactions: authenticatedProcedure
    .input(z.object({
      userId: z.string(),
      status: z.enum(['PENDING', 'COMPLETED', 'FAILED', 'REFUNDED']).optional(),
      businessId: z.string().optional(),
      customerId: z.string().optional(),
      limit: z.number().default(50),
      offset: z.number().default(0),
    }))
    .query(async ({ input }) => {
      const { status, businessId, customerId, limit, offset } = input;

      const where: any = {};
      
      if (status) {
        where.status = status;
      }
      
      if (businessId) {
        where.businessId = businessId;
      }
      
      if (customerId) {
        where.customerId = customerId;
      }

      const [transactions, total] = await Promise.all([
        db.commerceTransaction.findMany({
          where,
          include: {
            customer: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            business: {
              select: {
                id: true,
                name: true,
              },
            },
            scMintEvents: {
              select: {
                id: true,
                status: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: limit,
          skip: offset,
        }),
        db.commerceTransaction.count({ where }),
      ]);

      return {
        transactions,
        total,
        hasMore: offset + limit < total,
      };
    }),

  /**
   * Get payment stats (admin only)
   */
  getPaymentStats: privateProcedure
    .input(z.object({
      startDate: z.coerce.date().optional(),
      endDate: z.coerce.date().optional(),
    }))
    .query(async ({ input }) => {
      const { startDate, endDate } = input;

      const where: any = {
        status: 'COMPLETED',
      };

      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) where.createdAt.gte = startDate;
        if (endDate) where.createdAt.lte = endDate;
      }

      const [stats, recentTransactions] = await Promise.all([
        db.commerceTransaction.aggregate({
          where,
          _count: true,
          _sum: {
            chargedAmount: true,
            treasuryFeeAmount: true,
            merchantSettlementAmount: true,
          },
        }),
        db.commerceTransaction.findMany({
          where,
          take: 10,
          orderBy: {
            createdAt: 'desc',
          },
          include: {
            customer: {
              select: {
                name: true,
              },
            },
            business: {
              select: {
                name: true,
              },
            },
          },
        }),
      ]);

      return {
        totalPayments: stats._count,
        totalVolumeCents: Math.round((stats._sum.chargedAmount || 0) * 100),
        totalTreasuryFeesCents: Math.round((stats._sum.treasuryFeeAmount || 0) * 100),
        totalMerchantSettlementCents: Math.round((stats._sum.merchantSettlementAmount || 0) * 100),
        averageTransactionCents: stats._count > 0 
          ? Math.round(((stats._sum.chargedAmount || 0) * 100) / stats._count)
          : 0,
        recentTransactions,
      };
    }),
});
