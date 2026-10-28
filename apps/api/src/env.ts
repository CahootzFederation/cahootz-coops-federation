import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    DATABASE_URL: z.string().min(1),
    PORT: z.coerce.number().int().positive().default(3001),
    APP_URL: z.string().url().optional(),
    API_BASE_URL: z.string().url().optional(),
    WEB_URL: z.string().url().optional(),
    WEB_BASE_URL: z.string().url().optional(),
    NEXT_PUBLIC_APP_URL: z.string().url().optional(),
    NEXT_PUBLIC_URI: z.string().url().optional(),
    NEXT_PUBLIC_WEB_URL: z.string().url().optional(),
    SESSION_SECRET: z.string().min(32).optional(),
    WALLET_ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/),
    BACKEND_WALLET_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
    GOVERNANCE_BOT_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
    DEV_AGENT_TOKEN: z.string().min(1).optional(),
    DEV_AGENT_WALLET_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
    STRIPE_SECRET_KEY: z.string().startsWith("sk_"),
    STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_"),
    STRIPE_PUBLISHABLE_KEY: z.string().startsWith("pk_").optional(),
    PAYPAL_MODE: z.enum(["sandbox", "live"]).default("sandbox"),
    SQUARE_ACCESS_TOKEN: z.string().min(1).optional(),
    SQUARE_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
    RPC_URL: z.string().url().default("https://sepolia.base.org"),
    BASE_SEPOLIA_RPC_URL: z.string().url().optional(),
    TRUSTLESS_DEPLOYMENT_BLOCK: z.coerce.number().int().nonnegative().default(0),
    HOOKDECK_SIGNATURE_KEY: z.string().optional(),
    USE_HOOKDECK: z.enum(["true", "false"]).optional(),
    OPENAI_API_KEY: z.string().startsWith("sk-").min(20),
    COMMONS_AI_MODEL: z.string().min(1).optional(),
    NEWSLETTER_ARTICLE_MODEL: z.string().min(1).optional(),
    TRIGGER_SECRET_KEY: z.string().min(1).optional(),
    SAGE_WAKE_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
    PAYPAL_WEBHOOK_ID: z.string().optional(),
    PAYPAL_CLIENT_ID: z.string().optional(),
    PAYPAL_CLIENT_SECRET: z.string().optional(),
    SQUARE_WEBHOOK_SIGNATURE_KEY: z.string().optional(),
    SLACK_WEBHOOK_URL: z.string().url(),
    // A fine-grained token with Issues: write on the repo. Without it, Sage still drafts but nothing posts.
    GITHUB_ISSUES_TOKEN: z.string().min(1).optional(),
    GITHUB_ISSUES_REPO: z.string().regex(/^[\w.-]+\/[\w.-]+$/).optional(),
    RESEND_API_KEY: z.string().startsWith("re_"),
    RESEND_FROM_EMAIL: z.string().email().default("support@mail.cahootzcoops.com"),
    SENTRY_DSN: z.string().url().optional(),
    // PostHog error tracking (server). Same project key as the apps; unset turns capture off.
    POSTHOG_KEY: z.string().startsWith("phc_").optional(),
    POSTHOG_HOST: z.string().url().optional(),
    EMAIL_TEST_TOKEN: z.string().min(16).optional(),
    MEMBER_APP_LINK_URL: z.string().url().optional(),
    PLATFORM_ADMIN_WALLETS: z.string().optional(),
    PLATFORM_ADMIN_EMAILS: z.string().optional(),
    PRISMA_CONNECTION_LIMIT: z.coerce.number().int().positive().optional(),
    PRISMA_POOL_TIMEOUT: z.coerce.number().int().positive().optional(),
    HEALTHCHECK_NOTIFICATION_COOLDOWN_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(5 * 60 * 1000),
    HEALTHCHECK_FAILURES_BEFORE_ALERT: z.coerce.number().int().positive().default(3),
    HEALTHCHECK_STARTUP_GRACE_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(2 * 60 * 1000),
    TWILIO_ACCOUNT_SID: z.string().min(1).optional(),
    TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
    TWILIO_PHONE_NUMBER: z.string().min(1).optional(),
    COOP_NAME: z.string().min(1).optional(),
    COOP_SHORT_NAME: z.string().min(1).optional(),
    COOP_TAGLINE: z.string().min(1).optional(),
    COOP_PRIMARY_COLOR: z.string().regex(/^#[a-fA-F0-9]{6}$/).optional(),
    COOP_ACCENT_COLOR: z.string().regex(/^#[a-fA-F0-9]{6}$/).optional(),
    COOP_LOGO_URL: z.string().min(1).optional(),
    IOS_APP_STORE_URL: z.string().url().optional(),
    ANDROID_PLAY_STORE_URL: z.string().url().optional(),
    SUPPORT_PHONE: z.string().optional(),
    MIN_PAYMENT_AMOUNT: z.coerce.number().positive().optional(),
    MAX_PAYMENT_AMOUNT: z.coerce.number().positive().optional(),
    CLAIM_EXPIRATION_DAYS: z.coerce.number().int().positive().optional(),
    WITHDRAWAL_MIN_AMOUNT: z.coerce.number().nonnegative().optional(),
    P2P_FEE_PERCENT: z.coerce.number().nonnegative().optional(),
    WITHDRAWAL_FEE_PERCENT: z.coerce.number().nonnegative().optional(),
    WITHDRAWAL_FEE_FLAT: z.coerce.number().nonnegative().optional(),
    // Vercel Blob
    BLOB_READ_WRITE_TOKEN: z.string().min(1).optional(),
  },
  clientPrefix: "PUBLIC_",
  client: {},
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
  skipValidation: process.env.npm_lifecycle_event === "lint",
});

if (env.NODE_ENV === "production" && !env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET is required in production");
}

// Without a deployed Trigger key, production silently loses every scheduled agent (community memory,
// weekly check-ins, recovery scans) except the in-process Sage wake fallback, so refuse to build or start.
if (env.NODE_ENV === "production") {
  const triggerKey = env.TRIGGER_SECRET_KEY?.trim();
  if (!triggerKey) {
    throw new Error("TRIGGER_SECRET_KEY is required in production. Copy the Production secret key from the Trigger.dev project's API keys page.");
  }
  if (!triggerKey.startsWith("tr_") || triggerKey.startsWith("tr_dev_")) {
    throw new Error("TRIGGER_SECRET_KEY must be a deployed Trigger.dev secret key (tr_prod_... or tr_stg_...), not a development key.");
  }
}

console.log("✅ API environment variables validated successfully");
