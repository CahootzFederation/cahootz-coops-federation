import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { encodeFunctionData, type Address } from 'viem';

import { db } from "@repo/db";
import { Context, CoopScopedContext } from "../context.js";
import { privateProcedure, publicProcedure } from "../procedures/index.js";
import { router } from "../trpc.js";
import { sendTransaction } from "../services/wallet-service.js";
import { coinNameFrom, formatCoinAmount } from "../services/coop-chain-config-service.js";
import {
  getUCBalance,
  isActiveMember,
  getTransferEvents,
  parseUCAmount,
  formatUCAmount,
  estimateGas,
  getGasPrice,
  unityCoinAbi,
} from "../services/blockchain.js";

export const ucTransferRouter = router({
  /**
   * Get UC balance for a wallet address
   */
  getBalance: privateProcedure
    .input(z.object({
      walletAddress: z.string(),
    }))
    .output(z.object({
      balance: z.string(),
      balanceFormatted: z.string(),
    }))
    .query(async ({ input, ctx }) => {
      const coopId = (ctx as CoopScopedContext).coopId || '???';
      console.log('\n🔷 getBalance - START');
      console.log('📍 Address:', input.walletAddress);

      try {
        const { balance, formatted } = await getUCBalance(input.walletAddress, coopId);

        console.log('✅ Balance:', formatted, 'UC');
        return {
          balance: balance.toString(),
          balanceFormatted: formatted,
        };
      } catch (error) {
        console.error('💥 ERROR in getBalance:', error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch balance",
          cause: error,
        });
      }
    }),

  /**
   * Validate if a recipient address can receive UC transfers
   * (Must be an active SoulaaniCoin member)
   */
  validateRecipient: privateProcedure
    .input(z.object({
      recipientAddress: z.string(),
    }))
    .output(z.object({
      isValid: z.boolean(),
      isActiveMember: z.boolean(),
      error: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
      const coopId = (ctx as CoopScopedContext).coopId || '???';
      console.log('\n🔷 validateRecipient - START');
      console.log('📍 Recipient:', input.recipientAddress);

      try {
        // Check if address is valid format
        if (!input.recipientAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
          return {
            isValid: false,
            isActiveMember: false,
            error: "Invalid Ethereum address format",
          };
        }

        // Check if recipient is an active SC member
        const isActive = await isActiveMember(input.recipientAddress, coopId);

        if (!isActive) {
          return {
            isValid: false,
            isActiveMember: false,
            error: "Recipient is not an active SoulaaniCoin member",
          };
        }

        console.log('✅ Recipient is valid and active');
        return {
          isValid: true,
          isActiveMember: true,
        };
      } catch (error) {
        console.error('💥 ERROR in validateRecipient:', error);
        return {
          isValid: false,
          isActiveMember: false,
          error: "Failed to validate recipient",
        };
      }
    }),

  /**
   * Get user by username (for transfer recipient lookup)
   */
  getUserByUsername: privateProcedure
    .input(z.object({
      username: z.string(),
      coopId: z.string(),
    }))
    .output(z.object({
      walletAddress: z.string(),
      displayName: z.string(),
      email: z.string().optional(),
    }).nullable())
    .query(async ({ input, ctx }) => {
      const context = ctx as Context;

      console.log('\n🔷 getUserByUsername - START');
      console.log('👤 Username:', input.username);

      try {
        // Search in UserCoopMembership table
        const membership = await context.db.userCoopMembership.findFirst({
          where: { 
            username: input.username,
            coopId: input.coopId,
          },
          select: {
            user: {
              select: {
                walletAddress: true,
                name: true,
                email: true,
              },
            },
          },
        });

        if (!membership || !membership.user) {
          console.log('❌ User not found');
          return null;
        }

        console.log('✅ User found:', membership.user.walletAddress);
        return {
          walletAddress: membership.user.walletAddress || '',
          displayName: membership.user.name || 'Unknown',
          email: membership.user.email || undefined,
        };
      } catch (error) {
        console.error('💥 ERROR in getUserByUsername:', error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to find user",
          cause: error,
        });
      }
    }),

  /**
   * Get transfer history for a wallet address
   */
  getTransferHistory: privateProcedure
    .input(z.object({
      walletAddress: z.string(),
      fromBlock: z.string().optional(),
      limit: z.number().default(50),
    }))
    .output(z.object({
      transfers: z.array(z.object({
        from: z.string(),
        to: z.string(),
        value: z.string(),
        valueFormatted: z.string(),
        blockNumber: z.string(),
        transactionHash: z.string(),
        timestamp: z.number(),
        direction: z.enum(['sent', 'received']),
      })),
      hasMore: z.boolean(),
      lastBlock: z.string(),
    }))
    .query(async ({ input, ctx }) => {
      const coopId = (ctx as CoopScopedContext).coopId || '???';
      console.log('\n🔷 getTransferHistory - START');
      console.log('📍 Address:', input.walletAddress);

      try {
        const fromBlock = input.fromBlock ? BigInt(input.fromBlock) : undefined;
        const transfers = await getTransferEvents(input.walletAddress, coopId, fromBlock);

        // Limit results
        const limitedTransfers = transfers.slice(0, input.limit);
        const hasMore = transfers.length > input.limit;

        // Add direction flag
        const formattedTransfers = limitedTransfers.map(transfer => ({
          from: transfer.from,
          to: transfer.to,
          value: transfer.value.toString(),
          valueFormatted: transfer.valueFormatted,
          blockNumber: transfer.blockNumber.toString(),
          transactionHash: transfer.transactionHash,
          timestamp: transfer.timestamp,
          direction: transfer.from.toLowerCase() === input.walletAddress.toLowerCase()
            ? 'sent' as const
            : 'received' as const,
        }));

        const lastBlock: string = limitedTransfers.length > 0
          ? limitedTransfers[limitedTransfers.length - 1]!.blockNumber.toString()
          : '0';

        console.log(`✅ Found ${formattedTransfers.length} transfers`);
        return {
          transfers: formattedTransfers,
          hasMore,
          lastBlock,
        };
      } catch (error) {
        console.error('💥 ERROR in getTransferHistory:', error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch transfer history",
          cause: error,
        });
      }
    }),

  /**
   * Estimate gas cost for a transfer
   */
  estimateTransferGas: privateProcedure
    .input(z.object({
      from: z.string(),
      to: z.string(),
      amount: z.string(),
    }))
    .output(z.object({
      gasEstimate: z.string(),
      gasPrice: z.string(),
      totalCostETH: z.string(),
    }))
    .query(async ({ input, ctx }) => {
      console.log('\n🔷 estimateTransferGas - START');

      try {
        const coopId = ctx.coopId || '???';
        
        const coopConfig = await db.coopConfig.findFirst({
          where: { coopId, isActive: true },
        });

        if (!coopConfig || !coopConfig.ucTokenAddress) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `CoopConfig or UC token address not found for coopId: ${coopId}`,
          });
        }

        // Encode transfer function call
        const amountInWei = parseUCAmount(input.amount);
        const txData = encodeFunctionData({
          abi: unityCoinAbi,
          functionName: 'transfer',
          args: [input.to as Address, amountInWei],
        });

        // Estimate gas
        const gasEstimate = await estimateGas(input.from, coopConfig.ucTokenAddress as string, txData);
        const gasPrice = await getGasPrice();
        const totalCost = gasEstimate * gasPrice;

        console.log('✅ Gas estimate:', gasEstimate.toString());
        console.log('💰 Total cost:', formatUCAmount(totalCost), 'ETH');

        return {
          gasEstimate: gasEstimate.toString(),
          gasPrice: gasPrice.toString(),
          totalCostETH: formatUCAmount(totalCost),
        };
      } catch (error) {
        console.error('💥 ERROR in estimateTransferGas:', error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to estimate gas",
          cause: error,
        });
      }
    }),

  /**
   * Execute a UC transfer (backend signs and sends transaction)
   */
  executeTransfer: privateProcedure
    .input(z.object({
      userId: z.string(),
      recipientAddress: z.string(),
      amount: z.string(),
    }))
    .output(z.object({
      success: z.boolean(),
      transactionHash: z.string(),
      message: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as Context;
      const coopId = (ctx as CoopScopedContext).coopId || '???';

      console.log('\n🔷 executeTransfer - START');
      console.log('👤 User ID:', input.userId);
      console.log('📍 Recipient:', input.recipientAddress);
      console.log('💰 Amount:', input.amount, 'UC');

      try {
        // 0. Load CoopConfig
        const coopConfig = await db.coopConfig.findFirst({
          where: { coopId, isActive: true },
        });

        if (!coopConfig || !coopConfig.ucTokenAddress) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `CoopConfig or UC token address not found for coopId: ${coopId}`,
          });
        }

        // 1. Validate recipient is active SC member
        const isActive = await isActiveMember(input.recipientAddress, coopId);
        if (!isActive) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `That person isn't an active member yet, so they can't get ${coinNameFrom(coopConfig.scTokenName) ?? 'the coin'} yet.`,
          });
        }

        // 2. Get user's wallet address
        const user = await context.db.user.findUnique({
          where: { id: input.userId },
          select: { walletAddress: true },
        });

        if (!user?.walletAddress) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "User does not have a wallet",
          });
        }

        // 3. Check user's balance
        const { balance } = await getUCBalance(user.walletAddress, coopId);
        const amountInWei = parseUCAmount(input.amount);

        if (balance < amountInWei) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `You only have ${formatCoinAmount(formatUCAmount(balance), coinNameFrom(coopConfig.scTokenName))}, so you can't send that much.`,
          });
        }

        // 4. Build transfer transaction
        const txData = encodeFunctionData({
          abi: unityCoinAbi,
          functionName: 'transfer',
          args: [input.recipientAddress as Address, amountInWei],
        });

        // 5. Sign and send transaction
        console.log('📤 Sending transaction...');
        const txHash = await sendTransaction(
          input.userId,
          coopConfig.ucTokenAddress as Address,
          txData
        );

        console.log('✅ Transaction sent:', txHash);
        console.log('🎉 Transfer executed successfully');

        return {
          success: true,
          transactionHash: txHash,
          message: `Sent ${formatCoinAmount(input.amount, coinNameFrom(coopConfig.scTokenName))} to ${input.recipientAddress}.`,
        };
      } catch (error) {
        console.error('💥 ERROR in executeTransfer:', error);

        if (error instanceof TRPCError) {
          throw error;
        }

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to execute transfer. Please try again.",
          cause: error,
        });
      }
    }),
});
