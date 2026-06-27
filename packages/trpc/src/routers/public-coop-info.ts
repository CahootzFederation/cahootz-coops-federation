import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { publicProcedure, privateProcedure } from '../procedures';
import { router } from '../trpc';

export const publicCoopInfoRouter = router({
  /**
   * Get published public coop info by coopId (public access)
   */
  getByCoopId: publicProcedure
    .input(z.object({ coopId: z.string() }))
    .query(async ({ input, ctx }) => {
      const publicInfo = await ctx.db.publicCoopInfo.findUnique({
        where: { coopId: input.coopId },
      });

      if (!publicInfo || !publicInfo.isPublished || publicInfo.isDemo) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Public coop page not found or not published',
        });
      }

      return publicInfo;
    }),

  /**
   * Get public coop info including unpublished (for coming soon page)
   */
  getByCoopIdWithUnpublished: publicProcedure
    .input(z.object({ coopId: z.string() }))
    .query(async ({ input, ctx }) => {
      console.log('check coopId with unpublished', input.coopId);
      const publicInfo = await ctx.db.publicCoopInfo.findUnique({
        where: { coopId: input.coopId },
      });

      return publicInfo;
    }),

  /**
   * Get preview data for public page (stores and proposals)
   */
  getPreviewData: publicProcedure
    .input(z.object({
      coopId: z.string(),
      previewMode: z.enum(['live', 'curated', 'hybrid']),
      storeLimit: z.number().min(1).max(50).optional().default(12),
      proposalLimit: z.number().min(1).max(20).optional().default(3),
    }))
    .query(async ({ input, ctx }) => {
      if (input.previewMode === 'curated') {
        return null;
      }

      const storeWhere = {
        coopId: input.coopId,
        status: 'APPROVED' as const,
        // Only surface stores whose Stripe Connect account is fully ready
        // to accept charges; otherwise customers would hit an error at
        // checkout. SC verification is purely a badge, not a filter.
        business: {
          stripeAccount: {
            chargesEnabled: true,
          },
        },
      };

      const productWhere = {
        isActive: true,
        store: storeWhere,
      };

      const [stores, proposals, memberCount, storeCount, productCount] = await Promise.all([
        ctx.db.store.findMany({
          where: storeWhere,
          take: input.storeLimit,
          orderBy: [
            { isFeatured: 'desc' },
            { isScVerified: 'desc' },
            { createdAt: 'desc' },
          ],
          select: {
            id: true,
            name: true,
            description: true,
            category: true,
            imageUrl: true,
            isScVerified: true,
            isFeatured: true,
            _count: {
              select: {
                products: {
                  where: {
                    isActive: true,
                  },
                },
              },
            },
          },
        }),
        ctx.db.proposal.findMany({
          where: { coopId: input.coopId, status: { in: ['VOTABLE', 'APPROVED', 'FUNDED'] } },
          take: input.proposalLimit,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            title: true,
            summary: true,
            status: true,
            budgetAmount: true,
            budgetCurrency: true,
          },
        }),
        ctx.db.userCoopMembership.count({
          where: {
            coopId: input.coopId,
            status: 'ACTIVE',
          },
        }),
        ctx.db.store.count({
          where: storeWhere,
        }),
        ctx.db.product.count({
          where: productWhere,
        }),
      ]);

      return {
        stores: stores.map(({ _count, ...store }) => ({
          ...store,
          productCount: _count.products,
        })),
        proposals,
        stats: {
          memberCount,
          storeCount,
          productCount,
        },
      };
    }),

  /**
   * Get public coop info by domain (public access)
   */
  getByDomain: publicProcedure
    .input(z.object({ domain: z.string() }))
    .query(async ({ input, ctx }) => {
      // Get all published public info and filter in code
      // (Prisma JSON array_contains has type issues)
      const allPublicInfo = await ctx.db.publicCoopInfo.findMany({
        where: { isPublished: true, isDemo: false },
      });

      const publicInfo = allPublicInfo.find(info => {
        if (info.primaryDomain === input.domain) return true;
        const additionalDomains = info.additionalDomains as string[] | null;
        if (additionalDomains && additionalDomains.includes(input.domain)) return true;
        return false;
      });

      if (!publicInfo) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'No coop found for this domain',
        });
      }

      return publicInfo;
    }),

  /**
   * Bootstrap/backfill public info from CoopConfig (admin only)
   */
  bootstrapFromConfig: privateProcedure
    .input(z.object({ coopId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      // Verify the requested coopId matches the authenticated coop context
      if (ctx.coopId && ctx.coopId !== input.coopId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Cannot modify public info for a different coop',
        });
      }

      // Get the active CoopConfig
      const config = await ctx.db.coopConfig.findFirst({
        where: {
          coopId: input.coopId,
          isActive: true,
        },
        orderBy: {
          version: 'desc',
        },
      });

      if (!config) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'CoopConfig not found',
        });
      }

      // Check if PublicCoopInfo already exists
      const existing = await ctx.db.publicCoopInfo.findUnique({
        where: { coopId: input.coopId },
      });

      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'PublicCoopInfo already exists for this coop',
        });
      }

      // Map CoopConfig fields to PublicCoopInfo
      const publicInfo = await ctx.db.publicCoopInfo.create({
        data: {
          coopId: input.coopId,
          name: config.name || undefined,
          tagline: config.tagline || undefined,
          aboutBody: config.description || undefined,
          missionBody: config.displayMission || undefined,
          eligibilityBody: config.eligibility || undefined,
          features: config.displayFeatures || undefined,
          primaryColor: config.bgColor || '#f59e0b',
          accentColor: config.accentColor || '#ea580c',
          isDemo: config.isDemo,
          isPublished: false, // Start unpublished
          createdBy: ctx.walletAddress,
        },
      });

      return {
        success: true,
        publicInfo,
      };
    }),

  /**
   * Create a blank public page (admin only)
   */
  createBlank: privateProcedure
    .input(z.object({ coopId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      // Verify the requested coopId matches the authenticated coop context
      if (ctx.coopId && ctx.coopId !== input.coopId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Cannot modify public info for a different coop',
        });
      }

      // Check if PublicCoopInfo already exists
      const existing = await ctx.db.publicCoopInfo.findUnique({
        where: { coopId: input.coopId },
      });

      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'PublicCoopInfo already exists for this coop',
        });
      }

      // Create blank public info with sensible defaults
      const publicInfo = await ctx.db.publicCoopInfo.create({
        data: {
          coopId: input.coopId,
          name: input.coopId,
          tagline: 'Building community wealth together',
          primaryColor: '#f59e0b',
          accentColor: '#ea580c',
          backgroundColor: '#1a1a1a',
          primaryCtaLabel: 'Join Now',
          mobileAppUrl: 'https://mobile.cahootzcoops.com',
          previewMode: 'hybrid',
          isPublished: false,
          createdBy: ctx.walletAddress,
        },
      });

      return {
        success: true,
        publicInfo,
      };
    }),

  /**
   * Update public coop info (admin only)
   */
  update: privateProcedure
    .input(
      z.object({
        coopId: z.string(),
        data: z.object({
          name: z.string().optional(),
          tagline: z.string().optional(),
          heroTitle: z.string().optional(),
          heroSubtitle: z.string().optional(),
          heroImageUrl: z.string().url().optional().nullable(),
          logoUrl: z.string().url().optional().nullable(),
          primaryColor: z.string().optional(),
          accentColor: z.string().optional(),
          backgroundColor: z.string().optional(),
          coverImageUrl: z.string().url().optional().nullable(),
          aboutTitle: z.string().optional(),
          aboutBody: z.string().optional(),
          missionBody: z.string().optional(),
          eligibilityTitle: z.string().optional(),
          eligibilityBody: z.string().optional(),
          features: z.array(z.object({
            title: z.string(),
            description: z.string(),
            iconName: z.string().optional(),
          })).optional(),
          faqs: z.array(z.object({
            question: z.string(),
            answer: z.string(),
          })).optional(),
          contactEmail: z.string().email().optional().nullable(),
          contactLinks: z.array(z.object({
            label: z.string(),
            url: z.string(),
            type: z.enum(['email', 'phone', 'social']).optional(),
          })).optional(),
          newsletterUrl: z.string().url().optional().nullable(),
          primaryCtaLabel: z.string().optional(),
          primaryCtaUrl: z.string().url().optional().nullable(),
          mobileAppUrl: z.string().url().optional().nullable(),
          previewMode: z.enum(['live', 'curated', 'hybrid']).optional(),
          previewOverrides: z.any().optional(),
          showStatsBar: z.boolean().optional(),
          isPublished: z.boolean().optional(),
          seoTitle: z.string().optional(),
          seoDescription: z.string().optional(),
          primaryDomain: z.string().optional().nullable(),
          additionalDomains: z.array(z.string()).optional(),
        }),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Verify the requested coopId matches the authenticated coop context
      if (ctx.coopId && ctx.coopId !== input.coopId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Cannot modify public info for a different coop',
        });
      }

      const publicInfo = await ctx.db.publicCoopInfo.update({
        where: { coopId: input.coopId },
        data: {
          ...input.data,
          updatedBy: ctx.walletAddress,
        },
      });

      return {
        success: true,
        publicInfo,
      };
    }),

  /**
   * Get public coop info for editing (admin only)
   */
  getForEdit: privateProcedure
    .input(z.object({ coopId: z.string() }))
    .query(async ({ input, ctx }) => {
      // Verify the requested coopId matches the authenticated coop context
      if (ctx.coopId && ctx.coopId !== input.coopId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Cannot access public info for a different coop',
        });
      }

      const publicInfo = await ctx.db.publicCoopInfo.findUnique({
        where: { coopId: input.coopId },
      });

      return publicInfo;
    }),
});
