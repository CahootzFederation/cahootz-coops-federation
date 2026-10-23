import { TRPCError } from "@trpc/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const posthogMocks = vi.hoisted(() => ({
  instances: [] as Array<{ apiKey: string; options: Record<string, any> }>,
  captureException: vi.fn(),
  captureExceptionImmediate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("posthog-node", () => {
  class PostHog {
    captureException = posthogMocks.captureException;
    captureExceptionImmediate = posthogMocks.captureExceptionImmediate;
    shutdown = vi.fn().mockResolvedValue(undefined);
    constructor(apiKey: string, options: Record<string, any>) {
      posthogMocks.instances.push({ apiKey, options });
    }
  }
  return { PostHog };
});

import {
  __resetErrorTrackingForTests,
  captureServerExceptionNow,
  getErrorTrackingClient,
  reportTrpcError,
  shouldCaptureTrpcError,
  unwrapTrpcError,
} from "../lib/error-tracking.js";

describe("shouldCaptureTrpcError", () => {
  it.each([
    "UNAUTHORIZED",
    "FORBIDDEN",
    "NOT_FOUND",
    "BAD_REQUEST",
    "CONFLICT",
    "PRECONDITION_FAILED",
    "TOO_MANY_REQUESTS",
    "PAYLOAD_TOO_LARGE",
    "UNPROCESSABLE_CONTENT",
    "PARSE_ERROR",
    "CLIENT_CLOSED_REQUEST",
  ] as const)("drops expected %s errors", (code) => {
    expect(shouldCaptureTrpcError(new TRPCError({ code }))).toBe(false);
  });

  it.each(["INTERNAL_SERVER_ERROR", "NOT_IMPLEMENTED", "BAD_GATEWAY", "SERVICE_UNAVAILABLE", "GATEWAY_TIMEOUT"] as const)(
    "captures %s server faults",
    (code) => {
      expect(shouldCaptureTrpcError(new TRPCError({ code }))).toBe(true);
    },
  );
});

describe("unwrapTrpcError", () => {
  it("reports the original error a procedure threw", () => {
    const original = new TypeError("Cannot read properties of undefined");
    const wrapped = new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause: original });
    expect(unwrapTrpcError(wrapped)).toBe(original);
  });

  it("keeps a deliberate TRPCError as is", () => {
    const error = new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Stripe is down" });
    expect(unwrapTrpcError(error)).toBe(error);
  });
});

describe("server error capture", () => {
  beforeEach(() => {
    __resetErrorTrackingForTests();
    posthogMocks.instances.length = 0;
    posthogMocks.captureException.mockClear();
    posthogMocks.captureExceptionImmediate.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does nothing without a PostHog key", () => {
    vi.stubEnv("POSTHOG_KEY", "");
    reportTrpcError({ error: new TRPCError({ code: "INTERNAL_SERVER_ERROR" }), path: "x.y", type: "query" });
    expect(posthogMocks.instances).toHaveLength(0);
    expect(posthogMocks.captureException).not.toHaveBeenCalled();
  });

  it("starts the client with the shared scrubber and no GeoIP", () => {
    const client = getErrorTrackingClient({ apiKey: "phc_test" });
    expect(client).not.toBeNull();
    const [{ options }] = posthogMocks.instances;
    expect(options.disableGeoip).toBe(true);
    const scrubbed = options.before_send({
      event: "$exception",
      properties: { $exception_list: [{ type: "Error", value: "token=abc" }] },
    });
    expect(scrubbed.properties.$exception_list[0].value).toBe("token=[redacted]");
  });

  it("sends 5xx errors with the procedure path and user id, never the input", () => {
    vi.stubEnv("POSTHOG_KEY", "phc_test");
    const cause = new Error("db connection reset");
    reportTrpcError({
      error: new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause }),
      path: "dm.send",
      type: "mutation",
      userId: "user_123",
    });

    expect(posthogMocks.captureException).toHaveBeenCalledWith(cause, "user_123", {
      source: "trpc",
      trpc_path: "dm.send",
      trpc_type: "mutation",
      trpc_code: "INTERNAL_SERVER_ERROR",
    });
  });

  it("skips expected 4xx errors", () => {
    vi.stubEnv("POSTHOG_KEY", "phc_test");
    reportTrpcError({ error: new TRPCError({ code: "NOT_FOUND" }), path: "post.get", type: "query", userId: "u" });
    reportTrpcError({ error: new TRPCError({ code: "UNAUTHORIZED" }), path: "me", type: "query" });
    expect(posthogMocks.captureException).not.toHaveBeenCalled();
  });

  it("sends anonymous errors without creating a person", () => {
    vi.stubEnv("POSTHOG_KEY", "phc_test");
    reportTrpcError({ error: new TRPCError({ code: "INTERNAL_SERVER_ERROR" }), path: "public.x", type: "query" });
    expect(posthogMocks.captureException).toHaveBeenCalledWith(
      expect.any(TRPCError),
      undefined,
      expect.objectContaining({ $process_person_profile: false }),
    );
  });

  it("awaits delivery for short-lived workers", async () => {
    vi.stubEnv("POSTHOG_KEY", "phc_test");
    await captureServerExceptionNow(new Error("task failed"), { properties: { source: "trigger" } });
    expect(posthogMocks.captureExceptionImmediate).toHaveBeenCalledWith(
      expect.any(Error),
      undefined,
      { source: "trigger", $process_person_profile: false },
    );
  });
});
