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

    SLACK_WEBHOOK_URL: z.string().url().optional(),
    SESSION_SECRET: z.string().min(32).optional(),
    NOTION_TOKEN: z.string().optional(),
    NOTION_BLOG_DATABASE_ID: z.string().optional(),
  },

  /**
   * Specify your client-side environment variables schema here.
   * For them to be exposed to the client, prefix them with `NEXT_PUBLIC_`.
   */
  client: {
    NEXT_PUBLIC_API_URL: z.string().url().optional(),
    NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
    NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID: z.string(),
    NEXT_PUBLIC_DOMAIN: z.string().optional(),
    NEXT_PUBLIC_URI: z.string().url().optional(),
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().min(1),
    NEXT_PUBLIC_STRIPE_MODE: z.enum(["test", "live"]).default("test"),
    NEXT_PUBLIC_DISQUS_SHORTNAME: z.string().optional(),
    NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN: z.string().optional(),
  },
  /**
   * Destructure all variables from `process.env` to make sure they aren't tree-shaken away.
   */
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    SLACK_WEBHOOK_URL: process.env.SLACK_WEBHOOK_URL,
    SESSION_SECRET: process.env.SESSION_SECRET,
    NOTION_TOKEN: process.env.NOTION_TOKEN,
    NOTION_BLOG_DATABASE_ID: process.env.NOTION_BLOG_DATABASE_ID,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID: process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID,
    NEXT_PUBLIC_DOMAIN: process.env.NEXT_PUBLIC_DOMAIN,
    NEXT_PUBLIC_URI: process.env.NEXT_PUBLIC_URI,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_STRIPE_MODE: process.env.NEXT_PUBLIC_STRIPE_MODE,
    NEXT_PUBLIC_DISQUS_SHORTNAME: process.env.NEXT_PUBLIC_DISQUS_SHORTNAME,
    NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN: process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN,
  },
  emptyStringAsUndefined: true,
  skipValidation:
    process.env.SKIP_ENV_VALIDATION === "true" ||
    process.env.npm_lifecycle_event === "lint",
});
