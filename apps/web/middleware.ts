import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getIronSession } from "iron-session";

import type { HomepageVariant } from "./lib/homepage-experiment";
import type { AuthSession } from "./lib/signature-verification";
import { env } from "./env";
import { validateCsrfToken } from "./lib/csrf";
import {
  HOMEPAGE_EXPERIMENT_FLAG_KEY,
  HOMEPAGE_EXPERIMENT_PREVIEW_COOKIE,
  HOMEPAGE_POSTHOG_DISTINCT_ID_COOKIE,
  normalizeHomepageVariant,
} from "./lib/homepage-experiment";
import PostHogClient from "./lib/posthog";

// Specify Node.js runtime for middleware
export const runtime = "nodejs";

// Define protected API routes
const PROTECTED_API_ROUTES = [
  "/api/portal/",
  "/api/members/",
  "/api/redemptions/",
];

// Define state-changing methods that require CSRF protection
const STATE_CHANGING_METHODS = ["POST", "PUT", "DELETE", "PATCH"];

// Session options
const sessionOptions = {
  password:
    env.SESSION_SECRET || "complex_password_at_least_32_characters_long",
  cookieName: "cahootz_auth_session",
  cookieOptions: {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "strict" as const,
    maxAge: 60 * 60 * 24 * 7, // 1 week
  },
};

// Rate limiting map (in-memory for development, should use Redis in production)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

// Rate limit configuration
const RATE_LIMIT = 10; // requests per minute
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute in milliseconds
const HOMEPAGE_EXPERIMENT_MAX_AGE = 60 * 60 * 24 * 30;
const HOMEPAGE_VISITOR_MAX_AGE = 60 * 60 * 24 * 365;

interface HomepageExperimentDecision {
  variant: HomepageVariant;
  distinctId: string | null;
  preview: HomepageVariant | "auto" | null;
}

async function getHomepageVariant(
  request: NextRequest,
): Promise<HomepageExperimentDecision> {
  const requestedPreview = request.nextUrl.searchParams.get("homepage");
  const previewVariant = normalizeHomepageVariant(requestedPreview);

  if (previewVariant) {
    return {
      variant: previewVariant,
      distinctId: null,
      preview: previewVariant,
    };
  }

  const savedPreview = normalizeHomepageVariant(
    request.cookies.get(HOMEPAGE_EXPERIMENT_PREVIEW_COOKIE)?.value,
  );

  if (requestedPreview !== "auto" && savedPreview) {
    return { variant: savedPreview, distinctId: null, preview: null };
  }

  const distinctId =
    request.cookies.get(HOMEPAGE_POSTHOG_DISTINCT_ID_COOKIE)?.value ||
    crypto.randomUUID();

  if (!env.NEXT_PUBLIC_POSTHOG_KEY) {
    return {
      variant: "community",
      distinctId,
      preview: requestedPreview === "auto" ? "auto" : null,
    };
  }

  const posthog = PostHogClient({ requestTimeout: 1500 });

  try {
    const flags = await posthog.evaluateFlags(distinctId, {
      flagKeys: [HOMEPAGE_EXPERIMENT_FLAG_KEY],
    });
    const variant = normalizeHomepageVariant(
      flags.getFlag(HOMEPAGE_EXPERIMENT_FLAG_KEY),
    );

    return {
      variant: variant ?? "community",
      distinctId,
      preview: requestedPreview === "auto" ? "auto" : null,
    };
  } catch (error) {
    console.warn(
      "Homepage feature flag evaluation failed; using community.",
      error,
    );
    return {
      variant: "community",
      distinctId,
      preview: requestedPreview === "auto" ? "auto" : null,
    };
  } finally {
    try {
      await posthog.shutdown();
    } catch (error) {
      console.warn("PostHog shutdown failed after homepage evaluation.", error);
    }
  }
}

function createHomepageExperimentResponse(
  request: NextRequest,
  decision: HomepageExperimentDecision,
) {
  const { variant } = decision;
  const response = (() => {
    if (variant === "group-buy") {
      const url = request.nextUrl.clone();
      url.pathname = "/landing";
      return NextResponse.rewrite(url);
    }

    return NextResponse.next();
  })();

  if (decision.preview === "community" || decision.preview === "group-buy") {
    response.cookies.set({
      name: HOMEPAGE_EXPERIMENT_PREVIEW_COOKIE,
      value: decision.preview,
      httpOnly: true,
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
      maxAge: HOMEPAGE_EXPERIMENT_MAX_AGE,
      path: "/",
    });
  } else if (decision.preview === "auto") {
    response.cookies.delete(HOMEPAGE_EXPERIMENT_PREVIEW_COOKIE);
  }

  if (
    decision.distinctId &&
    !request.cookies.has(HOMEPAGE_POSTHOG_DISTINCT_ID_COOKIE)
  ) {
    response.cookies.set({
      name: HOMEPAGE_POSTHOG_DISTINCT_ID_COOKIE,
      value: decision.distinctId,
      httpOnly: false,
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
      maxAge: HOMEPAGE_VISITOR_MAX_AGE,
      path: "/",
    });
  }
  response.headers.set("Cache-Control", "private, no-store");

  return response;
}

export async function middleware(request: NextRequest) {
  const host = request.headers.get("host")?.replace(/^www\./, "");

  if (host === "soulaancoop.com") {
    const url = request.nextUrl.clone();

    if (url.pathname === "/") {
      url.pathname = "/c/soulaan";
      return NextResponse.rewrite(url);
    }
  }

  if (request.nextUrl.pathname === "/") {
    return createHomepageExperimentResponse(
      request,
      await getHomepageVariant(request),
    );
  }

  const response = NextResponse.next();

  // Check if the request is for a protected API route
  const isProtectedApiRoute = PROTECTED_API_ROUTES.some((route) =>
    request.nextUrl.pathname.startsWith(route),
  );

  // Skip middleware for non-protected routes
  if (!isProtectedApiRoute) {
    return response;
  }

  // Apply rate limiting
  const clientIp = request.headers.get("x-forwarded-for") || "unknown";
  const now = Date.now();

  // Get or create rate limit entry
  let rateLimit = rateLimitMap.get(clientIp);
  if (!rateLimit || rateLimit.resetAt < now) {
    rateLimit = { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
    rateLimitMap.set(clientIp, rateLimit);
  }

  // Increment count
  rateLimit.count++;

  // Check if rate limit exceeded
  if (rateLimit.count > RATE_LIMIT) {
    return new NextResponse(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(Math.ceil((rateLimit.resetAt - now) / 1000)),
      },
    });
  }

  // Check CSRF token for state-changing requests
  if (STATE_CHANGING_METHODS.includes(request.method)) {
    const isValidCsrf = validateCsrfToken(request);

    if (!isValidCsrf) {
      return new NextResponse(JSON.stringify({ error: "Invalid CSRF token" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // Get session
  const cookieStore = cookies();
  const session = await getIronSession<AuthSession>(
    cookieStore,
    sessionOptions,
  );

  // Check if authenticated
  if (!session.isLoggedIn || !session.address) {
    return new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Add user info to request headers for downstream handlers
  // The actual role and profile checks should be done in the API routes
  response.headers.set("X-User-Address", session.address);
  if (session.roles) {
    response.headers.set("X-User-Roles", JSON.stringify(session.roles));
  }

  return response;
}

// Configure the middleware to run for root domain rewrites and API routes
export const config = {
  matcher: ["/", "/api/:path*"],
};
