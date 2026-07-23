import { TRPCError } from "@trpc/server";
import type { Context } from "../context.js";
import { t } from "../trpc.js";

/**
 * Authenticated procedure - requires a valid wallet address but NOT admin status.
 * Use this for regular user actions like payments, bank accounts, etc.
 */
const isAuthenticated = t.middleware(async ({ ctx, next }) => {
  const context = ctx as Context;

  // Get wallet address from request header
  const walletAddress = context.req.headers['x-wallet-address'] as string | undefined;

  if (!walletAddress) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "No wallet address provided"
    });
  }

  // Validate address format
  if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid wallet address format"
    });
  }

  const user = await context.db.user.findFirst({
    where: {
      OR: [
        { walletAddress: { equals: walletAddress, mode: "insensitive" } },
        {
          wallets: {
            some: {
              address: { equals: walletAddress, mode: "insensitive" },
            },
          },
        },
      ],
    },
    select: { deletedAt: true },
  });

  if (user?.deletedAt) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This account has been deleted. Contact support if you need help.",
    });
  }

  return next({
    ctx: {
      ...ctx,
      walletAddress,
    },
  });
});

export const authenticatedProcedure = t.procedure.use(isAuthenticated);
