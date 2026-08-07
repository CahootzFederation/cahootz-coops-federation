/**
 * Store Quick Payment Router
 * Handles QR codes, payment requests, and quick payments for stores
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { db } from "@repo/db";

import { authenticatedProcedure, publicProcedure } from "../procedures/index.js";
import { router } from "../trpc.js";
import { CoopScopedContext } from "../context.js";
import {
  generateUniqueShortCode,
  validateShortCode,
  normalizeShortCode,
  isShortCodeAvailable,
  createPaymentRequest,
  getPaymentRequestByToken,
  getStoreByShortCode,
  payRequest,
  payByStoreCode,
  getStorePaymentRequests,
  cancelPaymentRequest,
} from "../services/store-pay-service.js";

export const storePayRouter = router({
  // ═══════════════════════════════════════════════════════════
  // STORE CODE MANAGEMENT
  // ═══════════════════════════════════════════════════════════

  /**
   * Generate or set store's short code
   */
  generateShortCode: authenticatedProcedure
    .input(z.object({
      userId: z.string(),
      customCode: z.string().min(3).max(20).optional(),
    }))
    .output(z.object({
      shortCode: z.string(),
      qrCodeData: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const coopId = (ctx as CoopScopedContext).coopId || '???';
      
      // Get user's store
      const store = await db.store.findFirst({
        where: { ownerId: input.userId, coopId, status: 'APPROVED' },
        select: { id: true, name: true, shortCode: true, coopId: true },
      });

      if (!store) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "You don't have an approved store",
        });
      }

      let shortCode: string;

      if (input.customCode) {
        // Validate custom code
        if (!validateShortCode(input.customCode)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invalid code format. Use 3-20 alphanumeric characters or hyphens.",
          });
        }

        const normalized = normalizeShortCode(input.customCode);

        // Check availability (unless it's the same as current)
        if (normalized !== store.shortCode) {
          const available = await isShortCodeAvailable(normalized, store.coopId);
          if (!available) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "This code is already taken",
            });
          }
        }

        shortCode = normalized;
      } else {
        // Generate a unique code
        shortCode = await generateUniqueShortCode(store.name, store.coopId);
      }

      // Update store
      await db.store.update({
        where: { id: store.id },
        data: { shortCode },
      });

      return {
        shortCode,
        qrCodeData: `commons://pay/s/${shortCode}`,
      };
    }),

  /**
   * Check if a short code is available
   */
  validateShortCode: authenticatedProcedure
    .input(z.object({
      code: z.string().min(3).max(20),
    }))
    .output(z.object({
      valid: z.boolean(),
      available: z.boolean(),
      normalized: z.string(),
      message: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
      if (!validateShortCode(input.code)) {
        return {
          valid: false,
          available: false,
          normalized: '',
          message: 'Invalid format. Use 3-20 alphanumeric characters or hyphens.',
        };
      }

      const coopId = (ctx as CoopScopedContext).coopId || '???';
      const normalized = normalizeShortCode(input.code);
      const available = await isShortCodeAvailable(normalized, coopId);

      return {
        valid: true,
        available,
        normalized,
        message: available ? undefined : 'This code is already taken',
      };
    }),

  /**
   * Get store's quick pay info (for store owner)
   */
  getQuickPayInfo: authenticatedProcedure
    .input(z.object({
      userId: z.string(),
    }))
    .output(z.object({
      hasStore: z.boolean(),
      shortCode: z.string().nullable(),
      acceptsQuickPay: z.boolean(),
      qrCodeData: z.string().nullable(),
      storeName: z.string().nullable(),
    }))
    .query(async ({ input }) => {
      const store = await db.store.findFirst({
        where: { ownerId: input.userId, status: 'APPROVED' },
        select: {
          name: true,
          shortCode: true,
          acceptsQuickPay: true,
        },
      });

      if (!store) {
        return {
          hasStore: false,
          shortCode: null,
          acceptsQuickPay: false,
          qrCodeData: null,
          storeName: null,
        };
      }

      return {
        hasStore: true,
        shortCode: store.shortCode,
        acceptsQuickPay: store.acceptsQuickPay,
        qrCodeData: store.shortCode ? `commons://pay/s/${store.shortCode}` : null,
        storeName: store.name,
      };
    }),

  // ═══════════════════════════════════════════════════════════
  // PAYMENT REQUESTS (QR & LINKS)
  // ═══════════════════════════════════════════════════════════

  /**
   * Create a payment request (generates token for QR/link)
   */
  createPaymentRequest: authenticatedProcedure
    .input(z.object({
      userId: z.string(),
      amount: z.number().positive().max(10000).optional(),
      description: z.string().max(100).optional(),
      referenceId: z.string().max(50).optional(),
      expiresInMinutes: z.number().min(1).max(1440).optional(), // Max 24 hours
    }))
    .output(z.object({
      requestId: z.string(),
      token: z.string(),
      qrCodeData: z.string(),
      paymentUrl: z.string(),
      amount: z.number().optional(),
      description: z.string().optional(),
      expiresAt: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      // Get user's store
      const store = await db.store.findFirst({
        where: { ownerId: input.userId, status: 'APPROVED' },
        select: { id: true, acceptsQuickPay: true },
      });

      if (!store) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "You don't have an approved store",
        });
      }

      if (!store.acceptsQuickPay) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Quick payments are disabled for your store",
        });
      }

      const result = await createPaymentRequest({
        storeId: store.id,
        amount: input.amount,
        description: input.description,
        referenceId: input.referenceId,
        expiresInMinutes: input.expiresInMinutes,
      });

      return {
        ...result,
        expiresAt: result.expiresAt?.toISOString(),
      };
    }),

  /**
   * Get payment request info by token (PUBLIC - no auth required)
   */
  getPaymentRequest: publicProcedure
    .input(z.object({
      token: z.string(),
    }))
    .output(z.object({
      found: z.boolean(),
      id: z.string().optional(),
      store: z.object({
        id: z.string(),
        name: z.string(),
        shortCode: z.string().nullable(),
        imageUrl: z.string().nullable(),
        isScVerified: z.boolean(),
      }).optional(),
      amount: z.number().nullable().optional(),
      description: z.string().nullable().optional(),
      status: z.string().optional(),
      expiresAt: z.string().nullable().optional(),
      isExpired: z.boolean().optional(),
    }))
    .query(async ({ input }) => {
      const request = await getPaymentRequestByToken(input.token);

      if (!request) {
        return { found: false };
      }

      return {
        found: true,
        id: request.id,
        store: request.store,
        amount: request.amount,
        description: request.description,
        status: request.status,
        expiresAt: request.expiresAt?.toISOString() || null,
        isExpired: request.isExpired,
      };
    }),

  /**
   * Pay a payment request
   */
  payRequest: authenticatedProcedure
    .input(z.object({
      userId: z.string(),
      token: z.string(),
      amount: z.number().positive().max(10000),
    }))
    .output(z.object({
      success: z.boolean(),
      transferId: z.string(),
      message: z.string(),
    }))
    .mutation(async ({ input }) => {
      try {
        const result = await payRequest({
          token: input.token,
          payerId: input.userId,
          amount: input.amount,
        });

        return result;
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Payment failed",
        });
      }
    }),

  /**
   * Get store's payment request history
   */
  getMyPaymentRequests: authenticatedProcedure
    .input(z.object({
      userId: z.string(),
      status: z.enum(['PENDING', 'COMPLETED', 'EXPIRED', 'CANCELLED']).optional(),
      limit: z.number().min(1).max(100).default(50),
      cursor: z.string().optional(),
    }))
    .output(z.object({
      requests: z.array(z.object({
        id: z.string(),
        token: z.string(),
        amount: z.number().nullable(),
        description: z.string().nullable(),
        referenceId: z.string().nullable(),
        status: z.string(),
        paidAt: z.string().nullable(),
        expiresAt: z.string().nullable(),
        createdAt: z.string(),
      })),
      nextCursor: z.string().nullable(),
    }))
    .query(async ({ input }) => {
      // Get user's store
      const store = await db.store.findFirst({
        where: { ownerId: input.userId },
        select: { id: true },
      });

      if (!store) {
        return { requests: [], nextCursor: null };
      }

      const { requests, nextCursor } = await getStorePaymentRequests(
        store.id,
        input.status,
        input.limit,
        input.cursor
      );

      return {
        requests: requests.map(r => ({
          ...r,
          paidAt: r.paidAt?.toISOString() || null,
          expiresAt: r.expiresAt?.toISOString() || null,
          createdAt: r.createdAt.toISOString(),
        })),
        nextCursor,
      };
    }),

  /**
   * Cancel a payment request
   */
  cancelPaymentRequest: authenticatedProcedure
    .input(z.object({
      userId: z.string(),
      requestId: z.string(),
    }))
    .output(z.object({
      success: z.boolean(),
    }))
    .mutation(async ({ input }) => {
      // Get user's store
      const store = await db.store.findFirst({
        where: { ownerId: input.userId },
        select: { id: true },
      });

      if (!store) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Store not found",
        });
      }

      try {
        await cancelPaymentRequest(input.requestId, store.id);
        return { success: true };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Failed to cancel",
        });
      }
    }),

  // ═══════════════════════════════════════════════════════════
  // STORE CODE LOOKUP (FOR QUICK PAY)
  // ═══════════════════════════════════════════════════════════

  /**
   * Look up store by short code (PUBLIC)
   */
  getStoreByCode: publicProcedure
    .input(z.object({
      code: z.string(),
      coopId: z.string(),
    }))
    .output(z.object({
      found: z.boolean(),
      store: z.object({
        id: z.string(),
        name: z.string(),
        shortCode: z.string().nullable(),
        imageUrl: z.string().nullable(),
        isScVerified: z.boolean(),
        acceptsQuickPay: z.boolean(),
      }).optional(),
    }))
    .query(async ({ input }) => {
      const store = await getStoreByShortCode(input.code, input.coopId);

      if (!store) {
        return { found: false };
      }

      return {
        found: true,
        store: {
          id: store.id,
          name: store.name,
          shortCode: store.shortCode,
          imageUrl: store.imageUrl,
          isScVerified: store.isScVerified,
          acceptsQuickPay: store.acceptsQuickPay,
        },
      };
    }),

  /**
   * Pay a store directly by code (no payment request)
   */
  payByStoreCode: authenticatedProcedure
    .input(z.object({
      userId: z.string(),
      storeCode: z.string(),
      amount: z.number().positive().max(10000),
      note: z.string().max(100).optional(),
    }))
    .output(z.object({
      success: z.boolean(),
      transferId: z.string(),
      message: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const coopId = (ctx as CoopScopedContext).coopId || '???';
        const result = await payByStoreCode({
          storeCode: input.storeCode,
          payerId: input.userId,
          amount: input.amount,
          coopId,
          note: input.note,
        });

        return result;
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Payment failed",
        });
      }
    }),
});
