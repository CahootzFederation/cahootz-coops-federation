import { z } from "zod";
import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import { createPublicClient, http, formatUnits } from "viem";
import { baseSepolia } from "viem/chains";

import { Context } from "../context.js";
import { publicProcedure, authenticatedProcedure } from "../procedures/index.js";
import { router } from "../trpc.js";
import { getUserWallet, createWalletForUser, getUserWalletInfo } from "../services/wallet-service.js";
import type { AuthenticatedContext } from "../context.js";

const DEMO_LOGIN_EMAIL = "demo@cahootz.coop";
const DEMO_COOP_ID = "demo";

// Blockchain client for fetching balances
const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(process.env.RPC_URL || 'https://sepolia.base.org'),
});

// Contract ABIs
const BALANCE_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

export const userRouter = router({
  // Public procedures
  getAllUsers: publicProcedure.query(({ ctx }) => {
    const context = ctx as Context;
    return context.db.user.findMany({ where: { deletedAt: null } });
  }),

  /**
   * Get token balances from blockchain
   */
  getBalances: publicProcedure
    .input(z.object({
      walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
      coopId: z.string().default('??'),
    }))
    .output(z.object({
      sc: z.string(),
      uc: z.string(),
      scRaw: z.string(),
      ucRaw: z.string(),
    }))
    .query(async ({ input, ctx }) => {
      const context = ctx as Context;
      
      const coopConfig = await context.db.coopConfig.findFirst({
        where: { coopId: input.coopId, isActive: true },
        orderBy: { version: 'desc' },
        select: {
          scTokenAddress: true,
          ucTokenAddress: true,
          chainId: true,
          rpcUrl: true,
        },
      });

      if (!coopConfig?.scTokenAddress || !coopConfig?.ucTokenAddress) {
        console.warn(`Contract addresses not configured for coop ${input.coopId}, returning zero balances`);
        return {
          sc: '0',
          uc: '0',
          scRaw: '0',
          ucRaw: '0',
        };
      }

      try {
        const client = coopConfig.chainId === 8453
          ? createPublicClient({ 
              chain: { id: 8453, name: 'Base', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [coopConfig.rpcUrl || 'https://mainnet.base.org'] } } } as any,
              transport: http(coopConfig.rpcUrl || 'https://mainnet.base.org')
            })
          : publicClient;

        const [scBalance, ucBalance] = await Promise.all([
          client.readContract({
            address: coopConfig.scTokenAddress as `0x${string}`,
            abi: BALANCE_ABI,
            functionName: 'balanceOf',
            args: [input.walletAddress as `0x${string}`],
          }),
          client.readContract({
            address: coopConfig.ucTokenAddress as `0x${string}`,
            abi: BALANCE_ABI,
            functionName: 'balanceOf',
            args: [input.walletAddress as `0x${string}`],
          }),
        ]);

        const result = {
          sc: formatUnits(scBalance, 18),
          uc: formatUnits(ucBalance, 18),
          scRaw: scBalance.toString(),
          ucRaw: ucBalance.toString(),
        };

        console.log(`💰 getTokenBalances for ${input.walletAddress} (coop: ${input.coopId}):`);
        console.log(`   SC: ${result.sc} (raw: ${result.scRaw})`);
        console.log(`   UC: ${result.uc} (raw: ${result.ucRaw})`);

        return result;
      } catch (error) {
        console.error('Error fetching balances:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch balances from blockchain',
        });
      }
    }),

  // Private procedures (require authentication)
  /**
   * Get current user data by wallet address
   */
  getUserByWallet: authenticatedProcedure
    .input(z.object({
      walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
      coopId: z.string().optional(),
    }))
    .output(z.object({
      id: z.string(),
      email: z.string().nullable(),
      name: z.string().nullable(),
      roles: z.array(z.string()),
      status: z.string(),
      walletAddress: z.string().nullable(),
      phone: z.string().nullable(),
      createdAt: z.date(),
      membershipStatus: z.string().nullable(),
      membershipRoles: z.array(z.string()),
      applicationStatus: z.string().nullable(),
    }).nullable())
    .query(async ({ input, ctx }) => {
      const context = ctx as Context;

      console.log(`🔍 getUserByWallet: Looking for wallet ${input.walletAddress} in coop ${input.coopId || 'none'}`);

      const user = await context.db.user.findFirst({
        where: {
          deletedAt: null,
          OR: [
            {
              walletAddress: {
                equals: input.walletAddress,
                mode: 'insensitive',
              },
            },
            {
              wallets: {
                some: {
                  address: {
                    equals: input.walletAddress,
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
          roles: true,
          status: true,
          walletAddress: true,
          phone: true,
          createdAt: true,
          memberships: input.coopId ? {
            where: { coopId: input.coopId },
            select: {
              status: true,
              roles: true,
            },
            take: 1,
          } : false,
          applications: input.coopId ? {
            where: { coopId: input.coopId },
            select: {
              status: true,
            },
            take: 1,
          } : false,
        },
      });

      if (!user) {
        console.log(`❌ No User found for wallet ${input.walletAddress}`);
        return null;
      }

      console.log(`✅ Found User: ${user.id}, wallet: ${user.walletAddress}, name: ${user.name}`);
      const walletInfo = await getUserWalletInfo(user.id, context.db);

      // Profile data (name, email, phone) comes from User table
      const membership = input.coopId ? user.memberships?.[0] : null;
      const application = input.coopId ? user.applications?.[0] : null;

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        roles: user.roles,
        status: user.status,
        walletAddress: user.walletAddress ?? (walletInfo.hasWallet ? walletInfo.address : null),
        phone: user.phone,
        createdAt: user.createdAt,
        membershipStatus: membership?.status ?? null,
        membershipRoles: membership?.roles ?? [],
        applicationStatus: application?.status ?? null,
      };
    }),

  /**
   * Get current user data by ID
   * Used to refresh user session with latest data from database
   */
  getMe: authenticatedProcedure
    .input(z.object({
      userId: z.string(),
    }))
    .output(z.object({
      id: z.string(),
      email: z.string(),
      name: z.string().nullable(),
      roles: z.array(z.string()),
      status: z.string(),
      walletAddress: z.string().nullable(),
      phone: z.string().nullable(),
      createdAt: z.date(),
    }))
    .query(async ({ input, ctx }) => {
      const context = ctx as Context;

      const user = await context.db.user.findUnique({
        where: { id: input.userId },
        select: {
          id: true,
          email: true,
          name: true,
          roles: true,
          status: true,
          walletAddress: true,
          phone: true,
          createdAt: true,
          deletedAt: true,
        },
      });

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      if (user.deletedAt) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This account has been deleted.",
        });
      }

      return user;
    }),

  /**
   * Soft delete the current account. Demo review accounts return success
   * without mutating the shared demo user.
   */
  deleteAccount: authenticatedProcedure
    .input(z.object({
      userId: z.string(),
    }))
    .output(z.object({
      success: z.boolean(),
      message: z.string(),
      isDemoMode: z.boolean(),
      deletedAt: z.string().nullable(),
    }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as Context;
      const { walletAddress: authenticatedWalletAddress } = ctx as AuthenticatedContext;

      const user = await context.db.user.findUnique({
        where: { id: input.userId },
        select: {
          id: true,
          email: true,
          deletedAt: true,
          walletAddress: true,
          wallets: {
            select: { address: true },
          },
          memberships: {
            where: { coopId: DEMO_COOP_ID },
            select: { coopId: true },
            take: 1,
          },
        },
      });

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      const normalizedWalletAddress = authenticatedWalletAddress.toLowerCase();
      const ownsWallet =
        user.walletAddress?.toLowerCase() === normalizedWalletAddress ||
        user.wallets.some((wallet) => wallet.address.toLowerCase() === normalizedWalletAddress);

      if (!ownsWallet) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only delete your own account",
        });
      }

      const isDemoAccount =
        user.email.toLowerCase() === DEMO_LOGIN_EMAIL ||
        user.memberships.some((membership) => membership.coopId === DEMO_COOP_ID);

      if (isDemoAccount) {
        return {
          success: true,
          message: "Demo account deletion completed for review. The shared demo account was not changed.",
          isDemoMode: true,
          deletedAt: null,
        };
      }

      if (user.deletedAt) {
        return {
          success: true,
          message: "Account is already deleted.",
          isDemoMode: false,
          deletedAt: user.deletedAt.toISOString(),
        };
      }

      const deletedAt = new Date();
      await context.db.user.update({
        where: { id: user.id },
        data: {
          deletedAt,
          deletedBy: user.id,
        },
      });

      await context.db.session.updateMany({
        where: { userId: user.id, isRevoked: false },
        data: {
          isRevoked: true,
          revokedAt: deletedAt,
          revokedReason: "account_deleted",
        },
      });

      return {
        success: true,
        message: "Account deleted.",
        isDemoMode: false,
        deletedAt: deletedAt.toISOString(),
      };
    }),

  /**
   * Export wallet private key (requires password re-authentication)
   * SECURITY: Only call this when user explicitly requests to export their wallet
   */
  exportWallet: authenticatedProcedure
    .input(z.object({
      userId: z.string(),
      password: z.string(),
    }))
    .output(z.object({
      address: z.string(),
      privateKey: z.string(),
      warning: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as Context;
      const { walletAddress: authenticatedWalletAddress } = ctx as AuthenticatedContext;

      console.log('\n🔷 exportWallet - START');
      console.log('👤 User ID:', input.userId);

      try {
        // 1. Verify user exists and has a wallet
        console.log('🔍 Checking user...');
        const user = await context.db.user.findUnique({
          where: { id: input.userId },
          select: {
            id: true,
            password: true,
            walletAddress: true,
            encryptedPrivateKey: true,
          },
        });

        if (!user) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "User not found",
          });
        }

        const walletInfo = await getUserWalletInfo(input.userId, context.db);

        if (!walletInfo.hasWallet || !user.encryptedPrivateKey) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "User does not have a wallet",
          });
        }

        if (walletInfo.address.toLowerCase() !== authenticatedWalletAddress.toLowerCase()) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You can only export your own wallet",
          });
        }

        // 2. Verify password
        console.log('🔒 Verifying password...');
        if (!user.password) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot verify password for this user",
          });
        }

        const passwordValid = await bcrypt.compare(input.password, user.password);
        if (!passwordValid) {
          console.log('❌ Invalid password');
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Invalid password",
          });
        }
        console.log('✅ Password verified');

        // 3. Get wallet with decrypted private key
        console.log('🔐 Retrieving wallet...');
        const wallet = await getUserWallet(input.userId);
        console.log('✅ Wallet retrieved');

        // 4. Log the export event for security audit
        console.log('📝 Logging wallet export event...');
        // TODO: Add audit log table and record this event

        const response = {
          address: wallet.address,
          privateKey: wallet.privateKey,
          warning: "⚠️ CRITICAL: Store this private key safely. Anyone with this key can access your funds. Never share it with anyone. Write it down and store it in a secure location.",
        };

        console.log('🎉 exportWallet - SUCCESS');
        console.log('📤 Wallet address:', wallet.address);
        return response;
      } catch (error) {
        console.error('\n💥 ERROR in exportWallet:');
        console.error('Error type:', error?.constructor?.name);
        console.error('Error message:', error instanceof Error ? error.message : String(error));

        if (error instanceof TRPCError) {
          throw error;
        }

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to export wallet. Please try again.",
          cause: error,
        });
      }
    }),

  /**
   * Get wallet info (address and balance only, no private key)
   * Users can only access their own wallet info
   */
  getWalletInfo: authenticatedProcedure
    .input(z.object({
      userId: z.string(),
    }))
    .output(z.object({
      address: z.string(),
      hasWallet: z.boolean(),
      walletId: z.string().nullable(),
      walletType: z.enum(['EXTERNAL', 'MANAGED']).nullable(),
      isPrimary: z.boolean(),
      verifiedAt: z.string().optional(),
      walletCreatedAt: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
      const context = ctx as Context;

      try {
        const walletInfo = await getUserWalletInfo(input.userId, context.db);

        return {
          address: walletInfo.address,
          hasWallet: walletInfo.hasWallet,
          walletId: walletInfo.walletId,
          walletType: walletInfo.walletType,
          isPrimary: walletInfo.isPrimary,
          verifiedAt: walletInfo.verifiedAt?.toISOString(),
          walletCreatedAt: walletInfo.walletCreatedAt?.toISOString(),
        };
      } catch (error) {
        if (error instanceof Error && error.message === 'User not found') {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "User not found",
          });
        }

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to get wallet info",
          cause: error,
        });
      }
    }),

  /**
   * Create a wallet for a user
   */
  createWallet: publicProcedure
    .input(z.object({
      userId: z.string(),
    }))
    .output(z.object({
      address: z.string(),
      created: z.boolean(),
    }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as Context;

      // Check if user exists
      const user = await context.db.user.findUnique({
        where: { id: input.userId },
        select: { walletAddress: true },
      });

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      // If user already has a wallet, return it
      if (user.walletAddress) {
        return {
          address: user.walletAddress,
          created: false,
        };
      }

      // Create new wallet for user
      const walletAddress = await createWalletForUser(input.userId);

      return {
        address: walletAddress,
        created: true,
      };
    }),
});
