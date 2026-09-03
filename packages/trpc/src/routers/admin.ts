import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createWalletForUser } from "../services/wallet-service.js";
import { syncMembershipToContract, getMemberStatus, MemberStatus, isActiveMember, getComprehensiveBlockchainInfo, getETHBalance, getUCTotalSupply } from "../services/blockchain.js";
import { Context, CoopScopedContext } from "../context.js";
import { publicProcedure, privateProcedure } from "../procedures/index.js";
import { router } from "../trpc.js";
import Stripe from "stripe";
import { sendApplicationAcceptedEmail, isEmailConfigured } from "../services/email-service.js";
import { createNotificationAndPush } from "../services/push-notification-service.js";

// Initialize Stripe (optional - only if key is configured)
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

function getPortalUrl(coopId: string): string | undefined {
  const baseUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_URI;
  if (!baseUrl) return undefined;
  return `${baseUrl.replace(/\/$/, "")}/portal/${coopId}`;
}

export const adminRouter = router({
  getCahootzOperatorOverview: privateProcedure
    .input(z.object({
      coopId: z.literal("cahootz"),
    }))
    .query(async ({ input, ctx }) => {
      const context = ctx as Context;
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const [
        totalUsers,
        onboardedUsers,
        missingWallets,
        activeMembers,
        pendingApplications,
        pushDevices,
        recentUsers,
        recentPosts,
        postClassifications,
        mediaPosts,
        commonsSuggestions,
      ] = await Promise.all([
        context.db.user.count({ where: { deletedAt: null } }),
        context.db.user.count({
          where: {
            deletedAt: null,
            profileOnboardingCompletedAt: { not: null },
          },
        }),
        context.db.user.count({
          where: {
            deletedAt: null,
            status: "ACTIVE",
            walletAddress: null,
          },
        }),
        context.db.userCoopMembership.count({
          where: {
            coopId: input.coopId,
            status: "ACTIVE",
          },
        }),
        context.db.userCoopMembership.count({
          where: {
            coopId: input.coopId,
            status: "PENDING",
          },
        }),
        context.db.pushDevice.count({
          where: {
            coopId: input.coopId,
            enabled: true,
          },
        }),
        context.db.user.findMany({
          where: { deletedAt: null },
          orderBy: { createdAt: "desc" },
          take: 8,
          select: {
            id: true,
            email: true,
            name: true,
            status: true,
            walletAddress: true,
            skills: true,
            interests: true,
            resourcesOffered: true,
            resourcesNeeded: true,
            profileOnboardingCompletedAt: true,
            createdAt: true,
          },
        }),
        context.db.commonsPost.findMany({
          where: {
            coopId: input.coopId,
            createdAt: { gte: sevenDaysAgo },
          },
          orderBy: { createdAt: "desc" },
          take: 10,
          include: {
            author: { select: { name: true, email: true } },
            _count: { select: { comments: true, supports: true, media: true } },
          },
        }),
        context.db.commonsPost.groupBy({
          by: ["classification"],
          where: { coopId: input.coopId },
          _count: { _all: true },
        }),
        context.db.commonsPost.count({
          where: {
            coopId: input.coopId,
            media: { some: {} },
          },
        }),
        context.db.commonsSuggestion.count({
          where: {
            coopId: input.coopId,
            status: "NEW",
          },
        }),
      ]);

      return {
        stats: {
          totalUsers,
          onboardedUsers,
          activeMembers,
          pendingApplications,
          missingWallets,
          pushDevices,
          mediaPosts,
          commonsSuggestions,
          onboardingRate: totalUsers ? Math.round((onboardedUsers / totalUsers) * 100) : 0,
        },
        postClassifications: postClassifications.map((item) => ({
          classification: item.classification || "social",
          count: item._count._all,
        })),
        recentUsers,
        recentPosts: recentPosts.map((post) => ({
          id: post.id,
          title: post.title,
          author: post.author.name || post.author.email.split("@")[0],
          classification: post.classification,
          createdAt: post.createdAt,
          commentCount: post._count.comments,
          supportCount: post._count.supports,
          mediaCount: post._count.media,
        })),
      };
    }),

  /**
   * Get all users with their applications for a specific coop
   * TODO: Add proper authentication - only admins should access this
   */
  getAllUsersWithApplications: publicProcedure
    .input(z.object({
      coopId: z.string(),
    }))
    .query(async ({ input, ctx }) => {
      const context = ctx as Context;

      // Get all memberships for this coop
      const memberships = await context.db.userCoopMembership.findMany({
        where: { coopId: input.coopId },
        include: {
          user: {
            include: {
              applications: {
                where: { coopId: input.coopId },
              },
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      // Map to user format with membership status
      return memberships.map(m => ({
        ...m.user,
        membershipStatus: m.status,
        membershipRoles: m.roles,
        joinedAt: m.joinedAt,
      }));
    }),

  /**
   * Get users by membership status for a specific coop
   */
  getUsersByStatus: publicProcedure
    .input(z.object({
      coopId: z.string(),
      status: z.enum(['PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED']),
    }))
    .query(async ({ input, ctx }) => {
      const context = ctx as Context;

      // Get memberships for this coop with the specified status
      const memberships = await context.db.userCoopMembership.findMany({
        where: {
          coopId: input.coopId,
          status: input.status,
        },
        include: {
          user: {
            include: {
              applications: {
                where: { coopId: input.coopId },
              },
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      // Map to user format with membership status
      return memberships.map(m => ({
        ...m.user,
        membershipStatus: m.status,
        membershipRoles: m.roles,
        joinedAt: m.joinedAt,
      }));
    }),

  /**
   * Get a single user with full application data
   */
  getUserWithApplication: publicProcedure
    .input(z.object({
      userId: z.string(),
    }))
    .query(async ({ input, ctx }) => {
      const context = ctx as Context;

      const user = await context.db.user.findUnique({
        where: {
          id: input.userId,
        },
        include: {
          applications: true,
        },
      });

      if (!user) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'User not found',
        });
      }

      return user;
    }),

  /**
   * Update user status for a specific coop
   * TODO: Add permission check - only admins with proper role should be able to update
   */
  updateUserStatus: publicProcedure
    .input(z.object({
      userId: z.string(),
      coopId: z.string(),
      status: z.enum(['PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED']),
      reviewNotes: z.string().optional(),
      // TODO: Add adminUserId to track who made the change
    }))
    .mutation(async ({ input, ctx }) => {
      console.log('\n🔷 updateUserStatus - START');
      console.log('📥 Received input:', JSON.stringify(input, null, 2));
      const context = ctx as Context;

      // TODO: Add permission check here
      // const adminUser = await context.db.user.findUnique({
      //   where: { id: input.adminUserId },
      // });
      // if (!adminUser || !adminUser.roles.includes('admin')) {
      //   throw new TRPCError({
      //     code: 'FORBIDDEN',
      //     message: 'Only admins can update user status',
      //   });
      // }

      // Update the coop-scoped membership status
      const membership = await context.db.userCoopMembership.update({
        where: {
          userId_coopId: {
            userId: input.userId,
            coopId: input.coopId,
          },
        },
        data: {
          status: input.status,
          ...(input.status === 'ACTIVE' && {
            approvedAt: new Date(),
            joinedAt: new Date(),
          }),
          ...(input.status === 'REJECTED' && {
            rejectedAt: new Date(),
            rejectionReason: input.reviewNotes,
          }),
        },
      });

      // Update the application for this specific coop
      await context.db.application.updateMany({
        where: {
          userId: input.userId,
          coopId: input.coopId,
        },
        data: {
          status: input.status === 'ACTIVE' ? 'APPROVED' :
                 input.status === 'REJECTED' ? 'REJECTED' : 
                 input.status === 'PENDING' ? 'SUBMITTED' : 'UNDER_REVIEW',
          reviewNotes: input.reviewNotes,
          reviewedAt: new Date(),
          // TODO: Add reviewedBy: input.adminUserId,
        },
      });

      // Also update global user status for backward compatibility
      // (can be removed once all code uses membership status)
      await context.db.user.update({
        where: {
          id: input.userId,
        },
        data: {
          status: input.status,
        },
      });

      if (input.status === 'ACTIVE' && isEmailConfigured()) {
        void (async () => {
          try {
            const [user, coopConfig] = await Promise.all([
              context.db.user.findUnique({
                where: { id: input.userId },
                select: { email: true, name: true },
              }),
              context.db.coopConfig.findFirst({
                where: { coopId: input.coopId, isActive: true },
                select: { name: true },
                orderBy: { version: 'desc' },
              }),
            ]);

            if (user?.email) {
              await sendApplicationAcceptedEmail({
                to: user.email,
                applicantName: user.name,
                coopName: coopConfig?.name,
                portalUrl: getPortalUrl(input.coopId),
              });
            }
          } catch (emailError) {
            console.error('Failed to send application acceptance email:', emailError);
          }
        })();
      }

      if (input.status === 'ACTIVE') {
        void createNotificationAndPush(context.db, {
          userId: input.userId,
          coopId: input.coopId,
          type: "COMMONS_APPLICATION_APPROVED",
          title: "You are in",
          body: "Your commons application was approved.",
          data: {
            coopId: input.coopId,
          },
        });
      }

      return membership;
    }),

  /**
   * Get pending applications (users with PENDING status)
   */
  getPendingApplications: publicProcedure
    .query(async ({ ctx }) => {
      const context = ctx as Context;

      const users = await context.db.user.findMany({
        where: {
          status: 'PENDING',
        },
        include: {
          applications: true,
        },
        orderBy: {
          createdAt: 'asc', // Oldest first
        },
      });

      return users;
    }),

  /**
   * Batch approve/reject applications
   */
  batchUpdateStatus: publicProcedure
    .input(z.object({
      userIds: z.array(z.string()),
      status: z.enum(['ACTIVE', 'REJECTED']),
      reviewNotes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as Context;

      // Update all users
      await context.db.user.updateMany({
        where: {
          id: {
            in: input.userIds,
          },
        },
        data: {
          status: input.status,
        },
      });

      // Update all applications
      await context.db.application.updateMany({
        where: {
          userId: {
            in: input.userIds,
          },
        },
        data: {
          status: input.status === 'ACTIVE' ? 'APPROVED' : 'REJECTED',
          reviewNotes: input.reviewNotes,
          reviewedAt: new Date(),
        },
      });

      if (input.status === 'ACTIVE' && isEmailConfigured()) {
        void (async () => {
          try {
            const users = await context.db.user.findMany({
              where: { id: { in: input.userIds } },
              select: {
                id: true,
                email: true,
                name: true,
                applications: {
                  where: { status: 'APPROVED' },
                  select: { coopId: true },
                  orderBy: { reviewedAt: 'desc' },
                  take: 1,
                },
              },
            });

            const coopIds = Array.from(new Set(users.flatMap((user) => user.applications.map((application) => application.coopId))));
            const coopConfigs = await context.db.coopConfig.findMany({
              where: { coopId: { in: coopIds }, isActive: true },
              select: { coopId: true, name: true },
            });
            const coopNames = new Map(coopConfigs.map((config) => [config.coopId, config.name]));

            await Promise.all(
              users
                .filter((user) => !!user.email)
                .map((user) => {
                  const coopId = user.applications[0]?.coopId;
                  return sendApplicationAcceptedEmail({
                    to: user.email,
                    applicantName: user.name,
                    coopName: coopId ? coopNames.get(coopId) : undefined,
                    portalUrl: coopId ? getPortalUrl(coopId) : undefined,
                  });
                }),
            );
          } catch (emailError) {
            console.error('Failed to send batch application acceptance emails:', emailError);
          }
        })();
      }

      return { success: true, count: input.userIds.length };
    }),

  /**
   * Get membership statistics for a specific coop
   */
  getApplicationStats: publicProcedure
    .input(z.object({
      coopId: z.string(),
    }))
    .query(async ({ input, ctx }) => {
      console.log('\n🔷 getApplicationStats - START');
      console.log(`📊 Coop ID: ${input.coopId}`);
      const context = ctx as Context;

      try {
        // Count memberships by status for this coop
        const [pending, active, rejected, suspended] = await Promise.all([
          context.db.userCoopMembership.count({ where: { coopId: input.coopId, status: 'PENDING' } }),
          context.db.userCoopMembership.count({ where: { coopId: input.coopId, status: 'ACTIVE' } }),
          context.db.userCoopMembership.count({ where: { coopId: input.coopId, status: 'REJECTED' } }),
          context.db.userCoopMembership.count({ where: { coopId: input.coopId, status: 'SUSPENDED' } }),
        ]);

        console.log(`✅ Stats calculated for ${input.coopId}:`, { pending, active, rejected, suspended });

        const result = {
          pending,
          active,
          rejected,
          suspended,
          total: pending + active + rejected + suspended,
        };

        console.log('🎉 getApplicationStats - SUCCESS');
        console.log('📤 Returning:', result);
        return result;
      } catch (error) {
        console.error('❌ Error in getApplicationStats:', error);
        throw error;
      }
    }),

  /**
   * Get all users without wallets
   */
  getUsersWithoutWallets: privateProcedure
    .query(async ({ ctx }) => {
      const context = ctx as Context;

      console.log('\n🔷 getUsersWithoutWallets - START');

      try {
        const users = await context.db.user.findMany({
          where: {
            walletAddress: null,
            status: "ACTIVE", // Only show active users
          },
          select: {
            id: true,
            email: true,
            name: true,
            status: true,
            createdAt: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
        });

        console.log(`✅ Found ${users.length} users without wallets`);
        return users;
      } catch (error) {
        console.error('💥 ERROR in getUsersWithoutWallets:', error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch users without wallets",
          cause: error,
        });
      }
    }),

  /**
   * Create wallet for a specific user (admin action)
   */
  createWalletForUserAdmin: privateProcedure
    .input(z.object({
      userId: z.string(),
    }))
    .output(z.object({
      success: z.boolean(),
      walletAddress: z.string(),
      message: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as Context;

      console.log('\n🔷 createWalletForUserAdmin - START');
      console.log('👤 User ID:', input.userId);

      try {
        // Check if user exists
        const user = await context.db.user.findUnique({
          where: { id: input.userId },
          select: {
            id: true,
            email: true,
            name: true,
            walletAddress: true,
          },
        });

        if (!user) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "User not found",
          });
        }

        if (user.walletAddress) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "User already has a wallet",
          });
        }

        // Create wallet
        console.log('🔐 Creating wallet...');
        const walletAddress = await createWalletForUser(input.userId);
        console.log('✅ Wallet created:', walletAddress);

        return {
          success: true,
          walletAddress,
          message: `Wallet ${walletAddress} created for ${user.name || user.email}`,
        };
      } catch (error) {
        console.error('💥 ERROR in createWalletForUserAdmin:', error);

        if (error instanceof TRPCError) {
          throw error;
        }

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create wallet",
          cause: error,
        });
      }
    }),

  /**
   * Bulk create wallets for multiple users
   */
  createBulkWallets: privateProcedure
    .input(z.object({
      userIds: z.array(z.string()),
    }))
    .output(z.object({
      success: z.boolean(),
      results: z.array(z.object({
        userId: z.string(),
        walletAddress: z.string().optional(),
        error: z.string().optional(),
      })),
      successCount: z.number(),
      failureCount: z.number(),
    }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as Context;

      console.log('\n🔷 createBulkWallets - START');
      console.log(`📦 Creating wallets for ${input.userIds.length} users`);

      const results = [];
      let successCount = 0;
      let failureCount = 0;

      for (const userId of input.userIds) {
        try {
          console.log(`\n🔐 Creating wallet for user ${userId}...`);

          // Check if user exists and doesn't have a wallet
          const user = await context.db.user.findUnique({
            where: { id: userId },
            select: { id: true, walletAddress: true },
          });

          if (!user) {
            console.log(`❌ User ${userId} not found`);
            results.push({
              userId,
              error: "User not found",
            });
            failureCount++;
            continue;
          }

          if (user.walletAddress) {
            console.log(`⚠️ User ${userId} already has wallet`);
            results.push({
              userId,
              walletAddress: user.walletAddress,
              error: "User already has a wallet",
            });
            failureCount++;
            continue;
          }

          // Create wallet
          const walletAddress = await createWalletForUser(userId);
          console.log(`✅ Wallet created for ${userId}: ${walletAddress}`);

          results.push({
            userId,
            walletAddress,
          });
          successCount++;
        } catch (error) {
          console.error(`💥 Error creating wallet for ${userId}:`, error);
          results.push({
            userId,
            error: error instanceof Error ? error.message : "Unknown error",
          });
          failureCount++;
        }
      }

      console.log(`\n✅ Bulk wallet creation complete`);
      console.log(`✓ Success: ${successCount}`);
      console.log(`✗ Failed: ${failureCount}`);

      return {
        success: true,
        results,
        successCount,
        failureCount,
      };
    }),

  /**
   * Get all users with wallet information
   */
  getAllUsersWithWallets: privateProcedure
    .query(async ({ ctx }) => {
      const context = ctx as Context;

      console.log('\n🔷 getAllUsersWithWallets - START');

      try {
        const users = await context.db.user.findMany({
          select: {
            id: true,
            email: true,
            name: true,
            walletAddress: true,
            walletCreatedAt: true,
            status: true,
            createdAt: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
        });

        console.log(`✅ Found ${users.length} users`);
        return users.map(user => ({
          ...user,
          hasWallet: !!user.walletAddress,
          walletCreatedAt: user.walletCreatedAt?.toISOString(),
          createdAt: user.createdAt.toISOString(),
        }));
      } catch (error) {
        console.error('💥 ERROR in getAllUsersWithWallets:', error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch users",
          cause: error,
        });
      }
    }),

  /**
   * Get a user's membership status on the blockchain
   */
  getContractMemberStatus: privateProcedure
    .input(z.object({
      walletAddress: z.string(),
    }))
    .output(z.object({
      walletAddress: z.string(),
      contractStatus: z.string(),
      contractStatusCode: z.number(),
      isActiveMember: z.boolean(),
    }))
    .query(async ({ input, ctx }) => {
      const coopId = (ctx as CoopScopedContext).coopId || '???';
      console.log(`\n🔷 getContractMemberStatus for ${input.walletAddress}`);

      try {
        const status = await getMemberStatus(input.walletAddress, coopId);
        const isActive = await isActiveMember(input.walletAddress, coopId);

        return {
          walletAddress: input.walletAddress,
          contractStatus: MemberStatus[status],
          contractStatusCode: status,
          isActiveMember: isActive,
        };
      } catch (error) {
        console.error('💥 ERROR in getContractMemberStatus:', error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to get contract member status",
          cause: error,
        });
      }
    }),

  /**
   * Sync a user's membership status from DB to blockchain contract
   */
  syncMembershipToContract: privateProcedure
    .input(z.object({
      userId: z.string(),
      coopId: z.string().optional(), // Make coopId explicit
    }))
    .output(z.object({
      success: z.boolean(),
      action: z.string(),
      txHash: z.string().optional(),
      error: z.string().optional(),
      dbStatus: z.string(),
      contractStatusBefore: z.string(),
      contractStatusAfter: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as Context;
      const coopId = input.coopId || (ctx as CoopScopedContext).coopId || '???';

      console.log(`\n🔷 syncMembershipToContract for user ${input.userId} in coop ${coopId}`);

      // Get backend wallet private key from environment
      const backendWalletPrivateKey = process.env.BACKEND_WALLET_PRIVATE_KEY;

      if (!backendWalletPrivateKey) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Backend wallet private key is not configured",
        });
      }

      try {
        // Get user and their membership for this coop
        const user = await context.db.user.findUnique({
          where: { id: input.userId },
          select: { 
            walletAddress: true, 
            name: true, 
            email: true,
          },
        });

        if (!user) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "User not found",
          });
        }

        if (!user.walletAddress) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "User does not have a wallet address",
          });
        }

        // Get the coop-scoped membership status
        const membership = await context.db.userCoopMembership.findUnique({
          where: {
            userId_coopId: {
              userId: input.userId,
              coopId: coopId,
            },
          },
          select: { status: true },
        });

        if (!membership) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "User is not a member of this coop",
          });
        }

        // Get current contract status
        const contractStatusBefore = await getMemberStatus(user.walletAddress, coopId);

        // Sync to contract using the coop-scoped membership status
        const result = await syncMembershipToContract(
          user.walletAddress,
          membership.status,
          backendWalletPrivateKey,
          coopId
        );

        // Get new contract status if successful
        let contractStatusAfter: string | undefined;
        if (result.success && result.action !== 'already_synced') {
          const newStatus = await getMemberStatus(user.walletAddress, coopId);
          contractStatusAfter = MemberStatus[newStatus];
        }

        console.log(`✅ Sync complete: ${result.action}`);

        return {
          success: result.success,
          action: result.action,
          txHash: result.txHash,
          error: result.error,
          dbStatus: membership.status,
          contractStatusBefore: MemberStatus[contractStatusBefore],
          contractStatusAfter,
        };
      } catch (error) {
        console.error('💥 ERROR in syncMembershipToContract:', error);

        if (error instanceof TRPCError) {
          throw error;
        }

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to sync membership",
          cause: error,
        });
      }
    }),

  /**
   * Bulk sync all active users' membership to contract
   */
  bulkSyncMemberships: privateProcedure
    .output(z.object({
      success: z.boolean(),
      total: z.number(),
      synced: z.number(),
      alreadySynced: z.number(),
      failed: z.number(),
      results: z.array(z.object({
        userId: z.string(),
        walletAddress: z.string().optional(),
        action: z.string(),
        error: z.string().optional(),
      })),
    }))
    .mutation(async ({ ctx }) => {
      const context = ctx as Context;
      const coopId = (ctx as CoopScopedContext).coopId || '???';

      console.log(`\n🔷 bulkSyncMemberships - START`);

      // Get backend wallet private key from environment
      const backendWalletPrivateKey = process.env.BACKEND_WALLET_PRIVATE_KEY;

      if (!backendWalletPrivateKey) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Backend wallet private key is not configured",
        });
      }

      try {
        // Get all active users with wallets
        const users = await context.db.user.findMany({
          where: {
            status: 'ACTIVE',
            walletAddress: { not: null },
          },
          select: { id: true, walletAddress: true, status: true },
        });

        console.log(`📋 Found ${users.length} active users with wallets`);

        const results: Array<{
          userId: string;
          walletAddress?: string;
          action: string;
          error?: string;
        }> = [];
        let synced = 0;
        let alreadySynced = 0;
        let failed = 0;

        for (const user of users) {
          try {
            const result = await syncMembershipToContract(
              user.walletAddress!,
              user.status,
              backendWalletPrivateKey,
              coopId
            );

            if (result.success) {
              if (result.action === 'already_synced') {
                alreadySynced++;
              } else {
                synced++;
              }
              results.push({
                userId: user.id,
                walletAddress: user.walletAddress!,
                action: result.action,
              });
            } else {
              failed++;
              results.push({
                userId: user.id,
                walletAddress: user.walletAddress!,
                action: 'failed',
                error: result.error,
              });
            }
          } catch (error) {
            failed++;
            results.push({
              userId: user.id,
              walletAddress: user.walletAddress!,
              action: 'failed',
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        }

        console.log(`\n✅ Bulk sync complete`);
        console.log(`   Total: ${users.length}`);
        console.log(`   Synced: ${synced}`);
        console.log(`   Already synced: ${alreadySynced}`);
        console.log(`   Failed: ${failed}`);

        return {
          success: true,
          total: users.length,
          synced,
          alreadySynced,
          failed,
          results,
        };
      } catch (error) {
        console.error('💥 ERROR in bulkSyncMemberships:', error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to bulk sync memberships",
          cause: error,
        });
      }
    }),

  /**
   * Get comprehensive blockchain info for a user
   * Includes ETH balance, UC balance, SC balance, membership status
   */
  getUserBlockchainInfo: privateProcedure
    .input(z.object({
      userId: z.string(),
    }))
    .output(z.object({
      user: z.object({
        id: z.string(),
        name: z.string().nullable(),
        email: z.string(),
        status: z.string(),
        walletAddress: z.string().nullable(),
      }),
      blockchain: z.object({
        walletAddress: z.string(),
        ethBalance: z.object({
          balance: z.string(),
          formatted: z.string(),
        }),
        ucBalance: z.object({
          balance: z.string(),
          formatted: z.string(),
        }),
        scBalance: z.object({
          balance: z.string(),
          formatted: z.string(),
        }),
        memberStatus: z.number(),
        memberStatusLabel: z.string(),
        isActiveMember: z.boolean(),
        isMember: z.boolean(),
      }).nullable(),
      comparison: z.object({
        dbStatus: z.string(),
        contractStatus: z.string(),
        isSynced: z.boolean(),
        syncAction: z.string().nullable(),
      }).nullable(),
    }))
    .query(async ({ input, ctx }) => {
      const context = ctx as Context;
      const coopId = (ctx as CoopScopedContext).coopId || '???';

      console.log(`\n🔷 getUserBlockchainInfo for user ${input.userId}`);

      try {
        // Get user from DB
        const user = await context.db.user.findUnique({
          where: { id: input.userId },
          select: {
            id: true,
            name: true,
            email: true,
            status: true,
            walletAddress: true,
          },
        });

        if (!user) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "User not found",
          });
        }

        // If no wallet, return just user info
        if (!user.walletAddress) {
          return {
            user,
            blockchain: null,
            comparison: null,
          };
        }

        // Get comprehensive blockchain info
        const blockchainInfo = await getComprehensiveBlockchainInfo(user.walletAddress, coopId);

        // Determine if DB and contract are in sync
        let expectedContractStatus: MemberStatus;
        switch (user.status.toUpperCase()) {
          case 'ACTIVE':
            expectedContractStatus = MemberStatus.Active;
            break;
          case 'SUSPENDED':
            expectedContractStatus = MemberStatus.Suspended;
            break;
          case 'BANNED':
            expectedContractStatus = MemberStatus.Banned;
            break;
          default:
            expectedContractStatus = MemberStatus.NotMember;
        }

        const isSynced = blockchainInfo.memberStatus === expectedContractStatus;
        let syncAction: string | null = null;

        if (!isSynced) {
          if (blockchainInfo.memberStatus === MemberStatus.NotMember && expectedContractStatus === MemberStatus.Active) {
            syncAction = 'Need to add as member';
          } else {
            syncAction = `Need to update from ${blockchainInfo.memberStatusLabel} to ${MemberStatus[expectedContractStatus]}`;
          }
        }

        return {
          user,
          blockchain: blockchainInfo,
          comparison: {
            dbStatus: user.status,
            contractStatus: blockchainInfo.memberStatusLabel,
            isSynced,
            syncAction,
          },
        };
      } catch (error) {
        console.error('💥 ERROR in getUserBlockchainInfo:', error);

        if (error instanceof TRPCError) {
          throw error;
        }

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to get blockchain info",
          cause: error,
        });
      }
    }),

  /**
   * Get backend wallet status (for gas-free transactions)
   * Shows ETH balance and wallet address
   */
  getBackendWalletStatus: privateProcedure
    .input(z.object({
      coopId: z.string().default('???'),
    }).optional())
    .output(z.object({
      configured: z.boolean(),
      walletAddress: z.string().nullable(),
      ethBalance: z.object({
        balance: z.string(),
        formatted: z.string(),
      }).nullable(),
      isLow: z.boolean(),
      warningMessage: z.string().nullable(),
    }))
    .query(async ({ ctx, input }) => {
      console.log(`\n🔷 getBackendWalletStatus`);

      const context = ctx as Context;
      const coopId = input?.coopId ?? '???';

      const activeConfig = await context.db.coopConfig.findFirst({
        where: { coopId, isActive: true },
        orderBy: { version: 'desc' },
        select: { backendWalletAddress: true },
      });

      const walletAddress = activeConfig?.backendWalletAddress;

      if (!walletAddress) {
        return {
          configured: false,
          walletAddress: null,
          ethBalance: null,
          isLow: true,
          warningMessage: 'No backend wallet address is configured for this coop',
        };
      }

      try {
        // Get ETH balance
        const ethBalance = await getETHBalance(walletAddress);
        const balanceNum = parseFloat(ethBalance.formatted);

        // Determine if balance is low
        // On Base L2, each user funding = 0.0005 ETH, so 0.005 ETH = ~10 users
        const isLow = balanceNum < 0.005;
        let warningMessage: string | null = null;

        if (balanceNum === 0) {
          warningMessage = 'Backend wallet has no ETH! Gas-free transactions will fail.';
        } else if (balanceNum < 0.001) {
          warningMessage = 'Backend wallet is critically low (~2 users). Please fund it soon.';
        } else if (balanceNum < 0.005) {
          warningMessage = 'Backend wallet is getting low (~10 users). Consider adding more funds.';
        }

        return {
          configured: true,
          walletAddress,
          ethBalance: {
            balance: ethBalance.balance.toString(),
            formatted: ethBalance.formatted,
          },
          isLow,
          warningMessage,
        };
      } catch (error) {
        console.error('💥 ERROR in getBackendWalletStatus:', error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to get backend wallet status",
          cause: error,
        });
      }
    }),

  /**
   * Get all P2P transfers with user details
   */
  getAllP2PTransfers: privateProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
      status: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED']).optional(),
    }))
    .query(async ({ input, ctx }) => {
      const context = ctx as Context;

      const where = input.status ? { status: input.status } : {};

      const [transfers, total] = await Promise.all([
        context.db.p2PTransfer.findMany({
          where,
          include: {
            sender: {
              select: { id: true, name: true, email: true, walletAddress: true },
            },
            recipient: {
              select: { id: true, name: true, email: true, walletAddress: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: input.limit,
          skip: input.offset,
        }),
        context.db.p2PTransfer.count({ where }),
      ]);

      return {
        transfers: transfers.map((t) => ({
          id: t.id,
          sender: {
            id: t.sender.id,
            name: t.sender.name || t.sender.email,
            email: t.sender.email,
            walletAddress: t.sender.walletAddress,
          },
          recipient: {
            id: t.recipient.id,
            name: t.recipient.name || t.recipient.email,
            email: t.recipient.email,
            walletAddress: t.recipient.walletAddress,
          },
          amountUSD: t.amountUSD,
          amountUC: t.amountUC,
          fundingSource: t.fundingSource,
          status: t.status,
          note: t.note,
          blockchainTxHash: t.blockchainTxHash,
          createdAt: t.createdAt.toISOString(),
          completedAt: t.completedAt?.toISOString(),
          failedAt: t.failedAt?.toISOString(),
          failureReason: t.failureReason,
        })),
        total,
        hasMore: input.offset + transfers.length < total,
      };
    }),

  /**
   * Get all onramp transactions with user details
   */
  getAllOnrampTransactions: privateProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
      status: z.enum(['PENDING', 'COMPLETED', 'FAILED', 'REFUNDED']).optional(),
    }))
    .query(async ({ input, ctx }) => {
      const context = ctx as Context;

      const where = input.status ? { status: input.status } : {};

      const [transactions, total] = await Promise.all([
        context.db.onrampTransaction.findMany({
          where,
          include: {
            user: {
              select: { id: true, name: true, email: true, walletAddress: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: input.limit,
          skip: input.offset,
        }),
        context.db.onrampTransaction.count({ where }),
      ]);

      return {
        transactions: transactions.map((t) => ({
          id: t.id,
          user: {
            id: t.user.id,
            name: t.user.name || t.user.email,
            email: t.user.email,
            walletAddress: t.user.walletAddress,
          },
          amountUSD: t.amountUSD,
          amountUC: t.amountUC,
          processor: t.processor,
          status: t.status,
          mintTxHash: t.mintTxHash,
          createdAt: t.createdAt.toISOString(),
          completedAt: t.completedAt?.toISOString(),
          failedAt: t.failedAt?.toISOString(),
          failureReason: t.failureReason,
        })),
        total,
        hasMore: input.offset + transactions.length < total,
      };
    }),

  /**
   * Get all withdrawals with user details
   */
  getAllWithdrawals: privateProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
      status: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED']).optional(),
    }))
    .query(async ({ input, ctx }) => {
      const context = ctx as Context;

      const where = input.status ? { status: input.status } : {};

      const [withdrawals, total] = await Promise.all([
        context.db.withdrawal.findMany({
          where,
          include: {
            user: {
              select: { id: true, name: true, email: true, walletAddress: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: input.limit,
          skip: input.offset,
        }),
        context.db.withdrawal.count({ where }),
      ]);

      return {
        withdrawals: withdrawals.map((w) => ({
          id: w.id,
          user: {
            id: w.user.id,
            name: w.user.name || w.user.email,
            email: w.user.email,
            walletAddress: w.user.walletAddress,
          },
          amountUSD: w.amountUSD,
          amountUC: w.amountUC,
          bankAccountId: w.bankAccountId,
          status: w.status,
          stripePayoutId: w.stripePayoutId,
          createdAt: w.createdAt.toISOString(),
          completedAt: w.completedAt?.toISOString(),
          failedAt: w.failedAt?.toISOString(),
          failureReason: w.failureReason,
        })),
        total,
        hasMore: input.offset + withdrawals.length < total,
      };
    }),

  /**
   * Get transaction stats summary
   */
  getTransactionStats: privateProcedure
    .query(async ({ ctx }) => {
      const context = ctx as Context;

      const [
        p2pTotal,
        p2pCompleted,
        p2pPending,
        onrampTotal,
        onrampCompleted,
        withdrawalTotal,
        withdrawalCompleted,
      ] = await Promise.all([
        context.db.p2PTransfer.count(),
        context.db.p2PTransfer.count({ where: { status: 'COMPLETED' } }),
        context.db.p2PTransfer.count({ where: { status: 'PENDING' } }),
        context.db.onrampTransaction.count(),
        context.db.onrampTransaction.count({ where: { status: 'COMPLETED' } }),
        context.db.withdrawal.count(),
        context.db.withdrawal.count({ where: { status: 'COMPLETED' } }),
      ]);

      // Get volume sums
      const p2pVolume = await context.db.p2PTransfer.aggregate({
        where: { status: 'COMPLETED' },
        _sum: { amountUSD: true },
      });

      const onrampVolume = await context.db.onrampTransaction.aggregate({
        where: { status: 'COMPLETED' },
        _sum: { amountUSD: true },
      });

      const withdrawalVolume = await context.db.withdrawal.aggregate({
        where: { status: 'COMPLETED' },
        _sum: { amountUSD: true },
      });

      return {
        p2p: {
          total: p2pTotal,
          completed: p2pCompleted,
          pending: p2pPending,
          volumeUSD: p2pVolume._sum.amountUSD || 0,
        },
        onramp: {
          total: onrampTotal,
          completed: onrampCompleted,
          volumeUSD: onrampVolume._sum.amountUSD || 0,
        },
        withdrawal: {
          total: withdrawalTotal,
          completed: withdrawalCompleted,
          volumeUSD: withdrawalVolume._sum.amountUSD || 0,
        },
      };
    }),

  /**
   * Get comprehensive treasury overview
   * Shows UC supply, Stripe balance, transaction volumes by time period
   */
  getTreasuryOverview: privateProcedure
    .query(async ({ ctx }) => {
      const context = ctx as Context;

      console.log('\n🔷 getTreasuryOverview - START');

      // Time periods
      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      try {
        // Get UC total supply from blockchain
        let ucTotalSupply = { totalSupply: '0', formatted: '0' };
        try {
          const supply = await getUCTotalSupply();
          ucTotalSupply = {
            totalSupply: supply.totalSupply.toString(),
            formatted: supply.formatted,
          };
        } catch (error) {
          console.warn('⚠️ Could not fetch UC total supply:', error);
        }

        // Get Stripe balance (if configured)
        let stripeBalance = null;
        if (stripe) {
          try {
            const balance = await stripe.balance.retrieve();
            stripeBalance = {
              available: balance.available.map(b => ({
                amount: b.amount / 100,
                currency: b.currency.toUpperCase(),
              })),
              pending: balance.pending.map(b => ({
                amount: b.amount / 100,
                currency: b.currency.toUpperCase(),
              })),
            };
          } catch (error) {
            console.warn('⚠️ Could not fetch Stripe balance:', error);
          }
        }

        // Calculate volumes by time period
        const getVolumeByPeriod = async (since: Date) => {
          const [onramp, p2p, withdrawal, storePurchases] = await Promise.all([
            context.db.onrampTransaction.aggregate({
              where: { status: 'COMPLETED', completedAt: { gte: since } },
              _sum: { amountUSD: true },
              _count: true,
            }),
            context.db.p2PTransfer.aggregate({
              where: { status: 'COMPLETED', completedAt: { gte: since } },
              _sum: { amountUSD: true },
              _count: true,
            }),
            context.db.withdrawal.aggregate({
              where: { status: 'COMPLETED', completedAt: { gte: since } },
              _sum: { amountUSD: true },
              _count: true,
            }),
            context.db.storeOrder.aggregate({
              where: { paymentStatus: 'COMPLETED', createdAt: { gte: since } },
              _sum: { totalUSD: true },
              _count: true,
            }),
          ]);

          return {
            onramp: {
              volumeUSD: onramp._sum.amountUSD || 0,
              count: onramp._count,
            },
            p2p: {
              volumeUSD: p2p._sum.amountUSD || 0,
              count: p2p._count,
            },
            withdrawal: {
              volumeUSD: withdrawal._sum.amountUSD || 0,
              count: withdrawal._count,
            },
            storePurchases: {
              volumeUSD: storePurchases._sum?.totalUSD || 0,
              count: storePurchases._count,
            },
          };
        };

        // All-time totals
        const [allTimeOnramp, allTimeP2P, allTimeWithdrawal, allTimeStorePurchases, onrampByProcessor, storesByVolume] = await Promise.all([
          context.db.onrampTransaction.aggregate({
            where: { status: 'COMPLETED' },
            _sum: { amountUSD: true, amountUC: true },
            _count: true,
          }),
          context.db.p2PTransfer.aggregate({
            where: { status: 'COMPLETED' },
            _sum: { amountUSD: true },
            _count: true,
          }),
          context.db.withdrawal.aggregate({
            where: { status: 'COMPLETED' },
            _sum: { amountUSD: true },
            _count: true,
          }),
          context.db.storeOrder.aggregate({
            where: { paymentStatus: 'COMPLETED' },
            _sum: { totalUSD: true },
            _count: true,
          }),
          context.db.onrampTransaction.groupBy({
            by: ['processor'],
            where: { status: 'COMPLETED' },
            _sum: { amountUSD: true, amountUC: true },
            _count: true,
            orderBy: {
              _sum: {
                amountUSD: 'desc',
              },
            },
          }),
          context.db.storeOrder.groupBy({
            by: ['storeId'],
            where: { paymentStatus: 'COMPLETED' },
            _sum: { totalUSD: true },
            _count: true,
            orderBy: {
              _sum: {
                totalUSD: 'desc',
              },
            },
            take: 10, // Top 10 stores
          }),
        ]);

        // Get volumes by time period in parallel
        const [last24h, last7d, last30d] = await Promise.all([
          getVolumeByPeriod(oneDayAgo),
          getVolumeByPeriod(sevenDaysAgo),
          getVolumeByPeriod(thirtyDaysAgo),
        ]);

        // Pending transfers (escrow)
        const pendingEscrow = await context.db.pendingTransfer.aggregate({
          where: { status: 'PENDING_CLAIM' },
          _sum: { amountUSD: true },
          _count: true,
        });

        // User stats
        const [totalUsers, activeUsers, usersWithWallets] = await Promise.all([
          context.db.user.count(),
          context.db.user.count({ where: { status: 'ACTIVE' } }),
          context.db.user.count({ where: { walletAddress: { not: null } } }),
        ]);

        // Get store names for top stores
        const storeIds = storesByVolume.map(s => s.storeId);
        const stores = await context.db.store.findMany({
          where: { id: { in: storeIds } },
          select: { id: true, name: true, isScVerified: true },
        });
        const storeMap = new Map(stores.map(s => [s.id, s]));

        console.log('✅ getTreasuryOverview - SUCCESS');

        return {
          // UC in circulation
          ucCirculation: {
            totalSupply: ucTotalSupply.formatted,
            totalSupplyRaw: ucTotalSupply.totalSupply,
          },

          // Stripe balance (USD held)
          stripeBalance,

          // All-time totals
          allTime: {
            onramp: {
              volumeUSD: allTimeOnramp._sum.amountUSD || 0,
              createdUC: allTimeOnramp._sum.amountUC || 0,
              count: allTimeOnramp._count,
            },
            p2p: {
              volumeUSD: allTimeP2P._sum.amountUSD || 0,
              count: allTimeP2P._count,
            },
            withdrawal: {
              volumeUSD: allTimeWithdrawal._sum.amountUSD || 0,
              count: allTimeWithdrawal._count,
            },
            storePurchases: {
              volumeUSD: allTimeStorePurchases._sum?.totalUSD || 0,
              count: allTimeStorePurchases._count,
            },
            netFlow: (allTimeOnramp._sum.amountUSD || 0) - (allTimeWithdrawal._sum.amountUSD || 0),
          },

          // Completed onramp by processor (transaction-backed)
          onrampByProcessor: onrampByProcessor.map((entry) => ({
            processor: entry.processor,
            volumeUSD: entry._sum.amountUSD || 0,
            createdUC: entry._sum.amountUC || 0,
            count: entry._count,
          })),

          // Top stores by volume
          topStores: storesByVolume.map((entry) => {
            const store = storeMap.get(entry.storeId);
            return {
              storeId: entry.storeId,
              storeName: store?.name || 'Unknown Store',
              scVerified: store?.isScVerified || false,
              volumeUSD: entry._sum?.totalUSD || 0,
              count: entry._count,
            };
          }),

          // Time-based volumes
          last24h,
          last7d,
          last30d,

          // Pending escrow
          escrow: {
            amountUSD: pendingEscrow._sum.amountUSD || 0,
            count: pendingEscrow._count,
          },

          // User stats
          users: {
            total: totalUsers,
            active: activeUsers,
            withWallets: usersWithWallets,
          },

          // Timestamp
          generatedAt: now.toISOString(),
        };
      } catch (error) {
        console.error('💥 ERROR in getTreasuryOverview:', error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to get treasury overview",
          cause: error,
        });
      }
    }),

  /**
   * Get transaction volume over time (for charts)
   */
  getTransactionVolumeChart: privateProcedure
    .input(z.object({
      period: z.enum(['7d', '30d', '90d']).default('30d'),
      type: z.enum(['onramp', 'p2p', 'withdrawal', 'store', 'all']).default('all'),
    }))
    .query(async ({ input, ctx }) => {
      const context = ctx as Context;

      const now = new Date();
      let daysBack: number;
      switch (input.period) {
        case '7d':
          daysBack = 7;
          break;
        case '90d':
          daysBack = 90;
          break;
        default:
          daysBack = 30;
      }

      const startDate = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);

      // Generate date buckets
      const buckets: { date: string; onramp: number; p2p: number; withdrawal: number; store: number }[] = [];
      for (let i = 0; i < daysBack; i++) {
        const date = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
        buckets.push({
          date: date.toISOString().split('T')[0]!,
          onramp: 0,
          p2p: 0,
          withdrawal: 0,
          store: 0,
        });
      }

      // Get transactions by day
      if (input.type === 'all' || input.type === 'onramp') {
        const onrampTxs = await context.db.onrampTransaction.findMany({
          where: {
            status: 'COMPLETED',
            completedAt: { gte: startDate },
          },
          select: { completedAt: true, amountUSD: true },
        });
        for (const tx of onrampTxs) {
          if (tx.completedAt) {
            const dateKey = tx.completedAt.toISOString().split('T')[0];
            const bucket = buckets.find(b => b.date === dateKey);
            if (bucket) bucket.onramp += tx.amountUSD;
          }
        }
      }

      if (input.type === 'all' || input.type === 'p2p') {
        const p2pTxs = await context.db.p2PTransfer.findMany({
          where: {
            status: 'COMPLETED',
            completedAt: { gte: startDate },
          },
          select: { completedAt: true, amountUSD: true },
        });
        for (const tx of p2pTxs) {
          if (tx.completedAt) {
            const dateKey = tx.completedAt.toISOString().split('T')[0];
            const bucket = buckets.find(b => b.date === dateKey);
            if (bucket) bucket.p2p += tx.amountUSD;
          }
        }
      }

      if (input.type === 'all' || input.type === 'withdrawal') {
        const withdrawalTxs = await context.db.withdrawal.findMany({
          where: {
            status: 'COMPLETED',
            completedAt: { gte: startDate },
          },
          select: { completedAt: true, amountUSD: true },
        });
        for (const tx of withdrawalTxs) {
          if (tx.completedAt) {
            const dateKey = tx.completedAt.toISOString().split('T')[0];
            const bucket = buckets.find(b => b.date === dateKey);
            if (bucket) bucket.withdrawal += tx.amountUSD;
          }
        }
      }

      if (input.type === 'all' || input.type === 'store') {
        const storeTxs = await context.db.storeOrder.findMany({
          where: {
            paymentStatus: 'COMPLETED',
            createdAt: { gte: startDate },
          },
          select: { createdAt: true, totalUSD: true },
        });
        for (const tx of storeTxs) {
          const dateKey = tx.createdAt.toISOString().split('T')[0];
          const bucket = buckets.find(b => b.date === dateKey);
          if (bucket) bucket.store += tx.totalUSD;
        }
      }

      return {
        period: input.period,
        type: input.type,
        data: buckets,
      };
    }),
});
