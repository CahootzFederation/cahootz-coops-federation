import { createEnv } from "@t3-oss/env-nextjs";
import { vercel } from "@t3-oss/env-nextjs/presets-zod";
import { z } from "zod/v4";

export const env = createEnv({
  extends: [vercel()],
  shared: {
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
  },
  /**
   * Specify your server-side environment variables schema here.
   * This way you can ensure the app isn't built with invalid env vars.
   */
  server: {
    DATABASE_URL: z.string().min(1),
    PLATFORM_ADMIN_WALLETS: z.string().optional(),
    PLATFORM_ADMIN_EMAILS: z.string().optional(),
    SLACK_WEBHOOK_URL: z.string().url().optional(),
    RESEND_API_KEY: z.string().startsWith("re_").optional(),
    RESEND_FROM_EMAIL: z.string().min(3).default("support@mail.cahootzcoops.com"),
    SESSION_SECRET: z.string().min(32).optional(),
    NOTION_TOKEN: z.string().optional(),
    NOTION_BLOG_DATABASE_ID: z.string().optional(),
    SKIP_BLOG_SYNC: z.enum(["true", "false"]).default("false"),
  },

  /**
   * Specify your client-side environment variables schema here.
   * For them to be exposed to the client, prefix them with `NEXT_PUBLIC_`.
   */
  client: {
    NEXT_PUBLIC_API_URL: z.string().url().optional(),
    NEXT_PUBLIC_COOP_ID: z.string().min(1).optional(),
    NEXT_PUBLIC_CHAIN_ID: z.coerce.number().int().positive().optional(),
    NEXT_PUBLIC_CHAIN_NAME: z.string().min(1).optional(),
    NEXT_PUBLIC_RPC_URL: z.string().url().optional(),
    NEXT_PUBLIC_SOULAANI_COIN_ADDRESS: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .optional(),
    NEXT_PUBLIC_TREASURY_SAFE_ADDRESS: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .optional(),
    NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
    NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID: z.string(),
    NEXT_PUBLIC_DOMAIN: z.string().optional(),
    NEXT_PUBLIC_URI: z.string().url().optional(),
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().min(1),
    NEXT_PUBLIC_STRIPE_MODE: z.enum(["test", "live"]).default("test"),
    NEXT_PUBLIC_DISQUS_SHORTNAME: z.string().optional(),
  },
  /**
   * Destructure all variables from `process.env` to make sure they aren't tree-shaken away.
   */
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    PLATFORM_ADMIN_WALLETS: process.env.PLATFORM_ADMIN_WALLETS,
    PLATFORM_ADMIN_EMAILS: process.env.PLATFORM_ADMIN_EMAILS,
    SLACK_WEBHOOK_URL: process.env.SLACK_WEBHOOK_URL,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
    SESSION_SECRET: process.env.SESSION_SECRET,
    NOTION_TOKEN: process.env.NOTION_TOKEN,
    NOTION_BLOG_DATABASE_ID: process.env.NOTION_BLOG_DATABASE_ID,
    SKIP_BLOG_SYNC: process.env.SKIP_BLOG_SYNC,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_COOP_ID: process.env.NEXT_PUBLIC_COOP_ID,
    NEXT_PUBLIC_CHAIN_ID: process.env.NEXT_PUBLIC_CHAIN_ID,
    NEXT_PUBLIC_CHAIN_NAME: process.env.NEXT_PUBLIC_CHAIN_NAME,
    NEXT_PUBLIC_RPC_URL: process.env.NEXT_PUBLIC_RPC_URL,
    NEXT_PUBLIC_SOULAANI_COIN_ADDRESS:
      process.env.NEXT_PUBLIC_SOULAANI_COIN_ADDRESS,
    NEXT_PUBLIC_TREASURY_SAFE_ADDRESS:
      process.env.NEXT_PUBLIC_TREASURY_SAFE_ADDRESS,
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID: process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID,
    NEXT_PUBLIC_DOMAIN: process.env.NEXT_PUBLIC_DOMAIN,
    NEXT_PUBLIC_URI: process.env.NEXT_PUBLIC_URI,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_STRIPE_MODE: process.env.NEXT_PUBLIC_STRIPE_MODE,
    NEXT_PUBLIC_DISQUS_SHORTNAME: process.env.NEXT_PUBLIC_DISQUS_SHORTNAME,
  },
  emptyStringAsUndefined: true,
  skipValidation:
    process.env.SKIP_ENV_VALIDATION === "true" ||
    process.env.npm_lifecycle_event === "lint",
});
