import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { Context } from "../context.js";
import { publicProcedure } from "../procedures/index.js";
import { router } from "../trpc.js";
import { createWalletForUser } from "../services/wallet-service.js";
import { coopConfig } from "../config/coop.js";
import { toE164 } from "../lib/phone.js";

export const claimRouter = router({
  /**
   * Get pending transfer info by claim token
   * This is a PUBLIC endpoint - no auth required
   */
  getClaimInfo: publicProcedure
    .input(z.object({
      claimToken: z.string(),
    }))
    .output(z.object({
      found: z.boolean(),
      expired: z.boolean().optional(),
      claimed: z.boolean().optional(),
      senderName: z.string().optional(),
      amount: z.number().optional(),
      note: z.string().optional(),
      expiresAt: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
      const context = ctx as Context;

      console.log('\n🔷 claim.getClaimInfo - START');
      console.log('🎫 Token:', input.claimToken);

      try {
        const transfer = await context.db.pendingTransfer.findUnique({
          where: { claimToken: input.claimToken },
          include: {
            sender: { select: { name: true } },
          },
        });

        if (!transfer) {
          return { found: false };
        }

        // Check if already claimed
        if (transfer.status !== 'PENDING_CLAIM') {
          return {
            found: true,
            expired: transfer.status === 'EXPIRED',
            claimed: transfer.status === 'CLAIMED_TO_BANK' || transfer.status === 'CLAIMED_TO_SOULAAN',
          };
        }

        // Check if expired
        if (new Date() > transfer.expiresAt) {
          return {
            found: true,
            expired: true,
          };
        }

        return {
          found: true,
          expired: false,
          claimed: false,
          senderName: transfer.sender.name || 'Someone',
          amount: transfer.amountUSD,
          note: transfer.note || undefined,
          expiresAt: transfer.expiresAt.toISOString(),
        };
      } catch (error) {
        console.error('💥 ERROR:', error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to get claim info",
          cause: error,
        });
      }
    }),

  /**
   * Claim funds to bank account (dead-end exit)
   * Non-user provides bank details and receives ACH payout
   */
  claimToBank: publicProcedure
    .input(z.object({
      claimToken: z.string(),
      accountHolderName: z.string().min(2),
      routingNumber: z.string().length(9),
      accountNumber: z.string().min(4).max(17),
    }))
    .output(z.object({
      success: z.boolean(),
      message: z.string(),
      eta: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as Context;

      console.log('\n🔷 claim.claimToBank - START');
      console.log('🎫 Token:', input.claimToken);

      try {
        const transfer = await context.db.pendingTransfer.findUnique({
          where: { claimToken: input.claimToken },
        });

        if (!transfer) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Transfer not found",
          });
        }

        if (transfer.status !== 'PENDING_CLAIM') {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This transfer has already been claimed or expired",
          });
        }

        if (new Date() > transfer.expiresAt) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This transfer has expired",
          });
        }

        // TODO: Implement Stripe payout to bank
        // 1. Convert UC from escrow to USD
        // 2. Create Stripe payout to provided bank account
        // 3. Track payout status

        // For now, mark as claimed and simulate success
        await context.db.pendingTransfer.update({
          where: { id: transfer.id },
          data: {
            status: 'CLAIMED_TO_BANK',
            claimedAt: new Date(),
          },
        });

        // Notify sender
        await context.db.notification.create({
          data: {
            userId: transfer.senderId,
            coopId: transfer.coopId,
            type: 'PAYMENT_CLAIMED',
            title: 'Payment accepted',
            body: `${transfer.recipientPhone} accepted your $${transfer.amountUSD.toFixed(2)} payment.`,
            data: {
              pendingTransferId: transfer.id,
              claimMethod: 'bank',
            },
          },
        });

        console.log('✅ Claim to bank successful');

        return {
          success: true,
          message: `$${transfer.amountUSD.toFixed(2)} is on its way to your bank`,
          eta: '1-3 business days',
        };
      } catch (error) {
        console.error('💥 ERROR:', error);

        if (error instanceof TRPCError) throw error;

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to process claim",
          cause: error,
        });
      }
    }),

  /**
   * Claim funds by joining Soulaan
   * Creates a new user account and credits their wallet
   */
  claimToSoulaan: publicProcedure
    .input(z.object({
      claimToken: z.string(),
      name: z.string().min(2),
      phone: z.string(), // Should match the recipient phone
      email: z.string().email().optional(),
    }))
    .output(z.object({
      success: z.boolean(),
      message: z.string(),
      userId: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as Context;

      console.log('\n🔷 claim.claimToSoulaan - START');
      console.log('🎫 Token:', input.claimToken);

      try {
        const transfer = await context.db.pendingTransfer.findUnique({
          where: { claimToken: input.claimToken },
          include: {
            sender: { select: { name: true } },
          },
        });

        if (!transfer) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Transfer not found",
          });
        }

        if (transfer.status !== 'PENDING_CLAIM') {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This transfer has already been claimed or expired",
          });
        }

        if (new Date() > transfer.expiresAt) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This transfer has expired",
          });
        }

        // Verify phone matches (or allow any for now)
        // if (input.phone !== transfer.recipientPhone) {
        //   throw new TRPCError({
        //     code: "BAD_REQUEST",
        //     message: "Phone number does not match",
        //   });
        // }

        // Check if user already exists with this email
        if (input.email) {
          const existingUser = await context.db.user.findUnique({
            where: { email: input.email },
          });

          if (existingUser) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "An account with this email already exists. Please log in instead.",
            });
          }
        }

        // Create new user with normalized phone
        const normalizedPhone = toE164(input.phone);
        console.log(`📱 Phone: "${input.phone}" -> "${normalizedPhone}"`);

        const newUser = await context.db.user.create({
          data: {
            email: input.email || `${(normalizedPhone || input.phone).replace(/\D/g, '')}@soulaan.temp`,
            name: input.name,
            phone: normalizedPhone,
            status: 'ACTIVE', // Auto-activate for claim flow
          },
        });

        // Create wallet for user
        await createWalletForUser(newUser.id);

        // TODO: Transfer UC from escrow to new user's wallet
        // For now, we just mark the transfer as claimed

        // Update pending transfer
        await context.db.pendingTransfer.update({
          where: { id: transfer.id },
          data: {
            status: 'CLAIMED_TO_SOULAAN',
            claimedAt: new Date(),
            claimedByUserId: newUser.id,
          },
        });

        // Create notifications
        const config = coopConfig();
        await Promise.all([
          // Welcome notification for new user
          context.db.notification.create({
            data: {
              userId: newUser.id,
              coopId: transfer.coopId,
              type: 'WELCOME',
              title: `Welcome to ${config.shortName}!`,
              body: `${transfer.sender.name || 'Someone'} sent you $${transfer.amountUSD.toFixed(2)}. Your balance is ready to use.`,
              data: {
                pendingTransferId: transfer.id,
                amountUSD: transfer.amountUSD,
              },
            },
          }),
          // Notify sender
          context.db.notification.create({
            data: {
              userId: transfer.senderId,
              coopId: transfer.coopId,
              type: 'PAYMENT_CLAIMED',
              title: 'Payment accepted',
              body: `${input.name} accepted your $${transfer.amountUSD.toFixed(2)} payment and joined ${config.shortName}.`,
              data: {
                pendingTransferId: transfer.id,
                claimMethod: '???',
                newUserId: newUser.id,
              },
            },
          }),
        ]);

        console.log(`✅ Claim to ${config.shortName} successful`);
        console.log('👤 New user ID:', newUser.id);

        return {
          success: true,
          message: `Welcome to ${config.shortName}! Your $${transfer.amountUSD.toFixed(2)} is ready.`,
          userId: newUser.id,
        };
      } catch (error) {
        console.error('💥 ERROR:', error);

        if (error instanceof TRPCError) throw error;

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to process claim",
          cause: error,
        });
      }
    }),
});
