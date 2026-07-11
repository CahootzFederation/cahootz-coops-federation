import { z } from 'zod';
import { randomUUID } from 'crypto';
import { TRPCError } from '@trpc/server';
import { authenticatedProcedure, publicProcedure, privateProcedure } from '../procedures';
import { router } from '../trpc';
import type { AuthenticatedContext } from '../context.js';

type NewsletterSubmissionType = 'article' | 'event';
type NewsletterSubmissionStatus = 'pending' | 'published' | 'dismissed';

interface PreviewOverrides {
  newsletterSubmissions?: unknown;
  [key: string]: unknown;
}

export interface NewsletterSubmission {
  id: string;
  type: NewsletterSubmissionType;
  title: string;
  summary: string;
  contentMarkdown?: string;
  date?: string;
  location?: string;
  byline?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  sourceUrl?: string;
  imageUrl?: string;
  submittedByUserId: string;
  submittedByName?: string;
  submittedByEmail?: string;
  submittedByWallet: string;
  submittedAt: string;
  status: NewsletterSubmissionStatus;
}

function normalizePreviewOverrides(value: unknown): PreviewOverrides {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as PreviewOverrides)
    : {};
}

function normalizeNewsletterSubmissions(value: unknown): NewsletterSubmission[] {
  if (!Array.isArray(value)) return [];

  return value.filter((submission): submission is NewsletterSubmission => {
    return (
      typeof submission === 'object' &&
      submission !== null &&
      'id' in submission &&
      'type' in submission &&
      'title' in submission &&
      'summary' in submission &&
      typeof submission.id === 'string' &&
      (submission.type === 'article' || submission.type === 'event') &&
      typeof submission.title === 'string' &&
      typeof submission.summary === 'string'
    );
  });
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveUrl(value: string | undefined, baseUrl: string): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function getMetaContent(html: string, keys: string[]): string | undefined {
  for (const key of keys) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${escapedKey}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escapedKey}["'][^>]*>`, 'i'),
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) return decodeHtmlEntities(match[1]);
    }
  }
  return undefined;
}

function getTitleTag(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match?.[1] ? decodeHtmlEntities(match[1]) : undefined;
}

