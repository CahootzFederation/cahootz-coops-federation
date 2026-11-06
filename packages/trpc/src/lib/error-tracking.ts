/**
 * Server-side exception capture for PostHog error tracking.
 *
 * Used by the tRPC `onError` hook, the API's Express error handler and
 * process-level handlers, and the Trigger.dev global failure hook.
 *
 * - Inert unless POSTHOG_KEY is set (local dev, CI and tests leave it unset).
 * - Only real server faults are sent: tRPC errors that map to HTTP 5xx.
 *   Expected 4xx-style errors (UNAUTHORIZED, NOT_FOUND, BAD_REQUEST, ...)
 *   are part of normal use and are dropped.
 * - Never sends request input, headers or bodies. Every `$exception` event goes
 *   through `scrubExceptionEvent` (shared with the mobile app) before it leaves.
 * - Ties an error to a person only by internal user id, the same distinct id
 *   the mobile analytics uses. Without one, the event is anonymous.
 */
import { TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import { scrubExceptionEvent } from "@repo/validators/error-tracking";
import { PostHog } from "posthog-node";

const DEFAULT_HOST = "https://us.i.posthog.com";

type Properties = Record<string, string | number | boolean | null | undefined>;

export type ErrorTrackingConfig = { apiKey?: string; host?: string };

let client: PostHog | null = null;
let initialized = false;

function configFromEnv(): ErrorTrackingConfig {
  return { apiKey: process.env.POSTHOG_KEY, host: process.env.POSTHOG_HOST };
}

/** Lazily starts the PostHog client. Returns null when no key is configured. */
export function getErrorTrackingClient(config: ErrorTrackingConfig = configFromEnv()): PostHog | null {
  if (initialized) return client;
  initialized = true;

  const apiKey = config.apiKey?.trim();
  if (!apiKey) return null;

  try {
    client = new PostHog(apiKey, {
      host: config.host?.trim() || DEFAULT_HOST,
      // The server's IP says nothing about the person who hit the error.
      disableGeoip: true,
      before_send: scrubExceptionEvent,
      flushAt: 20,
      flushInterval: 5000,
    });
  } catch (error) {
    client = null;
    console.warn("[error-tracking] PostHog failed to start; error tracking disabled.", error);
  }
  return client;
}

/**
 * True for tRPC errors that are server faults (HTTP 5xx). Expected errors such
 * as UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST, CONFLICT and
 * TOO_MANY_REQUESTS are normal answers to a request and are not captured.
 */
export function shouldCaptureTrpcError(error: TRPCError): boolean {
  return getHTTPStatusCodeFromError(error) >= 500;
}

/**
 * tRPC wraps anything a procedure throws in an INTERNAL_SERVER_ERROR whose
 * `cause` is the original error. Report the original so the stack trace and
 * type point at the real fault.
 */
export function unwrapTrpcError(error: TRPCError): unknown {
  return error.code === "INTERNAL_SERVER_ERROR" && error.cause instanceof Error ? error.cause : error;
}

/** Captures an exception. Never throws, and does nothing when error tracking is off. */
export function captureServerException(
  error: unknown,
  options: { userId?: string | null; properties?: Properties } = {},
): void {
  const posthog = getErrorTrackingClient();
  if (!posthog) return;
  try {
    posthog.captureException(error, options.userId ?? undefined, {
      ...options.properties,
      ...(options.userId ? {} : { $process_person_profile: false }),
    });
  } catch (captureError) {
    console.warn("[error-tracking] capture failed", captureError);
  }
}

/** Like captureServerException, but waits for the event to be sent (for short-lived workers). */
export async function captureServerExceptionNow(
  error: unknown,
  options: { userId?: string | null; properties?: Properties } = {},
): Promise<void> {
  const posthog = getErrorTrackingClient();
  if (!posthog) return;
  try {
    await posthog.captureExceptionImmediate(error, options.userId ?? undefined, {
      ...options.properties,
      ...(options.userId ? {} : { $process_person_profile: false }),
    });
  } catch (captureError) {
    console.warn("[error-tracking] capture failed", captureError);
  }
}

/**
 * The tRPC `onError` handler body. Records which procedure failed and how,
 * never its input.
 */
export function reportTrpcError({
  error,
  path,
  type,
  userId,
}: {
  error: TRPCError;
  path: string | undefined;
  type: string;
  userId?: string | null;
}): void {
  if (!shouldCaptureTrpcError(error)) return;
  captureServerException(unwrapTrpcError(error), {
    userId,
    properties: {
      source: "trpc",
      trpc_path: path ?? null,
      trpc_type: type,
      trpc_code: error.code,
    },
  });
}

/** Sends anything still queued. Call before the process exits. */
export async function flushErrorTracking(timeoutMs = 3000): Promise<void> {
  if (!client) return;
  try {
    await client.shutdown(timeoutMs);
  } catch {
    // Shutting down anyway.
  }
}

/** Test-only: forget the client so each test starts clean. */
export function __resetErrorTrackingForTests(): void {
  client = null;
  initialized = false;
}
