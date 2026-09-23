import { describe, expect, it, vi } from "vitest";

import { payloadHash } from "../services/sage-ride-match-agent.js";

vi.mock("@repo/db", () => ({ db: { groupComment: { findMany: vi.fn() } } }));

const { findRideMatchCandidate } = await import("../services/sage-ride-matcher.js");
const { sageRouter } = await import("../routers/sage.js");
const { db: mockedDb } = await import("@repo/db");

describe("Sage ride-match payload hashing", () => {
  it("is deterministic and content-sensitive", () => {
    const a = payloadHash({ area: "Downtown", timeWindow: "Saturday morning" });
    const b = payloadHash({ area: "Downtown", timeWindow: "Saturday morning" });
    const c = payloadHash({ area: "Uptown", timeWindow: "Saturday morning" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(payloadHash(null)).toBe(payloadHash(undefined));
  });
});

describe("Sage ride-match deterministic matcher", () => {
  it("finds a member other than the subject offering a ride", async () => {
    (mockedDb.groupComment.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { authorId: "jordan", content: "Just talking about the weather." },
      { authorId: "jordan", content: "I can give a ride Saturday if anyone needs one." },
    ]);
    const match = await findRideMatchCandidate({ circleId: "circle-1", sourceAuthorId: "maya" });
    expect(match).toEqual({ candidateUserId: "jordan" });
  });

  it("returns null with no circle or no offer", async () => {
    (mockedDb.groupComment.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { authorId: "jordan", content: "Just talking about the weather." },
    ]);
    expect(await findRideMatchCandidate({ circleId: null, sourceAuthorId: "maya" })).toBeNull();
    expect(await findRideMatchCandidate({ circleId: "circle-1", sourceAuthorId: "maya" })).toBeNull();
  });
});

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

describe("Sage suggestion review flow", () => {
  it("declines a review and dismisses the suggestion without disclosing anything further", async () => {
    const review = { id: "review-1", userId: "maya", status: "PENDING", payloadHash: "hash-1", actionId: "action-1", reviewType: "PROVIDE_CONTEXT" };
    const action = { id: "action-1", payloadHash: "hash-1" };
    const db = accountSessionDb({
      commonsActionReview: { findUnique: vi.fn().mockResolvedValue(review), update: vi.fn().mockResolvedValue({}) },
      commonsAction: { findUnique: vi.fn().mockResolvedValue(action), update: vi.fn().mockResolvedValue({}) },
      commonsActionAudit: { create: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    });
    const caller = callerFor(db);
    await expect(caller.respondToReview({ reviewId: "review-1", response: "DECLINE" })).resolves.toEqual({ success: true });
    expect((db.commonsAction as { update: ReturnType<typeof vi.fn> }).update).toHaveBeenCalledWith({ where: { id: "action-1" }, data: { status: "DISMISSED" } });
  });

  it("rejects a response to a review whose revision has moved on", async () => {
    const review = { id: "review-1", userId: "maya", status: "PENDING", payloadHash: "stale-hash", actionId: "action-1", reviewType: "PROVIDE_CONTEXT" };
    const action = { id: "action-1", payloadHash: "current-hash" };
    const db = accountSessionDb({
      commonsActionReview: { findUnique: vi.fn().mockResolvedValue(review), update: vi.fn().mockResolvedValue({}) },
      commonsAction: { findUnique: vi.fn().mockResolvedValue(action) },
    });
    const caller = callerFor(db);
    await expect(caller.respondToReview({ reviewId: "review-1", response: "APPROVE" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((db.commonsActionReview as { update: ReturnType<typeof vi.fn> }).update).toHaveBeenCalledWith({ where: { id: "review-1" }, data: { status: "SUPERSEDED" } });
  });
});
