import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    DATABASE_URL: z.string().min(1),
    PORT: z.coerce.number().int().positive().default(3001),
    WALLET_ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/),
    BACKEND_WALLET_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
    STRIPE_SECRET_KEY: z.string().startsWith("sk_"),
    STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_"),
    STRIPE_PUBLISHABLE_KEY: z.string().startsWith("pk_").optional(),
    RPC_URL: z.string().url().default("https://sepolia.base.org"),
    BASE_SEPOLIA_RPC_URL: z.string().url().optional(),
    HOOKDECK_SIGNATURE_KEY: z.string().optional(),
    USE_HOOKDECK: z.enum(["true", "false"]).optional(),
    OPENAI_API_KEY: z.string().optional(),
    PAYPAL_WEBHOOK_ID: z.string().optional(),
    PAYPAL_CLIENT_ID: z.string().optional(),
    PAYPAL_CLIENT_SECRET: z.string().optional(),
    SQUARE_WEBHOOK_SIGNATURE_KEY: z.string().optional(),
    SLACK_WEBHOOK_URL: z.string().url().optional(),
    RESEND_API_KEY: z.string().startsWith("re_").optional(),
    RESEND_FROM_EMAIL: z.string().email().default("support@mail.cahootzcoops.com"),
    EMAIL_TEST_TOKEN: z.string().min(16).optional(),
    // Vercel Blob
    BLOB_READ_WRITE_TOKEN: z.string().min(1).optional(),
  },
  clientPrefix: "PUBLIC_",
  client: {},
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
  skipValidation: process.env.npm_lifecycle_event === "lint",
});

console.log("✅ API environment variables validated successfully");
