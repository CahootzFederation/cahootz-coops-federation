import { config as dotenvConfig } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load root .env file BEFORE Next.js loads its own
dotenvConfig({ path: resolve(__dirname, '../../.env') });

// Then load local .env to allow overrides
dotenvConfig({ path: resolve(__dirname, '.env'), override: false });

console.log('✅ Next.js: Loaded environment variables from root .env');

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

// Import env files to validate at build time. Use jiti so we can load .ts files in here.
await jiti.import("./env");

/** @type {import("next").NextConfig} */
const config = {
  /** Enables hot reloading for local packages without a build step */
  transpilePackages: [
    "@repo/api",
    "@repo/auth",
    "@repo/db",
    "@repo/ui",
    "@repo/validators",
  ],

  /** We already do linting and typechecking as separate tasks in CI */
  typescript: { ignoreBuildErrors: true },

  /**
   * Allow uploaded images served from Vercel Blob public stores plus any
   * other https-hosted product/store image URLs (e.g. external sellers we
   * link to but haven't mirrored yet). Restrict to https only so we don't
   * accidentally proxy http content.
   */
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.public.blob.vercel-storage.com",
      },
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },

  /** Turbopack configuration (Next.js 16 default) */
  turbopack: {
    // Empty config to silence the warning about webpack config
    // Turbopack handles most externals automatically
  },

  /** Webpack configuration for when using --webpack flag */
  webpack: (config) => {
    config.externals.push('pino-pretty', 'lokijs', 'encoding');
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
    };
    return config;
  },

  /** The old group-buy homepage was merged into "/" on 2026-11-06. */
  async redirects() {
    return [{ source: "/landing", destination: "/", permanent: true }];
  },

  /** Add rewrites for PostHog ingestion endpoints */
  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/array/:path*",
        destination: "https://us-assets.i.posthog.com/array/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://us.i.posthog.com/:path*",
      },
    ];
  },

  // This is required to support PostHog trailing slash API requests
  skipTrailingSlashRedirect: true,
};

export default config;
