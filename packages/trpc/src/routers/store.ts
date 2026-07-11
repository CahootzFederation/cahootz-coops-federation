import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { StoreCategory, ProductCategory, Prisma } from "@repo/db";

import { Context, AuthenticatedContext, CoopScopedContext } from "../context.js";
import { publicProcedure, privateProcedure, authenticatedProcedure } from "../procedures/index.js";
import { router } from "../trpc.js";
import { chargePaymentMethod } from "../services/stripe-customer.js";
import { mintUCToUser, awardStoreTransactionReward } from "../services/wallet-service.js";
import { sendToSoulaanUser } from "../services/p2p-service.js";
import { convertUSDToUC } from "../utils/currency-converter.js";
import { mirrorProductImages, parseDelimitedProductRows } from "../services/product-import-service.js";
import { sendOrderEmails } from "../services/email-service.js";
import { sendOrderCompletedNotification } from "../services/slack-notification-service.js";
import { env } from "../env.js";

// Category validation - now accepts any string since categories are dynamic
const StoreCategoryEnum = z.string().min(1).max(100);
const ProductCategoryEnum = z.string().min(1).max(100);

function requireCoopId(ctx: unknown): string {
  const coopId = (ctx as CoopScopedContext).coopId;
  if (!coopId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "coopId is required",
    });
  }
  return coopId;
}

function getStringMetadata(metadata: Prisma.JsonValue | null | undefined, key: string): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function summarizeMetadataItems(metadata: Prisma.JsonValue | null | undefined, fallback: string) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return { itemCount: 1, itemSummary: fallback };
  }

  const items = (metadata as Record<string, unknown>).items;
  if (!Array.isArray(items) || items.length === 0) {
    return { itemCount: 1, itemSummary: fallback };
  }

  const names = items
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      const name = record.name ?? record.productName;
      return typeof name === "string" && name.trim().length > 0 ? name : null;
    })
    .filter((name): name is string => !!name);

  return {
    itemCount: items.length,
    itemSummary: names.slice(0, 2).join(", ") || fallback,
  };
}