async function fetchLinkPreview(url: string) {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Enter a valid URL' });
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only http and https links are supported' });
  }

  const response = await fetch(parsedUrl.toString(), {
    headers: {
      'user-agent': 'CahootzNewsletterBot/1.0 (+https://cahootz.coop)',
      accept: 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Could not load that link' });
  }

  const html = (await response.text()).slice(0, 250_000);
  const finalUrl = response.url || parsedUrl.toString();
  const title = getMetaContent(html, ['og:title', 'twitter:title']) || getTitleTag(html) || parsedUrl.hostname;
  const description = getMetaContent(html, ['og:description', 'twitter:description', 'description']) || '';
  const imageUrl = resolveUrl(getMetaContent(html, ['og:image', 'twitter:image']), finalUrl);

  return {
    url: finalUrl,
    title: title.slice(0, 160),
    description: description.slice(0, 1200),
    imageUrl,
  };
}

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

  getLinkPreview: publicProcedure
    .input(z.object({ url: z.string().trim().url().max(500) }))
    .query(async ({ input }) => fetchLinkPreview(input.url)),

  /**
   * Let active co-op members submit stories and events for the public newsletter.
   * Submissions are kept pending in previewOverrides until an admin publishes them.
   */
  submitNewsletterSubmission: authenticatedProcedure
    .input(z.object({
      coopId: z.string().min(1),
      type: z.enum(['article', 'event']),
      title: z.string().trim().min(3).max(120),
      summary: z.string().trim().min(10).max(2000),
      contentMarkdown: z.string().trim().max(20000).optional(),
      date: z.string().trim().max(80).optional(),
      location: z.string().trim().max(160).optional(),
      byline: z.string().trim().max(120).optional(),
      ctaLabel: z.string().trim().max(60).optional(),
      ctaUrl: z.string().trim().max(500).optional(),
      sourceUrl: z.string().trim().max(500).optional(),
      imageUrl: z.string().trim().max(500).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { walletAddress } = ctx as AuthenticatedContext;
      if (!walletAddress) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'No wallet address provided' });
      }

      const user = await ctx.db.user.findFirst({
        where: {
          OR: [
            { walletAddress },
            { wallets: { some: { address: walletAddress } } },
          ],
        },
        select: {
          id: true,
          name: true,
          email: true,
          memberships: {
            where: {
              coopId: input.coopId,
              status: 'ACTIVE',
            },
            select: { id: true },
          },
        },
      });

      if (!user) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found for wallet' });
      }

      if (user.memberships.length === 0) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only active co-op members can submit to the newsletter',
        });
      }

      const publicInfo = await ctx.db.publicCoopInfo.findUnique({
        where: { coopId: input.coopId },
        select: { previewOverrides: true },
      });

      if (!publicInfo) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Public newsletter is not set up yet' });
      }

      const overrides = normalizePreviewOverrides(publicInfo.previewOverrides);
      const existingSubmissions = normalizeNewsletterSubmissions(overrides.newsletterSubmissions)
        .filter((submission) => submission.status === 'pending');

      const submission: NewsletterSubmission = {
        id: randomUUID(),
        type: input.type,
        title: input.title.trim(),
        summary: input.summary.trim(),
        contentMarkdown: input.contentMarkdown?.trim() || undefined,
        date: input.date?.trim() || undefined,
        location: input.location?.trim() || undefined,
        byline: input.byline?.trim() || undefined,
        ctaLabel: input.ctaLabel?.trim() || undefined,
        ctaUrl: input.ctaUrl?.trim() || undefined,
        sourceUrl: input.sourceUrl?.trim() || undefined,
        imageUrl: input.imageUrl?.trim() || undefined,
        submittedByUserId: user.id,
        submittedByName: user.name || user.email || undefined,
        submittedByWallet: walletAddress,
        submittedAt: new Date().toISOString(),
        status: 'pending',
      };

      await ctx.db.publicCoopInfo.update({
        where: { coopId: input.coopId },
        data: {
          previewOverrides: {
            ...overrides,
            newsletterSubmissions: [submission, ...existingSubmissions].slice(0, 100),
          } as any,
          updatedBy: walletAddress,
        },
      });

      const adminMemberships = await ctx.db.userCoopMembership.findMany({
        where: {
          coopId: input.coopId,
          status: 'ACTIVE',
          roles: { hasSome: ['admin', 'governor'] },
        },
        select: { userId: true },
      });

      if (adminMemberships.length > 0) {
        await ctx.db.notification.createMany({
          data: adminMemberships.map((membership) => ({
            userId: membership.userId,
            coopId: input.coopId,
            type: 'NEWSLETTER_SUBMISSION',
            title: input.type === 'event' ? 'New event submitted' : 'New story submitted',
            body: `${submission.submittedByName || 'A member'} submitted "${submission.title}" for the newsletter.`,
            data: {
              submissionId: submission.id,
              submissionType: submission.type,
            },
          })),
        });
      }

      return { success: true, submission };
    }),

  /**
   * Temporary public contributor intake for hired writers and event scouts.
   * This bypasses portal membership while still keeping submissions unpublished
   * until a co-op admin reviews them.
   */
  submitPublicNewsletterSubmission: publicProcedure
    .input(z.object({
      coopId: z.string().min(1),
      type: z.enum(['article', 'event']),
      title: z.string().trim().min(3).max(120),
      summary: z.string().trim().min(10).max(2000),
      contentMarkdown: z.string().trim().max(20000).optional(),
      contributorName: z.string().trim().min(2).max(120),
      contributorEmail: z.string().trim().email().max(200),
      date: z.string().trim().max(80).optional(),
      location: z.string().trim().max(160).optional(),
      byline: z.string().trim().max(120).optional(),
      ctaLabel: z.string().trim().max(60).optional(),
      ctaUrl: z.string().trim().max(500).optional(),
      sourceUrl: z.string().trim().max(500).optional(),
      imageUrl: z.string().trim().max(500).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const publicInfo = await ctx.db.publicCoopInfo.findUnique({
        where: { coopId: input.coopId },
        select: { previewOverrides: true },
      });

      if (!publicInfo) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Public newsletter is not set up yet' });
      }

      const overrides = normalizePreviewOverrides(publicInfo.previewOverrides);
      const existingSubmissions = normalizeNewsletterSubmissions(overrides.newsletterSubmissions)
        .filter((submission) => submission.status === 'pending');

      const submission: NewsletterSubmission = {
        id: randomUUID(),
        type: input.type,
        title: input.title.trim(),
        summary: input.summary.trim(),
        contentMarkdown: input.contentMarkdown?.trim() || undefined,
        date: input.date?.trim() || undefined,
        location: input.location?.trim() || undefined,
        byline: input.byline?.trim() || input.contributorName.trim(),
        ctaLabel: input.ctaLabel?.trim() || undefined,
        ctaUrl: input.ctaUrl?.trim() || undefined,
        sourceUrl: input.sourceUrl?.trim() || undefined,
        imageUrl: input.imageUrl?.trim() || undefined,
        submittedByUserId: 'public-contributor',
        submittedByName: input.contributorName.trim(),
        submittedByEmail: input.contributorEmail.trim(),
        submittedByWallet: 'public-contributor',
        submittedAt: new Date().toISOString(),
        status: 'pending',
      };

      await ctx.db.publicCoopInfo.update({
        where: { coopId: input.coopId },
        data: {
          previewOverrides: {
            ...overrides,
            newsletterSubmissions: [submission, ...existingSubmissions].slice(0, 100),
          } as any,
          updatedBy: input.contributorEmail.trim(),
        },
      });

      const adminMemberships = await ctx.db.userCoopMembership.findMany({
        where: {
          coopId: input.coopId,
          status: 'ACTIVE',
          roles: { hasSome: ['admin', 'governor'] },
        },
        select: { userId: true },
      });

      if (adminMemberships.length > 0) {
        await ctx.db.notification.createMany({
          data: adminMemberships.map((membership) => ({
            userId: membership.userId,
            coopId: input.coopId,
            type: 'NEWSLETTER_SUBMISSION',
            title: input.type === 'event' ? 'New public event submission' : 'New public story submission',
            body: `${submission.submittedByName} submitted "${submission.title}" for the newsletter.`,
            data: {
              submissionId: submission.id,
              submissionType: submission.type,
              contributorEmail: submission.submittedByEmail,
              source: 'public-contributor',
            },
          })),
        });
      }

      return { success: true, submission };
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

      // Map CoopConfig fields to PublicCoopInfo — no hardcoded copy fallbacks;
      // admins apply a recruitment starter or fill fields manually.
      const publicInfo = await ctx.db.publicCoopInfo.create({
        data: {
          coopId: input.coopId,
          name: config.name || undefined,
          tagline: config.tagline || undefined,
          heroTitle: config.name ? `Apply to ${config.name}` : undefined,
          heroSubtitle: config.description || undefined,
          aboutBody: config.description || undefined,
          missionBody: config.displayMission || undefined,
          eligibilityBody: config.eligibility || undefined,
          primaryCtaLabel: 'Apply to Join',
          primaryCtaUrl: `/${input.coopId}/application`,
          previewOverrides: {
            newspaperTitle: `${config.name || input.coopId} Newsletter`,
            newspaperIntro:
              'Stories, events, classifieds, business notes, and public notices from the co-op.',
            newsletterEmailEnabled: false,
            newsletterEmailSubject: `${config.name || input.coopId} Weekly Newsletter`,
            newsletterEmailPreheader:
              'Stories, events, classifieds, business notes, and public notices from the co-op.',
            communityPosts: [
              {
                type: 'article',
                title: `Why ${config.name || 'this co-op'} is organizing now`,
                summary:
                  'A front-page note on what the co-op is building, who it is for, and why members are being invited to apply.',
                date: 'From the co-op desk',
                byline: 'Membership committee',
              },
              {
                type: 'event',
                title: 'Next member orientation',
                summary:
                  'Invite applicants, business owners, and neighbors to learn how membership, proposals, and the marketplace work.',
                date: 'Upcoming',
              },
              {
                type: 'business',
                title: 'Member business spotlight',
                summary:
                  'Use this space to feature a business, creator, service, or project moving the co-op economy forward.',
              },
            ],
          },
          primaryColor: config.bgColor || '#f59e0b',
          accentColor: config.accentColor || '#ea580c',
          isDemo: config.isDemo,
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

      // Create a minimal blank page — no hardcoded copy; admins apply a
      // recruitment starter or fill fields manually.
      const publicInfo = await ctx.db.publicCoopInfo.create({
        data: {
          coopId: input.coopId,
          name: input.coopId,
          primaryColor: '#f59e0b',
          accentColor: '#ea580c',
          backgroundColor: '#1a1a1a',
          primaryCtaLabel: 'Apply to Join',
          primaryCtaUrl: `/${input.coopId}/application`,
          mobileAppUrl: 'https://mobile.cahootzcoops.com',
          previewOverrides: {
            newspaperTitle: `${input.coopId} Newsletter`,
            newspaperIntro:
              'Stories, events, classifieds, business notes, and public notices from the co-op.',
            newsletterEmailEnabled: false,
            newsletterEmailSubject: `${input.coopId} Weekly Newsletter`,
            newsletterEmailPreheader:
              'Stories, events, classifieds, business notes, and public notices from the co-op.',
            communityPosts: [
              {
                type: 'article',
                title: 'Why we are organizing now',
                summary:
                  'A front-page note on what the co-op is building, who it is for, and why members are being invited to apply.',
                date: 'From the co-op desk',
                byline: 'Membership committee',
              },
              {
                type: 'event',
                title: 'Next member orientation',
                summary:
                  'Invite applicants, business owners, and neighbors to learn how membership, proposals, and the marketplace work.',
                date: 'Upcoming',
              },
              {
                type: 'business',
                title: 'Member business spotlight',
                summary:
                  'Use this space to feature a business, creator, service, or project moving the co-op economy forward.',
              },
            ],
          },
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
          primaryCtaUrl: z.string().min(1).optional().nullable(),
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
   * Return the available recruitment template options.
   * Template content is defined here so it can be updated server-side
   * without frontend deploys.
   */
  getRecruitmentTemplates: privateProcedure
    .input(z.object({ coopId: z.string() }))
    .query(({ input }) => {
      return [
        { key: 'wealth', label: 'Generational Wealth', description: 'High-energy member pitch for co-ops building shared ownership and legacy.' },
        { key: 'ownership', label: 'Local Ownership', description: 'Community-first pitch focused on pooling demand and funding local priorities.' },
        { key: 'business', label: 'Business Builder', description: 'Recruit people who want to back, buy from, and grow co-op businesses.' },
      ];
    }),

  /**
   * Apply a recruitment template directly to the publicCoopInfo record.
   * All template content is defined and maintained here on the server.
   */
  applyRecruitmentTemplate: privateProcedure
    .input(z.object({
      coopId: z.string(),
      template: z.enum(['wealth', 'ownership', 'business']),
    }))
    .mutation(async ({ input, ctx }) => {
      if (ctx.coopId && ctx.coopId !== input.coopId) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Cannot modify public info for a different coop' });
      }

      const existing = await ctx.db.publicCoopInfo.findUnique({ where: { coopId: input.coopId } });
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Public page not found — create it first' });
      }

      const coopName = existing.name || input.coopId;
      let patch: Parameters<typeof ctx.db.publicCoopInfo.update>[0]['data'] = {};

      if (input.template === 'wealth') {
        patch = {
          tagline: 'Build generational wealth together',
          heroTitle: `Apply to ${coopName}`,
          heroSubtitle: `This is for people who want more than inspiration. ${coopName} is building a member-owned economy where our spending, businesses, votes, and collective power can become real generational wealth.`,
          aboutTitle: 'Why Join',
          aboutBody: `Join ${coopName} if you are ready to help build something our people can own. Members back co-op businesses, help decide what gets funded, and grow a shared economic engine designed for stability, opportunity, and legacy.`,
          missionBody: [
            'Grow a member-owned marketplace where everyday spending strengthens the co-op.',
            'Build a community wealth fund that can support businesses, services, projects, and long-term assets.',
            'Give members a voice in how resources move, who gets backed, and what future the co-op is building.',
          ].join('\n'),
          eligibilityTitle: 'Who Should Apply',
          eligibilityBody: 'Apply if you want ownership, accountability, and a seat at the table while this co-op builds economic power for members and the next generation.',
          faqs: [
            { question: 'What happens after I apply?', answer: 'Your application goes to the co-op for review. If approved, you can participate as a member and help shape what gets built next.' },
            { question: 'Do I need co-op experience?', answer: 'No. You need alignment, seriousness, and a willingness to participate in a member-owned economy.' },
          ],
          primaryCtaLabel: 'Apply to Join',
          primaryCtaUrl: `/${input.coopId}/application`,
          seoTitle: `${coopName} membership application`,
          seoDescription: `Apply to ${coopName} and help build a member-owned economy for generational wealth.`,
        };
      } else if (input.template === 'ownership') {
        patch = {
          tagline: 'Own more of what your community already makes possible',
          heroTitle: `Join ${coopName}`,
          heroSubtitle: `${coopName} brings members together to pool demand, support local businesses, fund shared priorities, and make decisions as owners.`,
          aboutTitle: 'A Co-op Built for Members',
          aboutBody: `Membership in ${coopName} is a way to turn community participation into shared leverage. Apply to help grow an economy where members can support each other, vote on priorities, and build useful local infrastructure.`,
          missionBody: [
            'Organize member demand so more value stays connected to the community.',
            'Fund projects and services members actually want.',
            'Create a practical governance path for people who want more say in their local economy.',
          ].join('\n'),
          eligibilityTitle: 'Who Should Apply',
          eligibilityBody: 'Apply if you want to participate, vote, support member businesses, and help turn shared priorities into funded action.',
          faqs: [],
          primaryCtaLabel: 'Apply to Join',
          primaryCtaUrl: `/${input.coopId}/application`,
        };
      } else {
        patch = {
          tagline: 'Help grow the businesses your co-op believes in',
          heroTitle: `Build with ${coopName}`,
          heroSubtitle: `${coopName} is recruiting members who want to buy from, promote, fund, and grow a stronger co-op marketplace.`,
          aboutTitle: 'Turn Support into Ownership',
          aboutBody: `Apply to ${coopName} if you want your support for local businesses to become part of a bigger ownership strategy. Members help bring customers, proposals, rewards, and governance into one co-op economy.`,
          missionBody: [
            'Help member businesses find customers and community support.',
            'Use co-op activity to fund tools, services, and new ventures.',
            'Create a marketplace where members can see their participation compound.',
          ].join('\n'),
          eligibilityTitle: 'Who Should Apply',
          eligibilityBody: 'Apply if you are ready to support member businesses, invite serious builders, and help the co-op marketplace grow.',
          faqs: [],
          primaryCtaLabel: 'Apply to Join',
          primaryCtaUrl: `/${input.coopId}/application`,
        };
      }

      const publicInfo = await ctx.db.publicCoopInfo.update({
        where: { coopId: input.coopId },
        data: { ...patch, updatedBy: ctx.walletAddress },
      });

      return { success: true, publicInfo };
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
