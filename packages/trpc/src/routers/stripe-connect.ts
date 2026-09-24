import { z } from 'zod';
import { router } from '../trpc.js';
import { authenticatedProcedure, privateProcedure } from '../procedures/index.js';
import { db } from '@repo/db';
import { TRPCError } from '@trpc/server';
import type { AuthenticatedContext } from '../context.js';
import {
  createConnectAccount,
  generateOnboardingLink,
  syncAccountStatus,
  canAcceptPayments,
  canReceivePayouts,
  getOnboardingStatus,
  getOnboardingHistory,
} from '../services/stripe-connect-service.js';

export const stripeConnectRouter = router({
  /**
   * Create or reuse a Business entity for a Store, then start Stripe Connect.
   * Stores go live once Stripe enables charges.
   */
  createBusinessForStore: authenticatedProcedure
    .input(z.object({
      userId: z.string(),
      storeId: z.string(),
      email: z.string().email(),
      businessType: z.enum(['individual', 'company']).default('company'),
      country: z.string().default('US'),
    }))
    .mutation(async ({ input, ctx }) => {
      const { userId, storeId, email, businessType, country } = input;
      const walletAddress = (ctx as AuthenticatedContext).walletAddress;
      const authenticatedUser = await db.user.findFirst({
        where: {
          OR: [
            { walletAddress: { equals: walletAddress, mode: 'insensitive' } },
            { wallets: { some: { address: { equals: walletAddress, mode: 'insensitive' } } } },
          ],
        },
        select: { id: true },
      });
      if (!authenticatedUser || authenticatedUser.id !== userId) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Authenticated user does not match the shop owner' });
      }

      const store = await db.store.findUnique({
        where: { id: storeId },
        include: {
          application: true,
          business: {
            include: {
              stripeAccount: true,
            },
          },
        },
      });

      if (!store) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Store not found' });
      }

      if (store.ownerId !== userId) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Unauthorized: You do not own this store' });
      }

      if (!store.application) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Store application is required before starting Stripe Connect',
        });
      }

      let business = store.business;

      if (!business) {
        business = await db.business.create({
          data: {
            ownerId: store.ownerId,
            coopId: store.coopId,
            name: store.application.businessName || store.name,
            city: store.application.businessCity,
            isApproved: false,
          },
          include: {
            stripeAccount: true,
          },
        });

        await db.store.update({
          where: { id: storeId },
          data: { businessId: business.id },
        });
      }

      if (business?.stripeAccount) {
        // Use APP_URL for the base URL (backend environment variable)
        const baseUrl = process.env.APP_URL || 'http://localhost:3001';
        console.log('🔗 [Stripe Connect] Base URL', baseUrl);
        const onboardingUrl = await generateOnboardingLink({
          accountId: business.stripeAccount.stripeAccountId,
          refreshUrl: `${baseUrl}/business/onboarding`,
          returnUrl: `${baseUrl}/business/dashboard`,
        });

        return {
          businessId: business.id,
          storeId,
          stripeAccountId: business.stripeAccount.stripeAccountId,
          onboardingUrl,
          existingAccount: true,
        };
      }

      const result = await createConnectAccount({
        businessId: business.id,
        email,
        businessType,
        country,
      });

      return {
        businessId: business.id,
        storeId,
        stripeAccountId: result.stripeAccountId,
        onboardingUrl: result.onboardingUrl,
        existingAccount: false,
      };
    }),

  /**
   * Create Stripe Connect account for a business
   */
  createAccount: authenticatedProcedure
    .input(z.object({
      userId: z.string(),
      businessId: z.string(),
      email: z.string().email(),
      businessType: z.enum(['individual', 'company']),
      country: z.string().default('US'),
    }))
    .mutation(async ({ input }) => {
      const { userId, businessId, email, businessType, country } = input;

      // Verify business ownership
      const business = await db.business.findUnique({
        where: { id: businessId },
        select: { ownerId: true },
      });

      if (!business) {
        throw new Error('Business not found');
      }

      if (business.ownerId !== userId) {
        throw new Error('Unauthorized: You do not own this business');
      }

      const result = await createConnectAccount({
        businessId,
        email,
        businessType,
        country,
      });

      return result;
    }),

  /**
   * Generate onboarding link for existing account
   */
  getOnboardingLink: authenticatedProcedure
    .input(z.object({
      userId: z.string(),
      businessId: z.string(),
      refreshUrl: z.string(),
      returnUrl: z.string(),
    }))
    .mutation(async ({ input }) => {
      const { userId, businessId, refreshUrl, returnUrl } = input;

      // Verify business ownership
      const business = await db.business.findUnique({
        where: { id: businessId },
        include: {
          stripeAccount: true,
        },
      });

      if (!business) {
        throw new Error('Business not found');
      }

      if (business.ownerId !== userId) {
        throw new Error('Unauthorized: You do not own this business');
      }

      if (!business.stripeAccount) {
        throw new Error('No Stripe account found. Create one first.');
      }

      const onboardingUrl = await generateOnboardingLink({
        accountId: business.stripeAccount.stripeAccountId,
        refreshUrl,
        returnUrl,
      });

      return { onboardingUrl };
    }),

  /**
   * Sync account status from Stripe
   */
  syncStatus: authenticatedProcedure
    .input(z.object({
      userId: z.string(),
      businessId: z.string(),
    }))
    .mutation(async ({ input }) => {
      const { userId, businessId } = input;

      // Verify business ownership
      const business = await db.business.findUnique({
        where: { id: businessId },
        include: {
          stripeAccount: true,
        },
      });

      if (!business) {
        throw new Error('Business not found');
      }

      if (business.ownerId !== userId) {
        throw new Error('Unauthorized: You do not own this business');
      }

      if (!business.stripeAccount) {
        throw new Error('No Stripe account found');
      }

      const status = await syncAccountStatus(business.stripeAccount.stripeAccountId);

      // Stripe approval is the go-live trigger for stores linked to this business.
      const linkedStore = await db.store.findFirst({
        where: { businessId },
        include: { application: true },
      });

      if (linkedStore && status.chargesEnabled) {
        await db.$transaction([
          db.business.update({
            where: { id: businessId },
            data: { isApproved: true },
          }),
          db.store.update({
            where: { id: linkedStore.id },
            data: { status: 'APPROVED' },
          }),
          ...(linkedStore.application
            ? [
                db.storeApplication.update({
                  where: { storeId: linkedStore.id },
                  data: {
                    status: 'APPROVED',
                    reviewedAt: new Date(),
                    reviewNotes: 'Auto-approved after Stripe Connect charges were enabled.',
                  },
                }),
              ]
            : []),
        ]);
      } else if (linkedStore && status.onboardingStatus === 'REJECTED') {
        await db.$transaction([
          db.business.update({
            where: { id: businessId },
            data: { isApproved: false },
          }),
          db.store.update({
            where: { id: linkedStore.id },
            data: { status: 'REJECTED' },
          }),
          ...(linkedStore.application
            ? [
                db.storeApplication.update({
                  where: { storeId: linkedStore.id },
                  data: {
                    status: 'REJECTED',
                    reviewedAt: new Date(),
                    rejectionReason: 'Stripe Connect onboarding was rejected or requires manual intervention.',
                  },
                }),
              ]
            : []),
        ]);
      }

      return status;
    }),

  /**
   * Check if business can accept payments
   */
  canAcceptPayments: authenticatedProcedure
    .input(z.object({
      businessId: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const canAccept = await canAcceptPayments(input.businessId);
      return { canAcceptPayments: canAccept };
    }),

  /**
   * Check if business can receive payouts
   */
  canReceivePayouts: authenticatedProcedure
    .input(z.object({
      businessId: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const canReceive = await canReceivePayouts(input.businessId);
      return { canReceivePayouts: canReceive };
    }),

  /**
   * Get onboarding status
   */
  getOnboardingStatus: authenticatedProcedure
    .input(z.object({
      businessId: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const status = await getOnboardingStatus(input.businessId);
      
      if (!status) {
        return {
          exists: false,
          status: null,
        };
      }

      return {
        exists: true,
        ...status,
      };
    }),

  /**
   * Get onboarding history
   */
  getOnboardingHistory: authenticatedProcedure
    .input(z.object({
      businessId: z.string(),
      limit: z.number().default(20),
      offset: z.number().default(0),
    }))
    .query(async ({ ctx, input }) => {
      const history = await getOnboardingHistory(input.businessId);
      
      const start = input.offset;
      const end = input.offset + input.limit;
      const paginatedHistory = history.slice(start, end);

      return {
        events: paginatedHistory,
        total: history.length,
        hasMore: end < history.length,
      };
    }),

  /**
   * Admin: create or resume Stripe Connect onboarding for any store.
   * Bypasses store-owner ownership check — admin-only via privateProcedure.
   */
  adminInitiateOnboarding: privateProcedure
    .input(z.object({
      storeId: z.string(),
      email: z.string().email().optional(),
      businessType: z.enum(['individual', 'company']).default('company'),
      country: z.string().default('US'),
      returnUrl: z.string().optional(),
      refreshUrl: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { storeId, email, businessType, country, returnUrl, refreshUrl } = input;

      const store = await db.store.findUnique({
        where: { id: storeId },
        include: {
          application: true,
          owner: { select: { id: true, email: true } },
          business: { include: { stripeAccount: true } },
        },
      });

      if (!store) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Store not found' });
      }

      const resolvedEmail = email || store.owner.email;
      if (!resolvedEmail) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No email available for this store owner' });
      }

      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';
      const resolvedReturnUrl = returnUrl || `${baseUrl}/portal`;
      const resolvedRefreshUrl = refreshUrl || `${baseUrl}/portal`;

      if (!store.business) {
        const newBusiness = await db.business.create({
          data: {
            ownerId: store.ownerId,
            coopId: store.coopId,
            name: store.application?.businessName || store.name,
            city: store.application?.businessCity || '',
            isApproved: false,
          },
        });

        await db.store.update({
          where: { id: storeId },
          data: { businessId: newBusiness.id },
        });

        const result = await createConnectAccount({
          businessId: newBusiness.id,
          email: resolvedEmail,
          businessType,
          country,
        });

        return {
          businessId: newBusiness.id,
          storeId,
          stripeAccountId: result.stripeAccountId,
          onboardingUrl: result.onboardingUrl,
          existingAccount: false,
        };
      }

      const businessId = store.business.id;

      if (store.business.stripeAccount) {
        const onboardingUrl = await generateOnboardingLink({
          accountId: store.business.stripeAccount.stripeAccountId,
          refreshUrl: resolvedRefreshUrl,
          returnUrl: resolvedReturnUrl,
        });

        return {
          businessId,
          storeId,
          stripeAccountId: store.business.stripeAccount.stripeAccountId,
          onboardingUrl,
          existingAccount: true,
        };
      }

      const result = await createConnectAccount({
        businessId,
        email: resolvedEmail,
        businessType,
        country,
      });

      return {
        businessId,
        storeId,
        stripeAccountId: result.stripeAccountId,
        onboardingUrl: result.onboardingUrl,
        existingAccount: false,
      };
    }),

  /**
   * Get business readiness for checkout (with non-eligible states)
   */
  getBusinessReadiness: authenticatedProcedure
    .input(z.object({
      businessId: z.string(),
    }))
    .query(async ({ input }) => {
      const business = await db.business.findUnique({
        where: { id: input.businessId },
        include: {
          stripeAccount: true,
          owner: true,
        },
      });

      if (!business) {
        throw new Error('Business not found');
      }

      // Get owner's wallets
      const merchantWallets = await db.wallet.findMany({
        where: {
          userId: business.ownerId,
          walletType: 'MANAGED',
        },
        orderBy: {
          isPrimary: 'desc',
        },
        take: 1,
      });

      const canAccept = await canAcceptPayments(input.businessId);
      const canPayout = await canReceivePayouts(input.businessId);

      // Determine SC reward eligibility
      const merchantWallet = merchantWallets[0];
      const scEligible = !!merchantWallet && !!business.stripeAccount?.chargesEnabled;

      // Determine non-eligible reasons
      const nonEligibleReasons = [];
      if (!business.stripeAccount) {
        nonEligibleReasons.push('NO_STRIPE_ACCOUNT');
      } else if (!business.stripeAccount.chargesEnabled) {
        nonEligibleReasons.push('CHARGES_NOT_ENABLED');
      }
      if (!merchantWallet) {
        nonEligibleReasons.push('NO_WALLET');
      }

      return {
        businessId: business.id,
        businessName: business.name,
        canAcceptPayments: canAccept,
        canReceivePayouts: canPayout,
        scRewardEligible: scEligible,
        nonEligibleReasons,
        stripeAccountStatus: business.stripeAccount?.onboardingStatus || null,
        verificationStatus: business.stripeAccount?.verificationStatus || null,
      };
    }),
});