export const storeRouter = router({
  // ══════════════════════════════════════════════════════════════
  // PUBLIC ENDPOINTS - Browse stores and products
  // ══════════════════════════════════════════════════════════════

  /**
   * Get all approved stores with optional filters
   */
  getStores: publicProcedure
    .input(z.object({
      coopId: z.string(),
      category: StoreCategoryEnum.optional(),
      scVerifiedOnly: z.boolean().optional(),
      featured: z.boolean().optional(),
      search: z.string().optional(),
      limit: z.number().min(1).max(100).optional().default(20),
      cursor: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
      const context = ctx as Context;
      const { coopId, category, scVerifiedOnly, featured, search, cursor } = input;
      const limit = input.limit ?? 20;

      const where: any = {
        coopId,
        status: "APPROVED",
        deletedAt: null,
      };

      if (category) where.category = category;
      if (scVerifiedOnly) where.isScVerified = true;
      if (featured) where.isFeatured = true;
      if (search) {
        where.OR = [
          { name: { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
        ];
      }

      const stores = await context.db.store.findMany({
        where,
        take: limit + 1,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: [
          { isFeatured: "desc" },
          { isScVerified: "desc" },
          { createdAt: "desc" },
        ],
        include: {
          business: {
            include: {
              stripeAccount: true,
            },
          },
          _count: {
            select: { products: { where: { isActive: true } } },
          },
        },
      });

      // Only show approved stores that have a Stripe account fully ready to
      // accept charges. Stores still onboarding are hidden so customers don't
      // hit a "this store can't accept payments yet" wall at checkout.
      // SC verification is never a visibility filter; it's just a badge.
      const filteredStores = stores.filter((store) => {
        return store.business?.stripeAccount?.chargesEnabled === true;
      });

      let nextCursor: string | undefined;
      if (filteredStores.length > limit) {
        const nextItem = filteredStores.pop();
        nextCursor = nextItem?.id;
      }

      return {
        stores: filteredStores.map((store) => ({
          id: store.id,
          name: store.name,
          description: store.description,
          category: store.category,
          imageUrl: store.imageUrl,
          isScVerified: store.isScVerified,
          acceptsUC: store.acceptsUC,
          ucDiscountPercent: store.ucDiscountPercent,
          isFeatured: store.isFeatured,
          rating: store.rating,
          reviewCount: store.reviewCount,
          productCount: store._count.products,
          city: store.city,
          state: store.state,
        })),
        nextCursor,
      };
    }),

  /**
   * Get single store details
   */
  getStore: publicProcedure
    .input(z.object({
      storeId: z.string(),
    }))
    .query(async ({ input, ctx }) => {
      const context = ctx as Context;

      const store = await context.db.store.findUnique({
        where: { id: input.storeId },
        include: {
          owner: {
            select: {
              id: true,
              name: true,
            },
          },
          business: {
            include: {
              stripeAccount: {
                select: { chargesEnabled: true },
              },
            },
          },
          _count: {
            select: { products: { where: { isActive: true } } },
          },
        },
      });

      if (!store) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Store not found",
        });
      }

      // Only show approved stores whose Stripe account is fully ready to
      // accept charges. Stores still onboarding are hidden from the public
      // surface so customers don't land on a store they can't buy from.
      if (
        store.status !== "APPROVED" ||
        store.deletedAt ||
        !store.business?.stripeAccount?.chargesEnabled
      ) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Store not found",
        });
      }

      return {
        id: store.id,
        name: store.name,
        description: store.description,
        category: store.category,
        imageUrl: store.imageUrl,
        bannerUrl: store.bannerUrl,
        address: store.address,
        city: store.city,
        state: store.state,
        zipCode: store.zipCode,
        phone: store.phone,
        email: store.email,
        website: store.website,
        isScVerified: store.isScVerified,
        acceptsUC: store.acceptsUC,
        ucDiscountPercent: store.ucDiscountPercent,
        isFeatured: store.isFeatured,
        rating: store.rating,
        reviewCount: store.reviewCount,
        totalOrders: store.totalOrders,
        productCount: store._count.products,
        owner: store.owner,
        businessId: store.businessId,
      };
    }),

  /**
   * Get products for a store
   */
  getProducts: publicProcedure
    .input(z.object({
      coopId: z.string().optional(),
      storeId: z.string().optional(),
      category: ProductCategoryEnum.optional(),
      featured: z.boolean().optional(),
      search: z.string().optional(),
      limit: z.number().min(1).max(100).optional().default(20),
      cursor: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
      const context = ctx as Context;
      const { coopId, storeId, category, featured, search, limit, cursor } = input;

      const where: any = {
        isActive: true,
        store: {
          status: "APPROVED",
          deletedAt: null,
          ...(coopId && { coopId }),
          business: {
            stripeAccount: {
              chargesEnabled: true,
            },
          },
        },
      };

      if (storeId) where.storeId = storeId;
      if (category) where.category = category;
      if (featured) where.isFeatured = true;
      if (search) {
        where.OR = [
          { name: { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
        ];
      }

      const products = await context.db.product.findMany({
        where,
        take: limit + 1,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: [
          { isFeatured: "desc" },
          { createdAt: "desc" },
        ],
        include: {
          store: {
            select: {
              id: true,
              name: true,
              isScVerified: true,
              acceptsUC: true,
              ucDiscountPercent: true,
            },
          },
        },
      });

      let nextCursor: string | undefined;
      if (products.length > limit) {
        const nextItem = products.pop();
        nextCursor = nextItem?.id;
      }

      return {
        products: products.map((product) => ({
          id: product.id,
          name: product.name,
          description: product.description,
          category: product.category,
          imageUrl: product.imageUrl,
          images: product.images,
          priceUSD: product.priceUSD,
          ucDiscountPrice: product.ucDiscountPrice,
          quantity: product.trackInventory ? product.quantity : null,
          isFeatured: product.isFeatured,
          store: product.store,
        })),
        nextCursor,
      };
    }),

  /**
   * Get single product details
   */
  getProduct: publicProcedure
    .input(z.object({
      productId: z.string(),
    }))
    .query(async ({ input, ctx }) => {
      const context = ctx as Context;

      const product = await context.db.product.findUnique({
        where: { id: input.productId },
        include: {
          store: {
            select: {
              id: true,
              name: true,
              isScVerified: true,
              acceptsUC: true,
              ucDiscountPercent: true,
              status: true,
              deletedAt: true,
              business: {
                select: {
                  stripeAccount: { select: { chargesEnabled: true } },
                },
              },
            },
          },
        },
      });

      if (
        !product ||
        !product.isActive ||
        product.store.status !== "APPROVED" ||
        product.store.deletedAt ||
        !product.store.business?.stripeAccount?.chargesEnabled
      ) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Product not found",
        });
      }

      return {
        id: product.id,
        name: product.name,
        description: product.description,
        category: product.category,
        imageUrl: product.imageUrl,
        images: product.images,
        priceUSD: product.priceUSD,
        ucDiscountPrice: product.ucDiscountPrice,
        quantity: product.trackInventory ? product.quantity : null,
        trackInventory: product.trackInventory,
        allowBackorder: product.allowBackorder,
        isFeatured: product.isFeatured,
        sourceUrl: product.sourceUrl,
        totalSold: product.totalSold,
        store: {
          id: product.store.id,
          name: product.store.name,
          isScVerified: product.store.isScVerified,
          acceptsUC: product.store.acceptsUC,
          ucDiscountPercent: product.store.ucDiscountPercent,
        },
      };
    }),

  // ══════════════════════════════════════════════════════════════
  // AUTHENTICATED ENDPOINTS - User actions
  // ══════════════════════════════════════════════════════════════

  /**
   * Get user's store (if they have one) - kept for backwards compatibility
   */
  getMyStore: authenticatedProcedure
    .query(async ({ ctx }) => {
      const context = ctx as Context;
      const { walletAddress } = ctx as AuthenticatedContext;

      // Find user by wallet address
      const user = await context.db.user.findUnique({
        where: { walletAddress },
        select: { id: true },
      });

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      const store = await context.db.store.findFirst({
        where: { ownerId: user.id },
        include: {
          application: true,
          business: {
            include: {
              stripeAccount: true,
            },
          },
          scVerificationApplication: true,
          _count: {
            select: { products: true },
          },
        },
        orderBy: { createdAt: 'desc' }, // Return most recent store
      });

      if (!store) {
        return null;
      }

      return {
        id: store.id,
        name: store.name,
        description: store.description,
        category: store.category,
        imageUrl: store.imageUrl,
        bannerUrl: store.bannerUrl,
        status: store.status,
        isScVerified: store.isScVerified,
        acceptsUC: store.acceptsUC,
        ucDiscountPercent: store.ucDiscountPercent,
        totalSales: store.totalSales,
        totalOrders: store.totalOrders,
        productCount: store._count.products,
        businessId: store.businessId,
        stripeAccount: store.business?.stripeAccount
          ? {
              businessId: store.business.id,
              stripeAccountId: store.business.stripeAccount.stripeAccountId,
              onboardingStatus: store.business.stripeAccount.onboardingStatus,
              verificationStatus: store.business.stripeAccount.verificationStatus,
              chargesEnabled: store.business.stripeAccount.chargesEnabled,
              payoutsEnabled: store.business.stripeAccount.payoutsEnabled,
              requirementsCurrentlyDue: store.business.stripeAccount.requirementsCurrentlyDue,
              requirementsPastDue: store.business.stripeAccount.requirementsPastDue,
            }
          : null,
        scApplicationStatus: store.scApplicationStatus,
        scVerificationApplication: store.scVerificationApplication
          ? {
              id: store.scVerificationApplication.id,
              status: store.scVerificationApplication.status,
              whyScEligible: store.scVerificationApplication.whyScEligible,
              expectedVolume: store.scVerificationApplication.expectedVolume,
              rejectionReason: store.scVerificationApplication.rejectionReason,
              reviewedAt: store.scVerificationApplication.reviewedAt,
            }
          : null,
        application: store.application ? {
          status: store.application.status,
          reviewNotes: store.application.reviewNotes,
          rejectionReason: store.application.rejectionReason,
          communityBenefitStatement: store.application.communityBenefitStatement,
        } : null,
        createdAt: store.createdAt,
      };
    }),

  /**
   * Get all user's stores
   */
  getMyStores: authenticatedProcedure
    .query(async ({ ctx }) => {
      const context = ctx as Context;
      const { walletAddress } = ctx as AuthenticatedContext;

      // Find user by wallet address
      const user = await context.db.user.findUnique({
        where: { walletAddress },
        select: { id: true },
      });

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      const stores = await context.db.store.findMany({
        where: { ownerId: user.id },
        include: {
          application: true,
          business: {
            include: {
              stripeAccount: true,
            },
          },
          scVerificationApplication: true,
          _count: {
            select: { products: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      return stores.map(store => ({
        id: store.id,
        name: store.name,
        description: store.description,
        category: store.category,
        imageUrl: store.imageUrl,
        bannerUrl: store.bannerUrl,
        status: store.status,
        isScVerified: store.isScVerified,
        acceptsUC: store.acceptsUC,
        ucDiscountPercent: store.ucDiscountPercent,
        totalSales: store.totalSales,
        totalOrders: store.totalOrders,
        productCount: store._count.products,
        businessId: store.businessId,
        stripeAccount: store.business?.stripeAccount
          ? {
              businessId: store.business.id,
              stripeAccountId: store.business.stripeAccount.stripeAccountId,
              onboardingStatus: store.business.stripeAccount.onboardingStatus,
              verificationStatus: store.business.stripeAccount.verificationStatus,
              chargesEnabled: store.business.stripeAccount.chargesEnabled,
              payoutsEnabled: store.business.stripeAccount.payoutsEnabled,
              requirementsCurrentlyDue: store.business.stripeAccount.requirementsCurrentlyDue,
              requirementsPastDue: store.business.stripeAccount.requirementsPastDue,
            }
          : null,
        scApplicationStatus: store.scApplicationStatus,
        scVerificationApplication: store.scVerificationApplication
          ? {
              id: store.scVerificationApplication.id,
              status: store.scVerificationApplication.status,
              whyScEligible: store.scVerificationApplication.whyScEligible,
              expectedVolume: store.scVerificationApplication.expectedVolume,
              rejectionReason: store.scVerificationApplication.rejectionReason,
              reviewedAt: store.scVerificationApplication.reviewedAt,
            }
          : null,
        application: store.application ? {
          status: store.application.status,
          reviewNotes: store.application.reviewNotes,
          rejectionReason: store.application.rejectionReason,
          communityBenefitStatement: store.application.communityBenefitStatement,
        } : null,
        createdAt: store.createdAt,
      }));
    }),

  /**
   * Apply to become a store
   */
  applyForStore: authenticatedProcedure
    .input(z.object({
      // Store info
      storeName: z.string().min(2).max(100),
      storeDescription: z.string().min(10).max(1000), // Required - what the store sells/offers
      category: StoreCategoryEnum,
      imageUrl: z.string().url().optional(),
      bannerUrl: z.string().url().optional(),

      // Business info (optional — Stripe collects verified details during Connect onboarding)
      businessName: z.string().min(2).optional(),
      businessAddress: z.string().optional(),
      businessCity: z.string().optional(),
      businessState: z.string().optional(),
      businessZip: z.string().optional(),

      // Owner info
      ownerName: z.string().min(2),
      ownerEmail: z.string().email(),
      ownerPhone: z.string().min(10),

      // Application details
      communityBenefitStatement: z.string().min(20).max(2000).optional(), // Legacy field, no longer required in UI
      estimatedMonthlyRevenue: z.string().optional(),
      websiteUrl: z.preprocess(
        (val) => {
          // Convert empty/whitespace strings to undefined
          if (typeof val === "string") {
            const trimmed = val.trim();
            return trimmed === "" ? undefined : trimmed;
          }
          return val === "" ? undefined : val;
        },
        z.string().url("Please enter a valid URL (e.g., https://yourwebsite.com)").optional()
      ),
      socialMediaUrls: z.array(z.string().url()).optional(),

      // Documents (IPFS CIDs) - optional
      businessLicenseCID: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as Context;
      const { walletAddress } = ctx as AuthenticatedContext;
      const coopId = (ctx as CoopScopedContext).coopId || '???';

      // Find user by wallet address
      const user = await context.db.user.findUnique({
        where: { walletAddress },
        select: { id: true, status: true },
      });

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      if (user.status !== "ACTIVE") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Your account must be active to apply for a store",
        });
      }

      // Allow users to have multiple stores - no restriction

      // Create store and application in a transaction
      const store = await context.db.$transaction(async (tx) => {
        // Create the store with PENDING status
        const newStore = await tx.store.create({
          data: {
            ownerId: user.id,
            coopId,
            name: input.storeName,
            description: input.storeDescription,
            category: input.category,
            imageUrl: input.imageUrl,
            bannerUrl: input.bannerUrl,
            status: "PENDING",
          },
        });

        // Create the application
        await tx.storeApplication.create({
          data: {
            storeId: newStore.id,
            businessName: input.businessName || input.storeName,
            businessAddress: input.businessAddress || '',
            businessCity: input.businessCity || '',
            businessState: input.businessState || '',
            businessZip: input.businessZip || '',
            ownerName: input.ownerName,
            ownerEmail: input.ownerEmail,
            ownerPhone: input.ownerPhone,
            storeDescription: input.storeDescription,
            communityBenefitStatement: input.communityBenefitStatement || "",
            estimatedMonthlyRevenue: input.estimatedMonthlyRevenue || null,
            websiteUrl: input.websiteUrl || null, // Convert empty string to null
            socialMediaUrls: input.socialMediaUrls || [],
            businessLicenseCID: input.businessLicenseCID || null,
            status: "PENDING",
          },
        });

        return newStore;
      });

      return {
        success: true,
        storeId: store.id,
        message: "Store application submitted successfully. Complete Stripe Connect to activate your store.",
      };
    }),

  /**
   * Get my products (for store owners)
   */
  getMyProducts: authenticatedProcedure
    .input(z.object({
      storeId: z.string().optional(), // Optional - if not provided, returns products from all stores
      includeInactive: z.boolean().optional().default(false),
    }).optional())
    .query(async ({ input, ctx }) => {
      const context = ctx as Context;
      const { walletAddress } = ctx as AuthenticatedContext;

      // Find user
      const user = await context.db.user.findUnique({
        where: { walletAddress },
        select: { id: true },
      });

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      // If storeId is provided, verify user owns that store
      if (input?.storeId) {
        const store = await context.db.store.findFirst({
          where: { id: input.storeId, ownerId: user.id },
        });

        if (!store) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Store not found or you don't own this store",
          });
        }

        const where: any = { storeId: input.storeId };
        if (!input?.includeInactive) {
          where.isActive = true;
        }

        const products = await context.db.product.findMany({
          where,
          orderBy: { createdAt: "desc" },
        });

        return products.map((product) => ({
          id: product.id,
          name: product.name,
          description: product.description,
          category: product.category,
          imageUrl: product.imageUrl,
          priceUSD: product.priceUSD,
          ucDiscountPrice: product.ucDiscountPrice,
          quantity: product.quantity,
          trackInventory: product.trackInventory,
          isActive: product.isActive,
          isFeatured: product.isFeatured,
          totalSold: product.totalSold,
          createdAt: product.createdAt,
        }));
      }

      // If no storeId provided, return products from all user's stores
      const stores = await context.db.store.findMany({
        where: { ownerId: user.id },
        select: { id: true },
      });

      if (stores.length === 0) {
        return [];
      }

      const where: any = { 
        storeId: { in: stores.map(s => s.id) }
      };
      if (!input?.includeInactive) {
        where.isActive = true;
      }

      const products = await context.db.product.findMany({
        where,
        orderBy: { createdAt: "desc" },
        include: {
          store: {
            select: { id: true, name: true },
          },
        },
      });

      return products.map((product) => ({
        id: product.id,
        name: product.name,
        description: product.description,
        category: product.category,
        imageUrl: product.imageUrl,
        priceUSD: product.priceUSD,
        ucDiscountPrice: product.ucDiscountPrice,
        quantity: product.quantity,
        trackInventory: product.trackInventory,
        isActive: product.isActive,
        isFeatured: product.isFeatured,
        totalSold: product.totalSold,
        createdAt: product.createdAt,
        storeId: product.store.id,
        storeName: product.store.name,
      }));
    }),

  /**
   * Add a product to my store
   */
  addProduct: authenticatedProcedure
    .input(z.object({
      storeId: z.string(), // Required - specify which store to add product to
      name: z.string().min(2).max(200),
      description: z.string().max(2000).optional(),
      category: ProductCategoryEnum,
      imageUrl: z.string().url().optional(),
      images: z.array(z.string().url()).optional(),
      priceUSD: z.number().positive(),
      ucDiscountPrice: z.number().positive().optional(),
      sku: z.string().optional(),
      quantity: z.number().int().min(0).optional().default(0),
      trackInventory: z.boolean().optional().default(true),
      allowBackorder: z.boolean().optional().default(false),
    }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as Context;
      const { walletAddress } = ctx as AuthenticatedContext;

      // Find user
      const user = await context.db.user.findUnique({
        where: { walletAddress },
        select: { id: true },
      });

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      // Verify user owns the specified store
      const store = await context.db.store.findFirst({
        where: { 
          id: input.storeId,
          ownerId: user.id 
        },
      });

      if (!store) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Store not found or you don't own this store",
        });
      }

      if (store.status !== "APPROVED" || store.deletedAt) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Your store must be approved before adding products",
        });
      }

      // Check if the category is admin-only
      const categoryConfig = await context.db.productCategoryConfig.findUnique({
        where: { key: input.category },
      });

      if (categoryConfig?.isAdminOnly) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This product category is restricted to admin use only",
        });
      }

      const product = await context.db.product.create({
        data: {
          storeId: store.id,
          name: input.name,
          description: input.description,
          category: input.category,
          imageUrl: input.imageUrl,
          images: input.images || [],
          priceUSD: input.priceUSD,
          ucDiscountPrice: input.ucDiscountPrice,
          sku: input.sku,
          quantity: input.quantity,
          trackInventory: input.trackInventory,
          allowBackorder: input.allowBackorder,
          isActive: true,
        },
      });

      return {
        success: true,
        product: {
          id: product.id,
          name: product.name,
        },
      };
    }),

  /**
   * Update a product
   */
  updateProduct: authenticatedProcedure
    .input(z.object({
      productId: z.string(),
      name: z.string().min(2).max(200).optional(),
      description: z.string().max(2000).optional(),
      category: ProductCategoryEnum.optional(),
      imageUrl: z.string().url().nullable().optional(),
      images: z.array(z.string().url()).optional(),
      priceUSD: z.number().positive().optional(),
      ucDiscountPrice: z.number().positive().nullable().optional(),
      sku: z.string().nullable().optional(),
      quantity: z.number().int().min(0).optional(),
      trackInventory: z.boolean().optional(),
      allowBackorder: z.boolean().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as Context;
      const { walletAddress } = ctx as AuthenticatedContext;

      // Find user
      const user = await context.db.user.findUnique({
        where: { walletAddress },
        select: { id: true },
      });

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      // Verify product belongs to one of user's stores
      const product = await context.db.product.findUnique({
        where: { id: input.productId },
        include: {
          store: {
            select: { ownerId: true },
          },
        },
      });

      if (!product || product.store.ownerId !== user.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Product not found or you don't own this product",
        });
      }

      const { productId, category, ...updateData } = input;

      const updatedProduct = await context.db.product.update({
        where: { id: productId },
        data: {
          ...updateData,
          ...(category && { category }),
        } as Prisma.ProductUpdateInput,
      });

      return {
        success: true,
        product: {
          id: updatedProduct.id,
          name: updatedProduct.name,
        },
      };
    }),

  /**
   * Delete a product
   */
  deleteProduct: authenticatedProcedure
    .input(z.object({
      productId: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as Context;
      const { walletAddress } = ctx as AuthenticatedContext;

      // Find user
      const user = await context.db.user.findUnique({
        where: { walletAddress },
        select: { id: true },
      });

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      // Verify product belongs to one of user's stores
      const product = await context.db.product.findUnique({
        where: { id: input.productId },
        include: {
          store: {
            select: { ownerId: true },
          },
        },
      });

      if (!product || product.store.ownerId !== user.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Product not found or you don't own this product",
        });
      }

      // Soft delete - just mark as inactive
      await context.db.product.update({
        where: { id: input.productId },
        data: { isActive: false },
      });

      return {
        success: true,
        message: "Product deleted",
      };
    }),

  // ══════════════════════════════════════════════════════════════
  // ADMIN ENDPOINTS - Store management
  // ══════════════════════════════════════════════════════════════

  /**
   * Get all store applications (admin)
   */
  getStoreApplications: privateProcedure
    .input(z.object({
      status: z.enum(["PENDING", "UNDER_REVIEW", "APPROVED", "REJECTED"]).optional(),
      limit: z.number().min(1).max(100).optional().default(20),
      cursor: z.string().optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      const context = ctx as Context;
      const { status, cursor } = input || {};
      const limit = input?.limit ?? 20;

      const where: any = {};
      if (status) {
        where.application = { status };
      }

      const stores = await context.db.store.findMany({
        where: status ? { application: { status } } : {},
        take: limit + 1,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: { createdAt: "desc" },
        include: {
          owner: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
            },
          },
          application: true,
        },
      });

      let nextCursor: string | undefined;
      if (stores.length > limit) {
        const nextItem = stores.pop();
        nextCursor = nextItem?.id;
      }

      return {
        stores: stores.map((store) => ({
          id: store.id,
          name: store.name,
          description: store.description,
          category: store.category,
          status: store.application?.status || store.status, // Use application status for filtering display
          storeStatus: store.status,
          isScVerified: store.isScVerified,
          acceptsUC: store.acceptsUC,
          ucDiscountPercent: store.ucDiscountPercent,
          owner: store.owner,
          application: store.application,
          createdAt: store.createdAt,
        })),
        nextCursor,
      };
    }),

  /**
   * Approve a store application (admin)
   */
  approveStore: privateProcedure
    .input(z.object({
      storeId: z.string(),
      reviewNotes: z.string().optional(),
      grantScVerification: z.boolean().optional().default(false),
    }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as Context;
      const db = context.db as any;

      const store = await db.store.findUnique({
        where: { id: input.storeId },
        include: { application: true },
      });

      if (!store || !store.application) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Store application not found",
        });
      }

      await db.$transaction([
        db.store.update({
          where: { id: input.storeId },
          data: {
            status: "APPROVED",
            deletedAt: null,
            deletedBy: null,
            isScVerified: input.grantScVerification,
            scVerifiedAt: input.grantScVerification ? new Date() : null,
          },
        }),
        db.storeApplication.update({
          where: { storeId: input.storeId },
          data: {
            status: "APPROVED",
            reviewedAt: new Date(),
            reviewNotes: input.reviewNotes,
          },
        }),
      ]);

      return {
        success: true,
        message: "Store approved successfully",
      };
    }),

  /**
   * Reject a store application (admin)
   */
  rejectStore: privateProcedure
    .input(z.object({
      storeId: z.string(),
      rejectionReason: z.string().min(10),
    }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as Context;

      const store = await context.db.store.findUnique({
        where: { id: input.storeId },
        include: { application: true },
      });

      if (!store || !store.application) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Store application not found",
        });
      }

      await context.db.$transaction([
        context.db.store.update({
          where: { id: input.storeId },
          data: {
            status: "REJECTED",
          },
        }),
        context.db.storeApplication.update({
          where: { storeId: input.storeId },
          data: {
            status: "REJECTED",
            reviewedAt: new Date(),
            rejectionReason: input.rejectionReason,
          },
        }),
      ]);

      return {
        success: true,
        message: "Store application rejected",
      };
    }),

  /**
   * Toggle SC verification for a store (admin)
   */
  toggleScVerification: privateProcedure
    .input(z.object({
      storeId: z.string(),
      verified: z.boolean(),
    }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as Context;

      // Load store + coopId so we can look up CoopConfig for contract addresses
      const store = await context.db.store.findUnique({
        where: { id: input.storeId },
        select: {
          id: true,
          coopId: true,
          category: true,
          owner: { select: { walletAddress: true } },
        },
      });

      if (!store) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Store not found' });
      }

      if (!store.owner.walletAddress) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Store owner does not have a wallet address. They must connect a wallet first.',
        });
      }

      // Load contract addresses from CoopConfig (source of truth — no env vars)
      const coopConfig = await context.db.coopConfig.findFirst({
        where: { coopId: store.coopId, isActive: true },
        orderBy: { version: 'desc' },
        select: {
          verifiedStoreRegistryAddress: true,
          scTokenAddress: true,
          rpcUrl: true,
        },
      });

      if (!coopConfig?.verifiedStoreRegistryAddress) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'VerifiedStoreRegistry contract address is not configured in CoopConfig. Set verifiedStoreRegistryAddress in your coop config.',
        });
      }

      const registryConfig = {
        registryAddress: coopConfig.verifiedStoreRegistryAddress,
        rpcUrl: coopConfig.rpcUrl,
      };

      let txHash: string | undefined;

      try {
        const { verifyStoreOnChain, unverifyStoreOnChain } = await import('../services/verified-store-registry-service');

        if (input.verified) {
          txHash = await verifyStoreOnChain(
            store.owner.walletAddress,
            store.category || 'OTHER',
            store.id,
            registryConfig,
          );
        } else {
          txHash = await unverifyStoreOnChain(store.owner.walletAddress, registryConfig);
        }

        console.log(`✅ On-chain verification ${input.verified ? 'granted' : 'removed'}: ${txHash}`);

        // Optionally sync to SoulaaniCoin contract (non-critical)
        if (coopConfig.scTokenAddress) {
          try {
            const { syncStoreVerificationToContract } = await import('../services/store-sync-service');
            await syncStoreVerificationToContract(store.owner.walletAddress, input.verified, {
              scTokenAddress: coopConfig.scTokenAddress,
              rpcUrl: coopConfig.rpcUrl,
            });
            console.log(`✅ Store verification synced to SC token contract`);
          } catch (syncError) {
            console.error('❌ Failed to sync to SC token contract (non-critical):', syncError);
          }
        }
      } catch (error) {
        console.error('❌ On-chain verification failed:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to ${input.verified ? 'verify' : 'unverify'} store on-chain: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        });
      }

      // Update DB to match on-chain state
      await context.db.store.update({
        where: { id: input.storeId },
        data: {
          isScVerified: input.verified,
          scVerifiedAt: input.verified ? new Date() : null,
        },
      });

      return {
        success: true,
        message: input.verified ? 'Store SC verified on-chain' : 'SC verification removed on-chain',
        txHash,
      };
    }),

  /**
   * Set SC verification in the database only (no blockchain call).
   * Use this when you want to quickly mark/unmark a store without going
   * through the full on-chain flow (e.g. Stripe not set up, no wallet, testing).
   */
  setScVerifiedAdmin: privateProcedure
    .input(z.object({
      storeId: z.string(),
      verified: z.boolean(),
    }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as Context;

      const store = await context.db.store.findUnique({
        where: { id: input.storeId },
        select: { id: true, name: true },
      });

      if (!store) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Store not found' });
      }

      await context.db.store.update({
        where: { id: input.storeId },
        data: {
          isScVerified: input.verified,
          scVerifiedAt: input.verified ? new Date() : null,
        },
      });

      return {
        success: true,
        message: input.verified
          ? `${store.name} marked as SC Verified (DB only)`
          : `SC Verification removed from ${store.name} (DB only)`,
      };
    }),

  /**
   * Batch verify existing SC-verified stores on-chain
   * Used for migrating existing stores to on-chain registry
   */
  batchVerifyStoresOnChain: privateProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).optional().default(50),
    }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as Context;
      const coopId = (ctx as CoopScopedContext).coopId;

      if (!coopId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'coopId is required' });
      }

      const coopConfig = await context.db.coopConfig.findFirst({
        where: { coopId, isActive: true },
        orderBy: { version: 'desc' },
        select: { verifiedStoreRegistryAddress: true, rpcUrl: true },
      });

      if (!coopConfig?.verifiedStoreRegistryAddress) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'verifiedStoreRegistryAddress not configured in CoopConfig',
        });
      }

      const registryConfig = {
        registryAddress: coopConfig.verifiedStoreRegistryAddress,
        rpcUrl: coopConfig.rpcUrl,
      };

      // Get all SC-verified stores for this coop that need to be verified on-chain
      const stores = await context.db.store.findMany({
        where: { coopId, isScVerified: true },
        include: {
          owner: { select: { walletAddress: true } },
        },
        take: input.limit,
      });

      if (stores.length === 0) {
        return {
          success: true,
          message: 'No stores to verify',
          count: 0,
        };
      }

      // Filter stores with valid wallet addresses
      const validStores = stores.filter(s => s.owner.walletAddress);

      if (validStores.length === 0) {
        return {
          success: false,
          message: 'No stores have wallet addresses',
          count: 0,
        };
      }

      try {
        // Import the registry service
        const { verifyStoresBatchOnChain } = await import('../services/verified-store-registry-service');

        // Prepare batch data
        const batchData = validStores.map(store => ({
          ownerAddress: store.owner.walletAddress!,
          category: store.category || 'OTHER',
          storeId: store.id,
        }));

        const txHash = await verifyStoresBatchOnChain(batchData, registryConfig);

        console.log(`✅ Batch verified ${validStores.length} stores on-chain: ${txHash}`);

        return {
          success: true,
          message: `Successfully verified ${validStores.length} stores on-chain`,
          count: validStores.length,
          txHash,
          stores: validStores.map(s => ({
            id: s.id,
            name: s.name,
            ownerAddress: s.owner.walletAddress,
          })),
        };
      } catch (error) {
        console.error('❌ Batch verification failed:', error);
        throw new Error(
          `Failed to batch verify stores on-chain: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`
        );
      }
    }),

  /**
   * Toggle featured status for a store (admin)
   */
  toggleFeatured: privateProcedure
    .input(z.object({
      storeId: z.string(),
      featured: z.boolean(),
    }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as Context;

      await context.db.store.update({
        where: { id: input.storeId },
        data: {
          isFeatured: input.featured,
        },
      });

      return {
        success: true,
        message: input.featured ? "Store featured" : "Store unfeatured",
      };
    }),

  /**
   * Get all stores for admin management
   */
  getAllStores: privateProcedure
    .input(z.object({
      status: z.enum(["PENDING", "APPROVED", "SUSPENDED", "REJECTED"]).optional(),
      search: z.string().optional(),
      includeDeleted: z.boolean().optional().default(false),
      limit: z.number().min(1).max(100).optional().default(50),
      cursor: z.string().optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      const context = ctx as Context;
      const coopId = requireCoopId(ctx);
      const { status, search, cursor } = input || {};
      const limit = input?.limit ?? 50;

      const where: any = { coopId };
      if (!input?.includeDeleted) {
        where.deletedAt = null;
      }
      if (status) {
        where.status = status;
      }
      if (search) {
        where.OR = [
          { name: { contains: search, mode: "insensitive" } },
          { owner: { name: { contains: search, mode: "insensitive" } } },
          { owner: { email: { contains: search, mode: "insensitive" } } },
        ];
      }

      const stores = await context.db.store.findMany({
        where,
        take: limit + 1,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: { createdAt: "desc" },
        include: {
          owner: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              walletAddress: true,
            },
          },
          business: {
            include: {
              stripeAccount: true,
            },
          },
          _count: {
            select: {
              products: true,
              orders: true,
            },
          },
        },
      });

      let nextCursor: string | undefined;
      if (stores.length > limit) {
        const nextItem = stores.pop();
        nextCursor = nextItem?.id;
      }

      return {
        stores: stores.map((store) => ({
          id: store.id,
          name: store.name,
          description: store.description,
          category: store.category,
          status: store.status,
          isScVerified: store.isScVerified,
          isFeatured: store.isFeatured,
          acceptsUC: store.acceptsUC,
          ucDiscountPercent: store.ucDiscountPercent,
          imageUrl: store.imageUrl,
          bannerUrl: store.bannerUrl,
          ownerId: store.ownerId,
          owner: {
            id: store.owner.id,
            name: store.owner.name,
            email: store.owner.email,
            phone: store.owner.phone,
          },
          ownerWalletAddress: store.owner.walletAddress,
          address: store.address,
          city: store.city,
          state: store.state,
          phone: store.phone,
          email: store.email,
          website: store.website,
          totalSales: store.totalSales,
          rating: store.rating,
          reviewCount: store.reviewCount,
          deletedAt: store.deletedAt,
          deletedBy: store.deletedBy,
          productCount: store._count.products,
          orderCount: store._count.orders,
          createdAt: store.createdAt,
        stripeAccount: store.business?.stripeAccount ? {
          businessId: store.business.stripeAccount.businessId,
          stripeAccountId: store.business.stripeAccount.stripeAccountId,
          chargesEnabled: store.business.stripeAccount.chargesEnabled,
          payoutsEnabled: store.business.stripeAccount.payoutsEnabled,
          detailsSubmitted: store.business.stripeAccount.detailsSubmitted,
          onboardingStatus: store.business.stripeAccount.onboardingStatus,
          verificationStatus: store.business.stripeAccount.verificationStatus,
          requirementsCurrentlyDue: store.business.stripeAccount.requirementsCurrentlyDue,
          requirementsPastDue: store.business.stripeAccount.requirementsPastDue,
          disabledReason: store.business.stripeAccount.disabledReason,
        } : null,
        })),
        nextCursor,
      };
    }),

  /**
   * Get all orders created in the active co-op for admin management.
   * Includes both legacy StoreOrder rows and Stripe-backed CommerceTransaction rows.
   */
  getAllStoreOrdersAdmin: privateProcedure
    .input(z.object({
      storeId: z.string().optional(),
      search: z.string().optional(),
      source: z.enum(["ALL", "STORE_ORDER", "COMMERCE_TRANSACTION"]).optional().default("ALL"),
      fulfillmentStatus: z.enum(["PENDING", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"]).optional(),
      paymentStatus: z.enum(["PENDING", "COMPLETED", "FAILED", "REFUNDED"]).optional(),
      commerceStatus: z.enum(["PENDING", "PROCESSING", "COMPLETED", "FAILED", "REFUNDED", "PARTIALLY_REFUNDED"]).optional(),
      includeDeleted: z.boolean().optional().default(false),
      limit: z.number().min(1).max(100).optional().default(50),
    }).optional())
    .query(async ({ input, ctx }) => {
      const context = ctx as Context;
      const db = context.db as any;
      const coopId = requireCoopId(ctx);
      const limit = input?.limit ?? 50;
      const search = input?.search?.trim();
      const source = input?.source ?? "ALL";
      const matchingBuyerIds = search
        ? (
            await db.user.findMany({
              where: {
                OR: [
                  { name: { contains: search, mode: "insensitive" } },
                  { email: { contains: search, mode: "insensitive" } },
                ],
              },
              select: { id: true },
              take: 100,
            })
          ).map((user: { id: string }) => user.id)
        : [];

      const storeOrderWhere: any = {
        store: {
          coopId,
          ...(input?.storeId ? { id: input.storeId } : {}),
          ...(input?.includeDeleted ? {} : { deletedAt: null }),
        },
        ...(input?.includeDeleted ? {} : { deletedAt: null }),
        ...(input?.fulfillmentStatus ? { fulfillmentStatus: input.fulfillmentStatus } : {}),
        ...(input?.paymentStatus ? { paymentStatus: input.paymentStatus } : {}),
      };

      if (search) {
        storeOrderWhere.OR = [
          { id: { contains: search, mode: "insensitive" } },
          { store: { name: { contains: search, mode: "insensitive" } } },
          ...(matchingBuyerIds.length > 0 ? [{ buyerId: { in: matchingBuyerIds } }] : []),
        ];
      }

      const commerceWhere: any = {
        coopId,
        ...(input?.includeDeleted ? {} : { deletedAt: null }),
        ...(input?.commerceStatus ? { status: input.commerceStatus } : {}),
        ...(input?.storeId
          ? {
              business: {
                store: {
                  id: input.storeId,
                  ...(input?.includeDeleted ? {} : { deletedAt: null }),
                },
              },
            }
          : {}),
      };

      if (search) {
        commerceWhere.OR = [
          { id: { contains: search, mode: "insensitive" } },
          { business: { name: { contains: search, mode: "insensitive" } } },
          { business: { store: { name: { contains: search, mode: "insensitive" } } } },
          { customer: { name: { contains: search, mode: "insensitive" } } },
          { customer: { email: { contains: search, mode: "insensitive" } } },
        ];
      }

      const [storeOrders, commerceTransactions] = await Promise.all([
        source === "COMMERCE_TRANSACTION"
          ? Promise.resolve([])
          : db.storeOrder.findMany({
              where: storeOrderWhere,
              take: limit,
              orderBy: { createdAt: "desc" },
              include: {
                store: {
                  select: { id: true, name: true, email: true },
                },
                items: {
                  include: {
                    product: {
                      select: { name: true },
                    },
                  },
                },
              },
            }),
        source === "STORE_ORDER"
          ? Promise.resolve([])
          : db.commerceTransaction.findMany({
              where: commerceWhere,
              take: limit,
              orderBy: { createdAt: "desc" },
              include: {
                customer: {
                  select: { id: true, name: true, email: true },
                },
                business: {
                  include: {
                    store: {
                      select: { id: true, name: true, email: true },
                    },
                  },
                },
              },
            }),
      ]);

      const buyerMap = new Map<string, { id: string; name: string | null; email: string | null }>(
        (
          await db.user.findMany({
            where: { id: { in: storeOrders.map((order: any) => order.buyerId) } },
            select: { id: true, name: true, email: true },
          })
        ).map((buyer: { id: string; name: string | null; email: string | null }) => [buyer.id, buyer]),
      );

      const normalizedStoreOrders = (storeOrders as any[]).map((order) => ({
        id: order.id,
        source: "STORE_ORDER" as const,
        storeId: order.store.id,
        storeName: order.store.name,
        storeEmail: order.store.email,
        customerId: order.buyerId,
        customerName: buyerMap.get(order.buyerId)?.name ?? null,
        customerEmail: buyerMap.get(order.buyerId)?.email ?? null,
        totalUSD: order.totalUSD,
        subtotalUSD: order.subtotalUSD,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        fulfillmentStatus: order.fulfillmentStatus,
        transactionReference: order.transactionHash,
        shippingAddress: order.shippingAddress,
        note: order.note,
        deletedAt: order.deletedAt ? order.deletedAt.toISOString() : null,
        deletedBy: order.deletedBy,
        itemCount: order.items.length,
        itemSummary: order.items.slice(0, 2).map((item: any) => item.product.name).join(", "),
        createdAt: order.createdAt.toISOString(),
      }));

      const normalizedCommerceTransactions = (commerceTransactions as any[]).map((transaction) => {
        const itemSummary = summarizeMetadataItems(transaction.metadata, "Order total");
        const customerEmail = getStringMetadata(transaction.metadata, "guestEmail") || transaction.customer.email;
        const customerName = getStringMetadata(transaction.metadata, "guestName") || transaction.customer.name;

        return {
          id: transaction.id,
          source: "COMMERCE_TRANSACTION" as const,
          storeId: transaction.business.store?.id ?? null,
          storeName: transaction.business.store?.name || transaction.business.name,
          storeEmail: transaction.business.store?.email ?? null,
          customerId: transaction.customer.id,
          customerName,
          customerEmail,
          totalUSD: transaction.chargedAmount,
          subtotalUSD: transaction.listedAmount,
          paymentMethod: "CARD",
          paymentStatus: transaction.status,
          fulfillmentStatus: null,
          transactionReference:
            transaction.stripeChargeId || transaction.stripePaymentIntentId,
          shippingAddress: getStringMetadata(transaction.metadata, "shippingAddress"),
          note: getStringMetadata(transaction.metadata, "note"),
          deletedAt: transaction.deletedAt ? transaction.deletedAt.toISOString() : null,
          deletedBy: transaction.deletedBy,
          itemCount: itemSummary.itemCount,
          itemSummary: itemSummary.itemSummary,
          createdAt: transaction.createdAt.toISOString(),
        };
      });

      const orders = [...normalizedStoreOrders, ...normalizedCommerceTransactions]
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, limit);

      return { orders };
    }),

  /**
   * Soft-delete or restore an order in the active co-op.
   */
  updateOrderDeletedAdmin: privateProcedure
    .input(z.object({
      orderId: z.string(),
      source: z.enum(["STORE_ORDER", "COMMERCE_TRANSACTION"]),
      deleted: z.boolean(),
    }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as Context;
      const db = context.db as any;
      const coopId = requireCoopId(ctx);
      const deletedAt = input.deleted ? new Date() : null;
      const deletedBy = input.deleted ? ((ctx as any).walletAddress ?? null) : null;

      if (input.source === "STORE_ORDER") {
        const order = await db.storeOrder.findFirst({
          where: {
            id: input.orderId,
            store: { coopId },
          },
          select: { id: true },
        });

        if (!order) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Order not found",
          });
        }

        await db.storeOrder.update({
          where: { id: order.id },
          data: { deletedAt, deletedBy },
        });
      } else {
        const transaction = await db.commerceTransaction.findFirst({
          where: {
            id: input.orderId,
            coopId,
          },
          select: { id: true },
        });

        if (!transaction) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Order not found",
          });
        }

        await db.commerceTransaction.update({
          where: { id: transaction.id },
          data: { deletedAt, deletedBy },
        });
      }

      return {
        success: true,
        message: input.deleted ? "Order soft deleted" : "Order restored",
      };
    }),

  /**
   * Check on-chain SC-verification status for a single store.
   * Returns both the DB flag and the live chain state so they can be compared.
   */
  checkStoreOnChainStatus: privateProcedure
    .input(z.object({ storeId: z.string() }))
    .query(async ({ input, ctx }) => {
      const context = ctx as Context;
      const coopId = (ctx as CoopScopedContext).coopId || '???';

      const store = await context.db.store.findUnique({
        where: { id: input.storeId },
        select: {
          id: true,
          name: true,
          isScVerified: true,
          owner: { select: { walletAddress: true } },
        },
      });

      if (!store) throw new TRPCError({ code: 'NOT_FOUND', message: 'Store not found' });

      const ownerWallet = store.owner.walletAddress;

      if (!ownerWallet) {
        return {
          storeId: store.id,
          dbVerified: store.isScVerified,
          onChainVerified: false,
          inSync: !store.isScVerified,
          ownerWallet: null,
          error: 'Store owner has no wallet address',
        };
      }

      const coopConfig = await context.db.coopConfig.findFirst({
        where: { coopId, isActive: true },
        orderBy: { version: 'desc' },
        select: {
          scTokenAddress: true,
          chainId: true,
          rpcUrl: true,
        },
      });

      if (!coopConfig?.scTokenAddress) {
        return {
          storeId: store.id,
          dbVerified: store.isScVerified,
          onChainVerified: false,
          inSync: false,
          ownerWallet,
          error: `SC token address not configured for coop: ${coopId}`,
        };
      }

      const { createPublicClient, http, parseAbi } = await import('viem');
      const { baseSepolia } = await import('viem/chains');

      const publicClient = createPublicClient({ 
        chain: baseSepolia, 
        transport: http(coopConfig.rpcUrl || 'https://sepolia.base.org') 
      });

      const onChainVerified = await publicClient.readContract({
        address: coopConfig.scTokenAddress as `0x${string}`,
        abi: parseAbi(['function isScVerifiedStore(address store) external view returns (bool)']),
        functionName: 'isScVerifiedStore',
        args: [ownerWallet as `0x${string}`],
      }) as boolean;

      return {
        storeId: store.id,
        dbVerified: store.isScVerified,
        onChainVerified,
        inSync: store.isScVerified === onChainVerified,
        ownerWallet,
        error: null,
      };
    }),

  /**
   * Get all products for a store (admin)
   */
  getStoreProductsAdmin: privateProcedure
    .input(z.object({
      storeId: z.string(),
      includeInactive: z.boolean().optional().default(true),
    }))
    .query(async ({ input, ctx }) => {
      const context = ctx as Context;

      const products = await context.db.product.findMany({
        where: {
          storeId: input.storeId,
          ...(input.includeInactive ? {} : { isActive: true }),
        },
        orderBy: [
          { isFeatured: "desc" },
          { createdAt: "desc" },
        ],
      });

      return products.map((product) => ({
        id: product.id,
        name: product.name,
        description: product.description,
        category: product.category,
        imageUrl: product.imageUrl,
        images: product.images,
        priceUSD: product.priceUSD,
        compareAtPrice: product.compareAtPrice,
        ucDiscountPrice: product.ucDiscountPrice,
        sku: product.sku,
        sourceUrl: product.sourceUrl,
        quantity: product.quantity,
        trackInventory: product.trackInventory,
        allowBackorder: product.allowBackorder,
        isActive: product.isActive,
        isFeatured: product.isFeatured,
        totalSold: product.totalSold,
        createdAt: product.createdAt,
      }));
    }),

  /**
   * Toggle featured status for a product (admin)
   */
  toggleProductFeatured: privateProcedure
    .input(z.object({
      productId: z.string(),
      featured: z.boolean(),
    }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as Context;

      const product = await context.db.product.update({
        where: { id: input.productId },
        data: {
          isFeatured: input.featured,
        },
        include: {
          store: {
            select: { name: true },
          },
        },
      });

      return {
        success: true,
        message: input.featured
          ? `"${product.name}" is now featured on the home page`
          : `"${product.name}" removed from featured`,
        product: {
          id: product.id,
          name: product.name,
          storeName: product.store.name,
          isFeatured: product.isFeatured,
        },
      };
    }),

  /**
   * Get featured products for home page (public)
   */
  getFeaturedProducts: publicProcedure
    .input(z.object({
      limit: z.number().min(1).max(20).optional().default(8),
    }).optional())
    .query(async ({ input, ctx }) => {
      const context = ctx as Context;
      const limit = input?.limit ?? 8;

      const products = await (context.db as any).product.findMany({
        where: {
          isFeatured: true,
          isActive: true,
          store: {
            status: "APPROVED",
            deletedAt: null,
            business: {
              stripeAccount: {
                chargesEnabled: true,
              },
            },
          },
        },
        take: limit,
        orderBy: { updatedAt: "desc" },
        include: {
          store: {
            select: {
              id: true,
              name: true,
              isScVerified: true,
              acceptsUC: true,
              ucDiscountPercent: true,
            },
          },
        },
      });

      return products.map((product: any) => ({
        id: product.id,
        name: product.name,
        description: product.description,
        imageUrl: product.imageUrl,
        priceUSD: product.priceUSD,
        compareAtPrice: product.compareAtPrice,
        ucDiscountPrice: product.ucDiscountPrice,
        store: product.store,
      }));
    }),

  /**
   * Update product (admin) - can set compareAtPrice
   */
  updateProductAdmin: privateProcedure
    .input(z.object({
      productId: z.string(),
      name: z.string().min(2).max(200).optional(),
      description: z.string().max(2000).nullable().optional(),
      category: ProductCategoryEnum.nullable().optional(),
      imageUrl: z.string().url().nullable().optional(),
      images: z.array(z.string().url()).optional(),
      priceUSD: z.number().positive().optional(),
      compareAtPrice: z.number().positive().nullable().optional(),
      ucDiscountPrice: z.number().positive().nullable().optional(),
      sku: z.string().nullable().optional(),
      quantity: z.number().int().min(0).optional(),
      trackInventory: z.boolean().optional(),
      allowBackorder: z.boolean().optional(),
      isActive: z.boolean().optional(),
      isFeatured: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as Context;
      const { productId, category, ...data } = input;

      const product = await context.db.product.update({
        where: { id: productId },
        data: {
          ...data,
          ...(category !== undefined && { category }),
        },
        include: {
          store: {
            select: { name: true },
          },
        },
      });

      return {
        success: true,
        product: {
          id: product.id,
          name: product.name,
          storeName: product.store.name,
        },
      };
    }),

  // ══════════════════════════════════════════════════════════════
  // ADMIN ENDPOINTS - Store and Product Management
  // ══════════════════════════════════════════════════════════════

  /**
   * Create a store (admin only) - bypasses application process
   */
  createStoreAdmin: privateProcedure
    .input(z.object({
      ownerId: z.string(),
      name: z.string().min(2).max(100),
      description: z.string().max(1000).optional(),
      category: StoreCategoryEnum,
      imageUrl: z.string().url().optional(),
      bannerUrl: z.string().url().optional(),
      address: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      zipCode: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().email().optional(),
      website: z.string().url().optional(),
      acceptsUC: z.boolean().optional().default(true),
      ucDiscountPercent: z.number().min(0).max(100).optional().default(20),
      isScVerified: z.boolean().optional().default(false),
    }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as Context;
      const coopId = (ctx as CoopScopedContext).coopId;

      if (!coopId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "coopId is required to create a store",
        });
      }

      // Verify owner exists
      const owner = await context.db.user.findUnique({
        where: { id: input.ownerId },
      });

      if (!owner) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Owner user not found",
        });
      }

      const store = await context.db.store.create({
        data: {
          ownerId: input.ownerId,
          coopId,
          name: input.name,
          description: input.description,
          category: input.category,
          imageUrl: input.imageUrl,
          bannerUrl: input.bannerUrl,
          address: input.address,
          city: input.city,
          state: input.state,
          zipCode: input.zipCode,
          phone: input.phone,
          email: input.email,
          website: input.website,
          acceptsUC: input.acceptsUC,
          ucDiscountPercent: input.ucDiscountPercent,
          status: "APPROVED", // Admin-created stores are auto-approved
          isScVerified: input.isScVerified ?? false,
          scVerifiedAt: input.isScVerified ? new Date() : null,
        },
      });

      return {
        success: true,
        store: {
          id: store.id,
          name: store.name,
          status: store.status,
        },
      };
    }),

  /**
   * Update an existing store (admin only)
   */
  updateStore: privateProcedure
    .input(z.object({
      storeId: z.string(),
      name: z.string().min(2).max(100).optional(),
      description: z.string().max(1000).optional(),
      category: StoreCategoryEnum.optional(),
      imageUrl: z.string().url().optional(),
      bannerUrl: z.string().url().optional(),
      address: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      zipCode: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().email().optional(),
      website: z.string().url().optional(),
      acceptsUC: z.boolean().optional(),
      ucDiscountPercent: z.number().min(0).max(100).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as Context;

      // Verify store exists
      const store = await context.db.store.findUnique({
        where: { id: input.storeId },
      });

      if (!store) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Store not found",
        });
      }

      // Build update data object with only provided fields
      const updateData: any = {};
      if (input.name !== undefined) updateData.name = input.name;
      if (input.description !== undefined) updateData.description = input.description;
      if (input.category !== undefined) updateData.category = input.category;
      if (input.imageUrl !== undefined) updateData.imageUrl = input.imageUrl;
      if (input.bannerUrl !== undefined) updateData.bannerUrl = input.bannerUrl;
      if (input.address !== undefined) updateData.address = input.address;
      if (input.city !== undefined) updateData.city = input.city;
      if (input.state !== undefined) updateData.state = input.state;
      if (input.zipCode !== undefined) updateData.zipCode = input.zipCode;
      if (input.phone !== undefined) updateData.phone = input.phone;
      if (input.email !== undefined) updateData.email = input.email;
      if (input.website !== undefined) updateData.website = input.website;
      if (input.acceptsUC !== undefined) updateData.acceptsUC = input.acceptsUC;
      if (input.ucDiscountPercent !== undefined) updateData.ucDiscountPercent = input.ucDiscountPercent;

      const updatedStore = await context.db.store.update({
        where: { id: input.storeId },
        data: updateData,
      });

      return {
        success: true,
        store: {
          id: updatedStore.id,
          name: updatedStore.name,
          category: updatedStore.category,
        },
      };
    }),

  /**
   * Add a product to any store (admin only) - can use admin-only categories
   */
  addProductAdmin: privateProcedure
    .input(z.object({
      storeId: z.string(),
      name: z.string().min(2).max(200),
      description: z.string().max(2000).optional(),
      category: ProductCategoryEnum,
      imageUrl: z.string().url().optional(),
      images: z.array(z.string().url()).optional(),
      priceUSD: z.number().positive(),
      compareAtPrice: z.number().positive().optional(),
      ucDiscountPrice: z.number().positive().optional(),
      sku: z.string().optional(),
      quantity: z.number().int().min(0).optional().default(0),
      trackInventory: z.boolean().optional().default(true),
      allowBackorder: z.boolean().optional().default(false),
      isActive: z.boolean().optional().default(true),
      isFeatured: z.boolean().optional().default(false),
    }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as Context;

      // Verify store exists
      const store = await context.db.store.findUnique({
        where: { id: input.storeId },
      });

      if (!store) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Store not found",
        });
      }

      // Admin can create products in any category, including admin-only ones
      const product = await context.db.product.create({
        data: {
          storeId: input.storeId,
          name: input.name,
          description: input.description,
          category: input.category,
          imageUrl: input.imageUrl,
          images: input.images || [],
          priceUSD: input.priceUSD,
          compareAtPrice: input.compareAtPrice,
          ucDiscountPrice: input.ucDiscountPrice,
          sku: input.sku,
          quantity: input.quantity,
          trackInventory: input.trackInventory,
          allowBackorder: input.allowBackorder,
          isActive: input.isActive,
          isFeatured: input.isFeatured,
        },
      });

      return {
        success: true,
        product: {
          id: product.id,
          name: product.name,
          category: product.category,
          priceUSD: product.priceUSD,
        },
      };
    }),

  /**
   * Bulk import products for a store (admin only). Accepts CSV/TSV content pasted
   * from a spreadsheet and can mirror remote image URLs into Vercel Blob.
   */
  bulkImportProductsAdmin: privateProcedure
    .input(z.object({
      storeId: z.string(),
      rawRows: z.string().min(1).max(250_000),
      defaultQuantity: z.number().int().min(0).optional().default(100),
      mirrorImages: z.boolean().optional().default(true),
      retries: z.number().int().min(1).max(5).optional().default(3),
      updateExisting: z.boolean().optional().default(true),
    }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as Context;

      const store = await context.db.store.findUnique({
        where: { id: input.storeId },
        select: { id: true, name: true },
      });

      if (!store) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Store not found",
        });
      }

      let rows;
      try {
        rows = parseDelimitedProductRows(input.rawRows);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Unable to parse rows",
        });
      }

      if (rows.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No product rows found",
        });
      }

      if (rows.length > 100) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Bulk import is limited to 100 products at a time",
        });
      }

      const results: Array<{
        rowNumber: number;
        name: string;
        status: "created" | "updated" | "failed";
        productId?: string;
        imageTotal?: number;
        imagesUploaded?: number;
        imageErrors?: string[];
        error?: string;
      }> = [];

      for (const row of rows) {
        try {
          if (row.storeId && row.storeId !== input.storeId) {
            throw new Error(`Row storeId ${row.storeId} does not match selected store ${input.storeId}`);
          }

          const mirroredImages = await mirrorProductImages({
            storeId: input.storeId,
            productName: row.name,
            imageUrl: row.imageUrl,
            images: row.images,
            mirrorImages: input.mirrorImages,
            retries: input.retries,
          });

          const data = {
            name: row.name,
            description: row.description,
            category: row.category,
            imageUrl: mirroredImages.imageUrl,
            images: mirroredImages.images,
            priceUSD: row.priceUSD,
            sku: row.sku,
            quantity: row.quantity ?? input.defaultQuantity,
            trackInventory: row.trackInventory,
            isActive: row.isActive,
            isFeatured: row.isFeatured,
            sourceUrl: row.sourceUrl,
          };

          const existing = input.updateExisting
            ? await context.db.product.findFirst({
                where: {
                  storeId: input.storeId,
                  OR: [
                    ...(row.sourceUrl ? [{ sourceUrl: row.sourceUrl }] : []),
                    ...(row.sku ? [{ sku: row.sku }] : []),
                    { name: row.name },
                  ],
                },
                select: { id: true },
              })
            : null;

          if (existing) {
            const product = await context.db.product.update({
              where: { id: existing.id },
              data,
              select: { id: true },
            });

            results.push({
              rowNumber: row.rowNumber,
              name: row.name,
              status: "updated",
              productId: product.id,
              imageTotal: mirroredImages.imageTotal,
              imagesUploaded: mirroredImages.imagesUploaded,
              imageErrors: mirroredImages.imageErrors,
            });
          } else {
            const product = await context.db.product.create({
              data: { storeId: input.storeId, ...data },
              select: { id: true },
            });

            results.push({
              rowNumber: row.rowNumber,
              name: row.name,
              status: "created",
              productId: product.id,
              imageTotal: mirroredImages.imageTotal,
              imagesUploaded: mirroredImages.imagesUploaded,
              imageErrors: mirroredImages.imageErrors,
            });
          }
        } catch (error) {
          results.push({
            rowNumber: row.rowNumber,
            name: row.name,
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return {
        success: true,
        storeId: store.id,
        total: results.length,
        created: results.filter((result) => result.status === "created").length,
        updated: results.filter((result) => result.status === "updated").length,
        failed: results.filter((result) => result.status === "failed").length,
        imageTotal: results.reduce((sum, result) => sum + (result.imageTotal ?? 0), 0),
        imagesUploaded: results.reduce((sum, result) => sum + (result.imagesUploaded ?? 0), 0),
        imageWarnings: results.reduce((sum, result) => sum + (result.imageErrors?.length ?? 0), 0),
        results,
      };
    }),

  /**
   * Step 1 for portal bulk import: parse rows and optionally mirror remote images
   * into Vercel Blob, but do not write any products yet.
   */
  prepareBulkProductImportAdmin: privateProcedure
    .input(z.object({
      storeId: z.string(),
      rawRows: z.string().min(1).max(250_000),
      mirrorImages: z.boolean().optional().default(true),
      retries: z.number().int().min(1).max(5).optional().default(3),
    }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as Context;

      const store = await context.db.store.findUnique({
        where: { id: input.storeId },
        select: { id: true, name: true },
      });

      if (!store) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Store not found",
        });
      }

      let rows;
      try {
        rows = parseDelimitedProductRows(input.rawRows);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Unable to parse rows",
        });
      }

      if (rows.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No product rows found",
        });
      }

      if (rows.length > 100) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Bulk import is limited to 100 products at a time",
        });
      }

      const preparedProducts: Array<{
        rowNumber: number;
        name: string;
        description?: string;
        category: string;
        imageUrl?: string;
        images: string[];
        priceUSD: number;
        quantity?: number;
        trackInventory: boolean;
        sourceUrl?: string;
        isActive: boolean;
        isFeatured: boolean;
        sku?: string;
        imageTotal: number;
        imagesUploaded: number;
        imageErrors: string[];
        status: "ready" | "failed";
        error?: string;
      }> = [];

      for (const row of rows) {
        try {
          if (row.storeId && row.storeId !== input.storeId) {
            throw new Error(`Row storeId ${row.storeId} does not match selected store ${input.storeId}`);
          }

          const mirroredImages = await mirrorProductImages({
            storeId: input.storeId,
            productName: row.name,
            imageUrl: row.imageUrl,
            images: row.images,
            mirrorImages: input.mirrorImages,
            retries: input.retries,
          });

          preparedProducts.push({
            rowNumber: row.rowNumber,
            name: row.name,
            description: row.description,
            category: row.category,
            imageUrl: mirroredImages.imageUrl,
            images: mirroredImages.images,
            priceUSD: row.priceUSD,
            quantity: row.quantity,
            trackInventory: row.trackInventory,
            sourceUrl: row.sourceUrl,
            isActive: row.isActive,
            isFeatured: row.isFeatured,
            sku: row.sku,
            imageTotal: mirroredImages.imageTotal,
            imagesUploaded: mirroredImages.imagesUploaded,
            imageErrors: mirroredImages.imageErrors,
            status: "ready",
          });
        } catch (error) {
          preparedProducts.push({
            rowNumber: row.rowNumber,
            name: row.name,
            description: row.description,
            category: row.category,
            imageUrl: row.imageUrl,
            images: row.images,
            priceUSD: row.priceUSD,
            quantity: row.quantity,
            trackInventory: row.trackInventory,
            sourceUrl: row.sourceUrl,
            isActive: row.isActive,
            isFeatured: row.isFeatured,
            sku: row.sku,
            imageTotal: (row.imageUrl ? 1 : 0) + row.images.length,
            imagesUploaded: 0,
            imageErrors: [],
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return {
        success: true,
        storeId: store.id,
        total: preparedProducts.length,
        ready: preparedProducts.filter((product) => product.status === "ready").length,
        failed: preparedProducts.filter((product) => product.status === "failed").length,
        imageTotal: preparedProducts.reduce((sum, product) => sum + product.imageTotal, 0),
        imagesUploaded: preparedProducts.reduce((sum, product) => sum + product.imagesUploaded, 0),
        imageWarnings: preparedProducts.reduce((sum, product) => sum + product.imageErrors.length, 0),
        products: preparedProducts,
      };
    }),

  /**
   * Step 2 for portal bulk import: save already prepared products to the DB.
   */
  savePreparedBulkProductsAdmin: privateProcedure
    .input(z.object({
      storeId: z.string(),
      defaultQuantity: z.number().int().min(0).optional().default(100),
      updateExisting: z.boolean().optional().default(true),
      products: z.array(z.object({
        rowNumber: z.number().int().min(1),
        name: z.string().min(2).max(200),
        description: z.string().max(2000).optional(),
        category: ProductCategoryEnum,
        imageUrl: z.string().url().optional(),
        images: z.array(z.string().url()).optional().default([]),
        priceUSD: z.number().positive(),
        quantity: z.number().int().min(0).optional(),
        trackInventory: z.boolean(),
        sourceUrl: z.string().url().optional(),
        isActive: z.boolean(),
        isFeatured: z.boolean(),
        sku: z.string().optional(),
      })).min(1).max(100),
    }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as Context;

      const store = await context.db.store.findUnique({
        where: { id: input.storeId },
        select: { id: true },
      });

      if (!store) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Store not found",
        });
      }

      const results: Array<{
        rowNumber: number;
        name: string;
        status: "created" | "updated" | "failed";
        productId?: string;
        error?: string;
      }> = [];

      for (const productInput of input.products) {
        try {
          const data = {
            name: productInput.name,
            description: productInput.description,
            category: productInput.category,
            imageUrl: productInput.imageUrl,
            images: productInput.images,
            priceUSD: productInput.priceUSD,
            sku: productInput.sku,
            quantity: productInput.quantity ?? input.defaultQuantity,
            trackInventory: productInput.trackInventory,
            isActive: productInput.isActive,
            isFeatured: productInput.isFeatured,
            sourceUrl: productInput.sourceUrl,
          };

          const existing = input.updateExisting
            ? await context.db.product.findFirst({
                where: {
                  storeId: input.storeId,
                  OR: [
                    ...(productInput.sourceUrl ? [{ sourceUrl: productInput.sourceUrl }] : []),
                    ...(productInput.sku ? [{ sku: productInput.sku }] : []),
                    { name: productInput.name },
                  ],
                },
                select: { id: true },
              })
            : null;

          if (existing) {
            const product = await context.db.product.update({
              where: { id: existing.id },
              data,
              select: { id: true },
            });

            results.push({
              rowNumber: productInput.rowNumber,
              name: productInput.name,
              status: "updated",
              productId: product.id,
            });
          } else {
            const product = await context.db.product.create({
              data: { storeId: input.storeId, ...data },
              select: { id: true },
            });

            results.push({
              rowNumber: productInput.rowNumber,
              name: productInput.name,
              status: "created",
              productId: product.id,
            });
          }
        } catch (error) {
          results.push({
            rowNumber: productInput.rowNumber,
            name: productInput.name,
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return {
        success: true,
        total: results.length,
        created: results.filter((result) => result.status === "created").length,
        updated: results.filter((result) => result.status === "updated").length,
        failed: results.filter((result) => result.status === "failed").length,
        results,
      };
    }),

  // ══════════════════════════════════════════════════════════════
  // ORDER ENDPOINTS - Checkout & Order Management
  // ══════════════════════════════════════════════════════════════

  /**
   * Create an order from cart items
   * Supports payment via wallet balance, card, or hybrid (balance + card)
   */
  createOrder: authenticatedProcedure
    .input(z.object({
      storeId: z.string(),
      items: z.array(z.object({
        productId: z.string(),
        quantity: z.number().int().positive(),
      })).min(1),
      shippingAddress: z.string().optional(),
      note: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as Context;
      const { walletAddress } = ctx as AuthenticatedContext;

      console.log('\n🛒 createOrder - START');
      console.log('🏪 Store ID:', input.storeId);
      console.log('📦 Items:', input.items.length);

      // Get buyer
      const buyer = await context.db.user.findUnique({
        where: { walletAddress },
        include: { paymentMethods: true },
      });

      if (!buyer) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      // Get store with owner
      const store = await context.db.store.findUnique({
        where: { id: input.storeId },
        include: {
          owner: {
            select: { id: true, walletAddress: true, email: true, name: true },
          },
        },
      });

      if (!store || store.status !== "APPROVED" || store.deletedAt) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Store not found",
        });
      }

      const coopConfig = await context.db.coopConfig.findFirst({
        where: { coopId: store.coopId, isActive: true },
        select: { name: true },
        orderBy: { version: "desc" },
      });

      // Validate all products and calculate totals
      const productIds = input.items.map(i => i.productId);
      const products = await context.db.product.findMany({
        where: {
          id: { in: productIds },
          storeId: input.storeId,
          isActive: true,
        },
      });

      if (products.length !== input.items.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Some products are unavailable",
        });
      }

      // Calculate totals
      let subtotalUSD = 0;
      const orderItems: Array<{
        productId: string;
        quantity: number;
        priceUSD: number;
        totalUSD: number;
      }> = [];

      for (const item of input.items) {
        const product = products.find(p => p.id === item.productId);
        if (!product) continue;

        // Check inventory
        if (product.trackInventory && product.quantity < item.quantity && !product.allowBackorder) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Not enough stock for "${product.name}"`,
          });
        }

        const itemTotal = product.priceUSD * item.quantity;
        subtotalUSD += itemTotal;
        orderItems.push({
          productId: product.id,
          quantity: item.quantity,
          priceUSD: product.priceUSD,
          totalUSD: itemTotal,
        });
      }

      const totalUSD = subtotalUSD; // Could add taxes/fees later
      const totalUC = convertUSDToUC(totalUSD);

      // Execute payment using p2p service
      // The p2p service handles:
      // - Checking buyer's balance
      // - JIT charging if insufficient balance (using default payment method)
      // - Minting UC after card charge
      // - Executing blockchain transfer
      let transactionHash: string | null = null;
      let fundingSource: 'BALANCE' | 'CARD' = 'BALANCE';

      try {
        console.log('💳 Processing payment for $', totalUSD);

        // Use the p2p service to handle the transfer
        // It automatically does JIT charging if buyer lacks balance
        const transferResult = await sendToSoulaanUser({
          senderId: buyer.id,
          recipientId: store.owner.id,
          amountUSD: totalUSD,
          coopId: store.coopId,
          note: `Order from ${store.name}`,
          transferType: 'STORE',
          transferMetadata: {
            storeName: store.name,
            storeId: store.id,
            itemCount: orderItems.length.toString(),
          },
        });

        transactionHash = transferResult.transactionHash;
        fundingSource = transferResult.fundingSource;

        console.log('✅ Payment complete:', transactionHash);
        console.log('💳 Funding source:', fundingSource);
      } catch (error: any) {
        console.error('❌ Payment failed:', error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message || "Payment failed. Please try again.",
        });
      }

      // Determine payment type for the order record
      const paymentType = fundingSource === 'CARD' ? 'CARD' : 'UC_BALANCE';

      // Create order in database
      const order = await context.db.storeOrder.create({
        data: {
          storeId: store.id,
          buyerId: buyer.id,
          subtotalUSD,
          discountUSD: 0,
          totalUSD,
          totalUC,
          paymentMethod: paymentType,
          paymentStatus: 'COMPLETED',
          transactionHash,
          fulfillmentStatus: 'PENDING',
          shippingAddress: input.shippingAddress,
          note: input.note,
          items: {
            create: orderItems.map(item => ({
              productId: item.productId,
              quantity: item.quantity,
              priceUSD: item.priceUSD,
              totalUSD: item.totalUSD,
            })),
          },
        },
        include: {
          items: {
            include: {
              product: {
                select: { name: true, imageUrl: true },
              },
            },
          },
          store: {
            select: { name: true, imageUrl: true },
          },
        },
      });

      // Update product inventory
      for (const item of orderItems) {
        const product = products.find(p => p.id === item.productId);
        if (product?.trackInventory) {
          await context.db.product.update({
            where: { id: item.productId },
            data: {
              quantity: { decrement: item.quantity },
              totalSold: { increment: item.quantity },
            },
          });
        }
      }

      // Update store stats
      await context.db.store.update({
        where: { id: store.id },
        data: {
          totalSales: { increment: totalUSD },
          totalOrders: { increment: 1 },
        },
      });

      // Award SC rewards if store is SC-verified (after order is created)
      let scRewardResult: { customerReward?: number; customerTxHash?: string } = {};
      if (store.isScVerified) {
        try {
          const rewardResult = await awardStoreTransactionReward(
            buyer.id,
            store.owner.id,
            totalUSD,
            true,
            store.coopId,     // Pass coopId
            order.id,         // Pass orderId
            store.id,         // Pass storeId
            transactionHash,  // Source UC tx hash
            'STORE_ORDER',    // Source type
            order.id          // Source record ID
          );
          scRewardResult = {
            customerReward: rewardResult.customerReward ?? undefined,
            customerTxHash: rewardResult.customerTxHash ?? undefined,
          };
          console.log('🪙 SC rewards distributed and tracked');
        } catch (error) {
          console.error('Failed to award SC (non-critical):', error);
        }
      }

      // Create notifications
      await context.db.notification.createMany({
        data: [
          {
            userId: buyer.id,
            coopId: store.coopId,
            type: 'ORDER_PLACED',
            title: 'Order Placed',
            body: `Your order from ${store.name} for $${totalUSD.toFixed(2)} has been placed.`,
            data: { orderId: order.id, storeId: store.id, amount: totalUSD },
          },
          {
            userId: store.owner.id,
            coopId: store.coopId,
            type: 'ORDER_RECEIVED',
            title: 'New Order',
            body: `You have a new order for $${totalUSD.toFixed(2)}.`,
            data: { orderId: order.id, amount: totalUSD },
          },
        ],
      });

      const orderEmailData = {
        orderId: order.id,
        coopName: coopConfig?.name,
        storeName: store.name,
        customerName: buyer.name,
        customerEmail: buyer.email,
        subtotalUSD,
        discountUSD: 0,
        totalUSD,
        totalUC,
        paymentMethod: paymentType,
        transactionHash,
        shippingAddress: input.shippingAddress,
        note: input.note,
        createdAt: order.createdAt,
        orderUrl: process.env.APP_URL ? `${process.env.APP_URL}/orders/${order.id}` : undefined,
        manageOrderUrl: process.env.APP_URL ? `${process.env.APP_URL}/orders/${order.id}` : undefined,
        items: order.items.map((item) => ({
          productName: item.product.name,
          quantity: item.quantity,
          priceUSD: item.priceUSD,
          totalUSD: item.totalUSD,
        })),
      };

      const notificationResults = await Promise.allSettled([
        sendOrderEmails({
          customerEmail: buyer.email,
          merchantEmail: [store.email, store.owner.email].filter(
            (email): email is string => typeof email === "string" && email.trim().length > 0,
          ),
          order: orderEmailData,
        }),
        sendOrderCompletedNotification({
          transactionId: order.id,
          customerName: buyer.name ?? undefined,
          customerEmail: buyer.email ?? undefined,
          businessName: store.name,
          amountUSD: totalUSD,
          coopId: store.coopId,
          isGuestCheckout: false,
        }),
      ]);

      notificationResults.forEach((result, index) => {
        if (result.status === "rejected") {
          const target = index === 0 ? "order emails" : "Slack order notification";
          console.error(`Failed to send ${target} (non-critical):`, result.reason);
        }
      });

      console.log('🎉 Order created:', order.id);

      return {
        success: true,
        orderId: order.id,
        scRewardSC: scRewardResult.customerReward ?? null, // actual SC minted (after diminishing rate)
        scRewardTxHash: scRewardResult.customerTxHash ?? null,
        order: {
          id: order.id,
          totalUSD: order.totalUSD,
          paymentMethod: order.paymentMethod,
          transactionHash: order.transactionHash,
          fulfillmentStatus: order.fulfillmentStatus,
          items: order.items.map(item => ({
            productId: item.productId,
            productName: item.product.name,
            quantity: item.quantity,
            priceUSD: item.priceUSD,
            totalUSD: item.totalUSD,
          })),
          store: order.store,
          createdAt: order.createdAt.toISOString(),
        },
      };
    }),

  /**
   * Get buyer's order history
   */
  getMyOrders: authenticatedProcedure
    .input(z.object({
      limit: z.number().min(1).max(50).optional().default(20),
      cursor: z.string().optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      const context = ctx as Context;
      const { walletAddress } = ctx as AuthenticatedContext;
      const { limit, cursor } = input || { limit: 20 };

      const buyer = await context.db.user.findUnique({
        where: { walletAddress },
      });

      if (!buyer) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      const orders = await context.db.storeOrder.findMany({
        where: { buyerId: buyer.id },
        take: limit + 1,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: { createdAt: 'desc' },
        include: {
          store: {
            select: {
              id: true,
              name: true,
              imageUrl: true,
            },
          },
          items: {
            include: {
              product: {
                select: { name: true, imageUrl: true },
              },
            },
          },
        },
      });

      let nextCursor: string | undefined;
      if (orders.length > limit) {
        const nextItem = orders.pop();
        nextCursor = nextItem?.id;
      }

      return {
        orders: orders.map(order => ({
          id: order.id,
          totalUSD: order.totalUSD,
          paymentMethod: order.paymentMethod,
          paymentStatus: order.paymentStatus,
          fulfillmentStatus: order.fulfillmentStatus,
          itemCount: order.items.length,
          store: order.store,
          items: order.items.map(item => ({
            productName: item.product.name,
            productImage: item.product.imageUrl,
            quantity: item.quantity,
            priceUSD: item.priceUSD,
          })),
          createdAt: order.createdAt.toISOString(),
        })),
        nextCursor,
      };
    }),

  /**
   * Get single order details
   */
  getOrder: authenticatedProcedure
    .input(z.object({
      orderId: z.string(),
    }))
    .query(async ({ input, ctx }) => {
      const context = ctx as Context;
      const { walletAddress } = ctx as AuthenticatedContext;

      const user = await context.db.user.findUnique({
        where: { walletAddress },
        include: {
          stores: { select: { id: true } },
        },
      });

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      const order = await context.db.storeOrder.findUnique({
        where: { id: input.orderId },
        include: {
          store: {
            select: {
              id: true,
              name: true,
              imageUrl: true,
              ownerId: true,
            },
          },
          items: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  imageUrl: true,
                },
              },
            },
          },
        },
      });

      if (!order) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Order not found",
        });
      }

      // Check if user is buyer or store owner
      const isBuyer = order.buyerId === user.id;
      const isStoreOwner = order.store.ownerId === user.id;

      if (!isBuyer && !isStoreOwner) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You don't have access to this order",
        });
      }

      return {
        id: order.id,
        subtotalUSD: order.subtotalUSD,
        discountUSD: order.discountUSD,
        totalUSD: order.totalUSD,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        transactionHash: order.transactionHash,
        fulfillmentStatus: order.fulfillmentStatus,
        shippingAddress: order.shippingAddress,
        trackingNumber: order.trackingNumber,
        note: order.note,
        store: {
          id: order.store.id,
          name: order.store.name,
          imageUrl: order.store.imageUrl,
        },
        items: order.items.map(item => ({
          id: item.id,
          productId: item.product.id,
          productName: item.product.name,
          productImage: item.product.imageUrl,
          quantity: item.quantity,
          priceUSD: item.priceUSD,
          totalUSD: item.totalUSD,
        })),
        isBuyer,
        isStoreOwner,
        createdAt: order.createdAt.toISOString(),
        updatedAt: order.updatedAt.toISOString(),
      };
    }),

  /**
   * Get store's incoming orders (for store owners)
   */
  getStoreOrders: authenticatedProcedure
    .input(z.object({
      storeId: z.string().optional(), // Optional - if not provided, returns orders from all stores
      status: z.enum(['PENDING', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED']).optional(),
      limit: z.number().min(1).max(50).optional().default(20),
      cursor: z.string().optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      const context = ctx as Context;
      const { walletAddress } = ctx as AuthenticatedContext;
      const { storeId, status, limit, cursor } = input || { limit: 20 };

      const user = await context.db.user.findUnique({
        where: { walletAddress },
      });

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      // If storeId provided, verify user owns it
      if (storeId) {
        const store = await context.db.store.findFirst({
          where: { id: storeId, ownerId: user.id },
        });

        if (!store) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Store not found or you don't own this store",
          });
        }

        const where: any = { storeId };
        if (status) where.fulfillmentStatus = status;

        const orders = await context.db.storeOrder.findMany({
          where,
          take: limit + 1,
          cursor: cursor ? { id: cursor } : undefined,
          orderBy: { createdAt: 'desc' },
          include: {
            items: {
              include: {
                product: {
                  select: { name: true },
                },
              },
            },
          },
        });

        let nextCursor: string | undefined;
        if (orders.length > limit) {
          const nextItem = orders.pop();
          nextCursor = nextItem?.id;
        }

        return {
          orders: orders.map(order => ({
            id: order.id,
            totalUSD: order.totalUSD,
            paymentStatus: order.paymentStatus,
            fulfillmentStatus: order.fulfillmentStatus,
            itemCount: order.items.length,
            itemSummary: order.items.slice(0, 2).map(i => i.product.name).join(', '),
            shippingAddress: order.shippingAddress,
            createdAt: order.createdAt.toISOString(),
          })),
          nextCursor,
        };
      }

      // If no storeId, get orders from all user's stores
      const stores = await context.db.store.findMany({
        where: { ownerId: user.id },
        select: { id: true },
      });

      if (stores.length === 0) {
        return { orders: [], nextCursor: undefined };
      }

      const where: any = { 
        storeId: { in: stores.map(s => s.id) }
      };
      if (status) where.fulfillmentStatus = status;

      const orders = await context.db.storeOrder.findMany({
        where,
        take: limit + 1,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: { createdAt: 'desc' },
        include: {
          items: {
            include: {
              product: {
                select: { name: true },
              },
            },
          },
        },
      });

      let nextCursor: string | undefined;
      if (orders.length > limit) {
        const nextItem = orders.pop();
        nextCursor = nextItem?.id;
      }

      return {
        orders: orders.map(order => ({
          id: order.id,
          totalUSD: order.totalUSD,
          paymentStatus: order.paymentStatus,
          fulfillmentStatus: order.fulfillmentStatus,
          itemCount: order.items.length,
          itemSummary: order.items.slice(0, 2).map(i => i.product.name).join(', '),
          shippingAddress: order.shippingAddress,
          createdAt: order.createdAt.toISOString(),
        })),
        nextCursor,
      };
    }),

  /**
   * Update store status (admin) - suspend, reactivate, or delete
   */
  updateStoreStatus: privateProcedure
    .input(z.object({
      storeId: z.string(),
      status: z.enum(["APPROVED", "SUSPENDED", "REJECTED"]),
    }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as Context;
      const db = context.db as any;
      const coopId = requireCoopId(ctx);

      const store = await db.store.findFirst({
        where: { id: input.storeId, coopId },
      });

      if (!store) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Store not found",
        });
      }

      await db.store.update({
        where: { id: store.id },
        data: {
          status: input.status,
          deletedAt: input.status === "REJECTED" ? new Date() : input.status === "APPROVED" ? null : store.deletedAt,
          deletedBy:
            input.status === "REJECTED"
              ? ((ctx as any).walletAddress ?? null)
              : input.status === "APPROVED"
                ? null
                : store.deletedBy,
        },
      });

      const statusMessages: Record<string, string> = {
        APPROVED: "Store reactivated",
        SUSPENDED: "Store suspended",
        REJECTED: "Store deleted",
      };

      return {
        success: true,
        message: statusMessages[input.status],
      };
    }),

  /**
   * Update order fulfillment status (for store owners)
   */
  updateOrderStatus: authenticatedProcedure
    .input(z.object({
      orderId: z.string(),
      status: z.enum(['PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED']),
      trackingNumber: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as Context;
      const { walletAddress } = ctx as AuthenticatedContext;

      const user = await context.db.user.findUnique({
        where: { walletAddress },
      });

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      // Verify order belongs to one of user's stores
      const order = await context.db.storeOrder.findUnique({
        where: { id: input.orderId },
        include: {
          store: {
            select: { ownerId: true, coopId: true },
          },
        },
      });

      if (!order || order.store.ownerId !== user.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Order not found or you don't own this order",
        });
      }

      const updatedOrder = await context.db.storeOrder.update({
        where: { id: input.orderId },
        data: {
          fulfillmentStatus: input.status,
          trackingNumber: input.trackingNumber,
        },
      });

      // Create notification for buyer
      const statusMessages: Record<string, string> = {
        PROCESSING: 'is being processed',
        SHIPPED: 'has been shipped',
        DELIVERED: 'has been delivered',
        CANCELLED: 'has been cancelled',
      };

      await context.db.notification.create({
        data: {
          userId: order.buyerId,
          coopId: order.store.coopId,
          type: 'ORDER_STATUS_UPDATE',
          title: 'Order Update',
          body: `Your order ${statusMessages[input.status]}.${input.trackingNumber ? ` Tracking: ${input.trackingNumber}` : ''}`,
          data: {
            orderId: order.id,
            status: input.status,
            trackingNumber: input.trackingNumber,
          },
        },
      });

      return {
        success: true,
        order: {
          id: updatedOrder.id,
          fulfillmentStatus: updatedOrder.fulfillmentStatus,
          trackingNumber: updatedOrder.trackingNumber,
        },
      };
    }),
});
