import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { Context, AuthenticatedContext, CoopScopedContext } from "../context.js";
import { privateProcedure, authenticatedProcedure } from "../procedures/index.js";
import { router } from "../trpc.js";
import { paymentService } from "../services/payment/index.js";
import { chargePaymentMethod } from "../services/stripe-customer.js";
import { mintUCToUser } from "../services/wallet-service.js";
import { convertUSDToUC, createParityAmounts } from "../utils/currency-converter.js";
import { createNotificationAndPush } from "../services/push-notification-service.js";

export const onrampRouter = router({
  /**
   * Get available payment processors
   */
  getAvailableProcessors: privateProcedure
    .query(async () => {
      console.log('\n🔷 getAvailableProcessors - START');

      try {
        const processors = await paymentService.getAvailableProcessors();

        return {
          processors,
          primary: 'stripe' as const,
          fallbacks: processors.filter(p => p !== 'stripe'),
        };
      } catch (error) {
        console.error('💥 ERROR in getAvailableProcessors:', error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to check available processors",
          cause: error,
        });
      }
    }),

  /**
   * Create payment intent for fiat onramp
   * Supports automatic failover between processors
   */
  createPaymentIntent: privateProcedure
    .input(z.object({
      amountUSD: z.number().min(10).max(10000), // $10-$10,000 limits
      processor: z.enum(['stripe', 'paypal', 'square']).optional(),
    }))
    .output(z.object({
      paymentIntentId: z.string(),
      clientSecret: z.string(),
      processor: z.enum(['stripe', 'paypal', 'square']),
      amountUSD: z.number(),
      amountUC: z.number(),
      transactionId: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as Context;

      console.log('\n🔷 createPaymentIntent - START');
      console.log('💰 Amount USD:', input.amountUSD);
      console.log('💳 Preferred processor:', input.processor || 'auto');

      try {
        // Get wallet address from authenticated context
        const { walletAddress } = ctx as AuthenticatedContext;
        console.log('👛 Wallet address:', walletAddress);

        // Look up user by wallet address
        const user = await context.db.user.findUnique({
          where: { walletAddress },
        });

        if (!user) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "User not found. Please complete registration first.",
          });
        }

        const userId = user.id;
        console.log('👤 User ID:', userId);

        // Create payment intent with automatic failover
        const paymentIntent = await paymentService.createPaymentIntent({
          amountUSD: input.amountUSD,
          userId,
          preferredProcessor: input.processor,
          metadata: {
            type: 'uc_onramp',
          },
        });

        console.log('✅ Payment intent created:', paymentIntent.id);
        console.log('💳 Using processor:', paymentIntent.processor);

        // Store onramp transaction in database
        console.log('💾 Storing onramp transaction...');
        const amounts = createParityAmounts(input.amountUSD);
        const transaction = await context.db.onrampTransaction.create({
          data: {
            userId,
            amountUSD: amounts.amountUSD,
            amountUC: amounts.amountUC,
            paymentIntentId: paymentIntent.id,
            processor: paymentIntent.processor,
            status: 'PENDING',
          },
        });

        console.log('✅ Transaction stored:', transaction.id);
        console.log('🎉 createPaymentIntent - SUCCESS');

        return {
          paymentIntentId: paymentIntent.id,
          clientSecret: paymentIntent.clientSecret,
          processor: paymentIntent.processor,
          amountUSD: amounts.amountUSD,
          amountUC: amounts.amountUC,
          transactionId: transaction.id,
        };
      } catch (error) {
        console.error('💥 ERROR in createPaymentIntent:', error);

        if (error instanceof TRPCError) {
          throw error;
        }

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create payment intent. Please try again.",
          cause: error,
        });
      }
    }),

  /**
   * Fund wallet with a saved card (instant UC minting)
   * Charges saved card and mints UC to user's wallet
   */
  fundWithSavedCard: authenticatedProcedure
    .input(z.object({
      amountUSD: z.number().min(10).max(10000), // $10-$10,000 limits
      paymentMethodId: z.string().optional(), // If not provided, use default
      coopId: z.string().default('???'),
    }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as Context;
      const { walletAddress } = ctx as AuthenticatedContext;

      console.log('\n🔷 fundWithSavedCard - START');
      console.log('💰 Amount USD:', input.amountUSD);
      console.log('💳 Payment method ID:', input.paymentMethodId || 'default');
      console.log('👛 Wallet address:', walletAddress);

      try {
        // Look up user by wallet address
        const user = await context.db.user.findUnique({
          where: { walletAddress },
          include: {
            paymentMethods: {
              orderBy: { createdAt: 'desc' },
            },
          },
        });

        if (!user) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "User not found. Please complete registration first.",
          });
        }

        const userId = user.id;
        console.log('👤 User ID:', userId);

        // Find the payment method to use
        let paymentMethod = input.paymentMethodId
          ? user.paymentMethods.find(pm => pm.id === input.paymentMethodId)
          : user.paymentMethods.find(pm => pm.isDefault) || user.paymentMethods[0];

        if (!paymentMethod) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "No payment method on file. Please add a card first.",
          });
        }

        console.log('💳 Using card:', paymentMethod.brand, '****', paymentMethod.last4);

        // Convert amount to cents
        const amountCents = Math.round(input.amountUSD * 100);
        const amountUC = convertUSDToUC(input.amountUSD);

        // Create onramp transaction record first (PENDING)
        const transaction = await context.db.onrampTransaction.create({
          data: {
            userId,
            amountUSD: input.amountUSD,
            amountUC,
            paymentIntentId: `fund_${Date.now()}_${userId.slice(-6)}`,
            processor: 'stripe',
            status: 'PENDING',
          },
        });

        console.log('💾 Transaction created:', transaction.id);

        try {
          // Charge the saved card
          console.log('💳 Charging card...');
          const chargeResult = await chargePaymentMethod(
            userId,
            amountCents,
            `Wallet funding: $${input.amountUSD} → ${amountUC} UC`,
            {
              transactionId: transaction.id,
              type: 'wallet_funding',
            }
          );

          console.log('✅ Card charged:', chargeResult.paymentIntentId);

          // Mint UC to user's wallet
          console.log('🪙 Minting UC...');
          const mintTxHash = await mintUCToUser(userId, amountUC, input.coopId);

          console.log('✅ UC minted:', mintTxHash);

          // Update transaction as COMPLETED
          await context.db.onrampTransaction.update({
            where: { id: transaction.id },
            data: {
              paymentIntentId: chargeResult.paymentIntentId,
              processorChargeId: chargeResult.chargeId,
              mintTxHash,
              status: 'COMPLETED',
              completedAt: new Date(),
            },
          });

          // Create notification
          const coopId = (ctx as CoopScopedContext).coopId || '???';
          await createNotificationAndPush(context.db, {
            userId,
            coopId,
            type: 'WALLET_FUNDED',
            title: 'Wallet Funded',
            body: `$${input.amountUSD.toFixed(2)} has been added to your wallet.`,
            data: {
              transactionId: transaction.id,
              amountUSD: input.amountUSD,
              amountUC,
              mintTxHash,
            },
          });

          console.log('🎉 fundWithSavedCard - SUCCESS');

          return {
            success: true,
            transactionId: transaction.id,
            amountUSD: input.amountUSD,
            amountUC,
            mintTxHash,
            message: `Successfully funded wallet with ${amountUC} UC`,
          };
        } catch (error: any) {
          console.error('💥 Funding failed:', error);

          // Update transaction as FAILED
          await context.db.onrampTransaction.update({
            where: { id: transaction.id },
            data: {
              status: 'FAILED',
              failedAt: new Date(),
              failureReason: error.message || 'Unknown error',
            },
          });

          // Re-throw with appropriate error message
          if (error.message?.includes('card was declined')) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Your card was declined. Please try a different card.",
            });
          }

          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to fund wallet. Please try again.",
            cause: error,
          });
        }
      } catch (error) {
        console.error('💥 ERROR in fundWithSavedCard:', error);

        if (error instanceof TRPCError) {
          throw error;
        }

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fund wallet. Please try again.",
          cause: error,
        });
      }
    }),

  /**
   * Get onramp transaction history for current user
   */
  getOnrampHistory: privateProcedure
    .input(z.object({
      limit: z.number().default(50),
      offset: z.number().default(0),
    }))
    .output(z.object({
      transactions: z.array(z.object({
        id: z.string(),
        amountUSD: z.number(),
        amountUC: z.number(),
        processor: z.string(),
        status: z.string(),
        mintTxHash: z.string().optional(),
        createdAt: z.string(),
        completedAt: z.string().optional(),
        failedAt: z.string().optional(),
        failureReason: z.string().optional(),
      })),
      total: z.number(),
      hasMore: z.boolean(),
    }))
    .query(async ({ input, ctx }) => {
      const context = ctx as Context;

      console.log('\n🔷 getOnrampHistory - START');

      try {
        // Get wallet address from authenticated context
        const { walletAddress } = ctx as AuthenticatedContext;

        // Look up user by wallet address
        const user = await context.db.user.findUnique({
          where: { walletAddress },
        });

        if (!user) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "User not found",
          });
        }

        const userId = user.id;

        // Get total count
        const total = await context.db.onrampTransaction.count({
          where: { userId },
        });

        // Get transactions
        const transactions = await context.db.onrampTransaction.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: input.limit,
          skip: input.offset,
        });

        console.log(`✅ Found ${transactions.length} onramp transactions`);

        return {
          transactions: transactions.map(tx => ({
            id: tx.id,
            amountUSD: tx.amountUSD,
            amountUC: tx.amountUC,
            processor: tx.processor,
            status: tx.status,
            mintTxHash: tx.mintTxHash ?? undefined,
            createdAt: tx.createdAt.toISOString(),
            completedAt: tx.completedAt?.toISOString(),
            failedAt: tx.failedAt?.toISOString(),
            failureReason: tx.failureReason ?? undefined,
          })),
          total,
          hasMore: input.offset + input.limit < total,
        };
      } catch (error) {
        console.error('💥 ERROR in getOnrampHistory:', error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch onramp history",
          cause: error,
        });
      }
    }),

  /**
   * Get status of a specific onramp transaction
   */
  getOnrampStatus: privateProcedure
    .input(z.object({
      transactionId: z.string(),
    }))
    .output(z.object({
      id: z.string(),
      status: z.string(),
      amountUSD: z.number(),
      amountUC: z.number(),
      processor: z.string(),
      mintTxHash: z.string().optional(),
      createdAt: z.string(),
      completedAt: z.string().optional(),
      failedAt: z.string().optional(),
      failureReason: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
      const context = ctx as Context;

      console.log('\n🔷 getOnrampStatus - START');
      console.log('🔍 Transaction ID:', input.transactionId);

      try {
        const transaction = await context.db.onrampTransaction.findUnique({
          where: { id: input.transactionId },
        });

        if (!transaction) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Transaction not found",
          });
        }

        console.log('✅ Transaction found:', transaction.status);

        return {
          id: transaction.id,
          status: transaction.status,
          amountUSD: transaction.amountUSD,
          amountUC: transaction.amountUC,
          processor: transaction.processor,
          mintTxHash: transaction.mintTxHash ?? undefined,
          createdAt: transaction.createdAt.toISOString(),
          completedAt: transaction.completedAt?.toISOString(),
          failedAt: transaction.failedAt?.toISOString(),
          failureReason: transaction.failureReason ?? undefined,
        };
      } catch (error) {
        console.error('💥 ERROR in getOnrampStatus:', error);

        if (error instanceof TRPCError) {
          throw error;
        }

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch transaction status",
          cause: error,
        });
      }
    }),

  /**
   * Get onramp statistics (admin)
   */
  getOnrampStats: privateProcedure
    .input(z.object({
      fromDate: z.string().optional(),
      toDate: z.string().optional(),
    }))
    .output(z.object({
      totalVolumeUSD: z.number(),
      totalUCMinted: z.number(),
      transactionCount: z.number(),
      successCount: z.number(),
      failureCount: z.number(),
      byProcessor: z.record(z.object({
        count: z.number(),
        volumeUSD: z.number(),
        successRate: z.number(),
      })),
    }))
    .query(async ({ input, ctx }) => {
      const context = ctx as Context;

      console.log('\n🔷 getOnrampStats - START');

      try {
        const fromDate = input.fromDate ? new Date(input.fromDate) : undefined;
        const toDate = input.toDate ? new Date(input.toDate) : undefined;

        // Get all transactions in date range
        const transactions = await context.db.onrampTransaction.findMany({
          where: {
            createdAt: {
              gte: fromDate,
              lte: toDate,
            },
          },
        });

        // Calculate stats
        const totalVolumeUSD = transactions.reduce((sum, tx) => sum + tx.amountUSD, 0);
        const totalUCMinted = transactions.filter(tx => tx.status === 'COMPLETED').reduce((sum, tx) => sum + tx.amountUC, 0);
        const transactionCount = transactions.length;
        const successCount = transactions.filter(tx => tx.status === 'COMPLETED').length;
        const failureCount = transactions.filter(tx => tx.status === 'FAILED').length;

        // Group by processor
        const byProcessor: Record<string, { count: number; volumeUSD: number; successRate: number }> = {};

        for (const tx of transactions) {
          if (!byProcessor[tx.processor]) {
            byProcessor[tx.processor] = { count: 0, volumeUSD: 0, successRate: 0 };
          }

          byProcessor[tx.processor]!.count++;
          byProcessor[tx.processor]!.volumeUSD += tx.amountUSD;
        }

        // Calculate success rates
        for (const processor in byProcessor) {
          const processorTxs = transactions.filter(tx => tx.processor === processor);
          const processorSuccesses = processorTxs.filter(tx => tx.status === 'COMPLETED').length;
          byProcessor[processor]!.successRate = processorTxs.length > 0
            ? (processorSuccesses / processorTxs.length) * 100
            : 0;
        }

        console.log('✅ Stats calculated');
        console.log('💰 Total volume:', totalVolumeUSD, 'USD');
        console.log('🪙 Total UC minted:', totalUCMinted);

        return {
          totalVolumeUSD,
          totalUCMinted,
          transactionCount,
          successCount,
          failureCount,
          byProcessor,
        };
      } catch (error) {
        console.error('💥 ERROR in getOnrampStats:', error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch onramp stats",
          cause: error,
        });
      }
    }),
});
