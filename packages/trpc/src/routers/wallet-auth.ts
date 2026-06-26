import { randomBytes } from "crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { recoverMessageAddress } from "viem";

import { publicProcedure } from "../procedures/index.js";
import { router } from "../trpc.js";
import { getUserWalletInfo } from "../services/wallet-service.js";
import type { Context } from "../context.js";

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address");
const signatureSchema = z.string().regex(/^0x[a-fA-F0-9]{130}$/, "Invalid signature");

function getChallengeDomain(): string {
  const configuredUrl = process.env.WEB_BASE_URL || process.env.NEXT_PUBLIC_WEB_URL || "https://cahootz.coop";

  try {
    return new URL(configuredUrl).host;
  } catch {
    return "cahootz.coop";
  }
}

function buildWalletChallengeMessage({
  domain,
  purpose,
  walletAddress,
  userId,
  coopId,
  nonce,
  expiresAt,
}: {
  domain: string;
  purpose: string;
  walletAddress: string;
  userId: string;
  coopId?: string;
  nonce: string;
  expiresAt: Date;
}): string {
  return [
    "Sign in to Cahootz",
    "",
    `Domain: ${domain}`,
    `Purpose: ${purpose}`,
    `Wallet: ${walletAddress}`,
    `User ID: ${userId}`,
    `Co-op: ${coopId ?? "none"}`,
    `Nonce: ${nonce}`,
    `Expires At: ${expiresAt.toISOString()}`,
    "",
    "This signature proves wallet ownership. It does not approve a transaction or move funds.",
  ].join("\n");
}

export const walletAuthRouter = router({
  requestChallenge: publicProcedure
    .input(z.object({
      userId: z.string(),
      walletAddress: addressSchema,
      coopId: z.string().optional(),
      purpose: z.string().min(1).max(120),
    }))
    .output(z.object({
      challengeId: z.string(),
      message: z.string(),
      expiresAt: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as Context;
      const walletInfo = await getUserWalletInfo(input.userId, context.db);

      if (!walletInfo.hasWallet || walletInfo.address.toLowerCase() !== input.walletAddress.toLowerCase()) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Wallet is not linked to this user",
        });
      }

      const nonce = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      const message = buildWalletChallengeMessage({
        domain: getChallengeDomain(),
        purpose: input.purpose,
        walletAddress: walletInfo.address,
        userId: input.userId,
        coopId: input.coopId,
        nonce,
        expiresAt,
      });

      const challenge = await context.db.walletChallenge.create({
        data: {
          userId: input.userId,
          walletId: walletInfo.walletId,
          walletAddress: walletInfo.address,
          coopId: input.coopId,
          purpose: input.purpose,
          nonce,
          message,
          expiresAt,
        },
      });

      return {
        challengeId: challenge.id,
        message,
        expiresAt: expiresAt.toISOString(),
      };
    }),

  verifySignature: publicProcedure
    .input(z.object({
      challengeId: z.string(),
      walletAddress: addressSchema,
      signature: signatureSchema,
    }))
    .output(z.object({
      success: z.boolean(),
      userId: z.string(),
      walletAddress: z.string(),
      verifiedAt: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as Context;

      const challenge = await context.db.walletChallenge.findUnique({
        where: { id: input.challengeId },
      });

      if (!challenge) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Wallet challenge not found",
        });
      }

      if (challenge.consumedAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Wallet challenge has already been used",
        });
      }

      if (challenge.expiresAt <= new Date()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Wallet challenge has expired",
        });
      }

      if (challenge.walletAddress.toLowerCase() !== input.walletAddress.toLowerCase()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Wallet address does not match challenge",
        });
      }

      const recoveredAddress = await recoverMessageAddress({
        message: challenge.message,
        signature: input.signature as `0x${string}`,
      });

      if (recoveredAddress.toLowerCase() !== challenge.walletAddress.toLowerCase()) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid wallet signature",
        });
      }

      const walletInfo = await getUserWalletInfo(challenge.userId, context.db);
      if (!walletInfo.hasWallet || walletInfo.address.toLowerCase() !== challenge.walletAddress.toLowerCase()) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Wallet is no longer linked to this user",
        });
      }

      const verifiedAt = new Date();
      await context.db.$transaction([
        context.db.walletChallenge.update({
          where: { id: challenge.id },
          data: { consumedAt: verifiedAt },
        }),
        context.db.wallet.update({
          where: { address: challenge.walletAddress },
          data: {
            verifiedAt,
            lastSeenAt: verifiedAt,
          },
        }),
        context.db.user.update({
          where: { id: challenge.userId },
          data: {
            walletAddress: challenge.walletAddress,
          },
        }),
      ]);

      return {
        success: true,
        userId: challenge.userId,
        walletAddress: challenge.walletAddress,
        verifiedAt: verifiedAt.toISOString(),
      };
    }),
});
