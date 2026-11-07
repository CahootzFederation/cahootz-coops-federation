import { describe, expect, it, vi } from "vitest";

import { payloadHash } from "../services/sage-payload-hash.js";

const closeSuggestion = vi.hoisted(() => vi.fn().mockResolvedValue(true));
vi.mock("../services/sage-suggestion-follow-up.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/sage-suggestion-follow-up.js")>()),
  closeSuggestion,
}));

const { sageRouter } = await import("../routers/sage.js");

function accountSessionDb(overrides: Record<string, unknown>): Record<string, any> {
  return {
    session: {
      findUnique: vi.fn().mockResolvedValue({ id: "session-1", userId: "maya", isRevoked: false, expiresAt: new Date(Date.now() + 60000) }),
      update: vi.fn().mockResolvedValue({}),
    },
    user: { findUnique: vi.fn().mockResolvedValue({ id: "maya", email: "maya@example.com", handle: "maya", name: "Maya", phone: null, roles: [], status: "ACTIVE" }) },
    ...overrides,
  };
}

function callerFor(db: Record<string, unknown>) {
  return sageRouter.createCaller({
    db, req: { headers: { "x-session-token": "test-token" } }, res: {}, coopId: undefined,
  } as never);
}

describe("Sage suggestion payload hashing", () => {
  it("is deterministic and content-sensitive", () => {
    const a = payloadHash({ capability: "create_event", title: "Cleanup" });
    const b = payloadHash({ capability: "create_event", title: "Cleanup" });
    const c = payloadHash({ capability: "create_event", title: "Potluck" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(payloadHash(null)).toBe(payloadHash(undefined));
  });
});

describe("Sage suggestion review flow", () => {
  it("declines a review and dismisses the suggestion without disclosing anything further", async () => {
    const review = { id: "review-1", userId: "maya", status: "PENDING", payloadHash: "hash-1", actionId: "action-1", reviewType: "ACCEPT_INTRODUCTION" };
    const action = { id: "action-1", type: "CONNECT_MEMBERS", payloadHash: "hash-1" };
    const db = accountSessionDb({
      commonsActionReview: { findUnique: vi.fn().mockResolvedValue(review), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      commonsAction: { findUnique: vi.fn().mockResolvedValue(action), update: vi.fn().mockResolvedValue({}) },
      sageTask: { findMany: vi.fn().mockResolvedValue([]) },
      commonsActionAudit: { create: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    });
    await expect(callerFor(db).respondToReview({ reviewId: "review-1", response: "DECLINE" })).resolves.toEqual({ success: true });
    expect((db.commonsAction as { update: ReturnType<typeof vi.fn> }).update).toHaveBeenCalledWith({ where: { id: "action-1" }, data: { status: "DISMISSED" } });
  });

  it("rejects a response to a review whose revision has moved on", async () => {
    const review = { id: "review-1", userId: "maya", status: "PENDING", payloadHash: "stale-hash", actionId: "action-1", reviewType: "ACCEPT_INTRODUCTION" };
    const action = { id: "action-1", type: "CONNECT_MEMBERS", payloadHash: "current-hash" };
    const db = accountSessionDb({
      commonsActionReview: { findUnique: vi.fn().mockResolvedValue(review), update: vi.fn().mockResolvedValue({}) },
      commonsAction: { findUnique: vi.fn().mockResolvedValue(action) },
    });
    await expect(callerFor(db).respondToReview({ reviewId: "review-1", response: "APPROVE" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((db.commonsActionReview as { update: ReturnType<typeof vi.fn> }).update).toHaveBeenCalledWith({ where: { id: "review-1" }, data: { status: "SUPERSEDED" } });
  });

  it("closes a ride match still waiting from before Sage stopped suggesting them, instead of recording the answer", async () => {
    const review = { id: "review-9", userId: "maya", status: "PENDING", payloadHash: "hash-9", actionId: "action-9", reviewType: "PROVIDE_CONTEXT" };
    const action = { id: "action-9", type: "RIDE_MATCH_PROPOSAL", payloadHash: "hash-9", revision: 1 };
    const db = accountSessionDb({
      commonsActionReview: { findUnique: vi.fn().mockResolvedValue(review), updateMany: vi.fn() },
      commonsAction: { findUnique: vi.fn().mockResolvedValue(action) },
    });
    await expect(callerFor(db).respondToReview({ reviewId: "review-9", response: "APPROVE" }))
      .rejects.toMatchObject({ code: "CONFLICT", message: "Sage closed this suggestion, so it can't be answered anymore" });
    expect(closeSuggestion).toHaveBeenCalledWith("action-9", "Sage no longer suggests ride matches", "NO_LONGER_APPLIES");
    expect((db.commonsActionReview as { updateMany: ReturnType<typeof vi.fn> }).updateMany).not.toHaveBeenCalled();
  });
});
