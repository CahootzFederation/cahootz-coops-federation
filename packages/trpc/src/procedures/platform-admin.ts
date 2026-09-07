import { TRPCError } from "@trpc/server";
import type { Context } from "../context.js";
import { t } from "../trpc.js";
import { isPlatformAdminWallet } from "../lib/admin-config.js";

/**
 * Platform admin procedure - requires the caller's wallet to be on the
 * hardcoded PLATFORM_ADMIN_WALLETS allowlist. Unlike privateProcedure,
 * this is not scoped to any single coop's blockchain role - it gates
 * cross-commons operations (e.g. deploying/registering a new commons).
 *
 * This still exists for direct browser-to-apps/api calls. The primary
 * admin-portal path for creating a commons goes through
 * apps/web/app/api/admin/commons/create/route.ts instead, which is gated
 * by the same iron-session check as the rest of /portal/admin and writes
 * to the database directly - no wallet allowlist required there.
 */
const isPlatformAdmin = t.middleware(async ({ ctx, next }) => {
  const context = ctx as Context;
  const walletAddress = context.req.headers["x-wallet-address"] as string | undefined;

  if (!walletAddress) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "No wallet address provided",
    });
  }

  if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid wallet address format",
    });
  }

  if (!isPlatformAdminWallet(walletAddress)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You must be a platform admin to perform this action",
    });
  }

  return next({
    ctx: {
      ...ctx,
      walletAddress,
    },
  });
});

export const platformAdminProcedure = t.procedure.use(isPlatformAdmin);
