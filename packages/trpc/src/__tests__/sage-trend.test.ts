import { describe, expect, it, vi } from "vitest";

vi.mock("../services/sage-dispatch.js", () => ({
  enqueueSageActionExecute: vi.fn().mockResolvedValue(undefined),
}));

const { sageRouter } = await import("../routers/sage.js");
const { enqueueSageActionExecute } = await import("../services/sage-dispatch.js");
const { executeSageAction } = await import("../services/commons-action-tools.js");

function accountSessionDb(overrides: Record<string, unknown>): Record<string, any> {
  return {
    session: {
      findUnique: vi.fn().mockResolvedValue({ id: "session-1", userId: "leader-1", isRevoked: false, expiresAt: new Date(Date.now() + 60000) }),
      update: vi.fn().mockResolvedValue({}),
    },
    user: { findUnique: vi.fn().mockResolvedValue({ id: "leader-1", email: "leader@example.com", handle: "leader", name: "Leader", phone: null, roles: [], status: "ACTIVE" }) },
    ...overrides,
  };
}

function callerFor(db: Record<string, unknown>) {
  return sageRouter.createCaller({
    db, req: { headers: { "x-session-token": "test-token" } }, res: {}, coopId: undefined,
  } as never);
}

describe("Sage suggestion escalation (generic, any reviewType/action type)", () => {
  it("marks the review ESCALATED and audits it without touching the action's status", async () => {
    const review = { id: "review-1", userId: "leader-1", status: "PENDING", payloadHash: "hash-1", actionId: "action-1", reviewType: "APPROVE_SUGGESTION" };
    const action = { id: "action-1", payloadHash: "hash-1" };
    const db = accountSessionDb({
      commonsActionReview: { findUnique: vi.fn().mockResolvedValue(review), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      sageTask: { findMany: vi.fn().mockResolvedValue([]) },
      commonsAction: { findUnique: vi.fn().mockResolvedValue(action) },
      commonsActionAudit: { create: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    });
    const caller = callerFor(db);
    await expect(caller.respondToReview({ reviewId: "review-1", response: "ESCALATE" })).resolves.toEqual({ success: true });
    expect((db.commonsActionReview as { updateMany: ReturnType<typeof vi.fn> }).updateMany).toHaveBeenCalledWith({ where: { id: "review-1", status: "PENDING" }, data: { status: "ESCALATED", respondedAt: expect.any(Date) } });
    expect((db.commonsActionAudit as { create: ReturnType<typeof vi.fn> }).create).toHaveBeenCalledWith({
      data: { actionId: "action-1", actorId: "leader-1", eventType: "ESCALATED_TO_ADMIN", metadata: { reviewType: "APPROVE_SUGGESTION" } },
    });
  });

  it("dispatches execution once a SUGGEST_ACTION suggestion is approved", async () => {
    const review = { id: "review-2", userId: "leader-1", status: "PENDING", payloadHash: "hash-2", actionId: "action-2", reviewType: "APPROVE_SUGGESTION" };
    const action = { id: "action-2", payloadHash: "hash-2", revision: 1 };
    const db = accountSessionDb({
      commonsActionReview: { findUnique: vi.fn().mockResolvedValue(review), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      sageTask: { findMany: vi.fn().mockResolvedValue([]) },
      commonsAction: { findUnique: vi.fn().mockResolvedValue(action) },
      commonsActionAudit: { create: vi.fn().mockResolvedValue({}) },
    });
    const caller = callerFor(db);
    await expect(caller.respondToReview({ reviewId: "review-2", response: "APPROVE" })).resolves.toEqual({ success: true });
    expect(enqueueSageActionExecute).toHaveBeenCalledWith("action-2", 1);
  });

  it("refuses an answer when Sage closed the suggestion first, and doesn't run it", async () => {
    const review = { id: "review-4", userId: "leader-1", status: "PENDING", payloadHash: "hash-4", actionId: "action-4", reviewType: "APPROVE_SUGGESTION" };
    const db = accountSessionDb({
      // Read as pending, but the wake loop expired it before the answer was claimed.
      commonsActionReview: { findUnique: vi.fn().mockResolvedValue(review), updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      commonsAction: { findUnique: vi.fn().mockResolvedValue({ id: "action-4", payloadHash: "hash-4", revision: 1 }) },
      commonsActionAudit: { create: vi.fn().mockResolvedValue({}) },
    });
    await expect(callerFor(db).respondToReview({ reviewId: "review-4", response: "APPROVE" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(enqueueSageActionExecute).not.toHaveBeenCalledWith("action-4", 1);
    expect((db.commonsActionAudit as { create: ReturnType<typeof vi.fn> }).create).not.toHaveBeenCalled();
  });

  it("tells the member a closed suggestion can't be answered", async () => {
    const review = { id: "review-5", userId: "leader-1", status: "EXPIRED", payloadHash: "hash-5", actionId: "action-5", reviewType: "APPROVE_SUGGESTION" };
    const db = accountSessionDb({ commonsActionReview: { findUnique: vi.fn().mockResolvedValue(review) } });
    await expect(callerFor(db).respondToReview({ reviewId: "review-5", response: "APPROVE" }))
      .rejects.toMatchObject({ code: "CONFLICT", message: "Sage closed this suggestion, so it can't be answered anymore" });
  });
});

describe("SUGGEST_ACTION open tool vocabulary", () => {
  it("falls through to MISSING_TOOL when the model names a capability with no registered tool", async () => {
    const action = { id: "action-3", type: "SUGGEST_ACTION", status: "PENDING", payloadHash: "hash-3", payload: { capability: "compose_a_haiku" } };
    const db = {
      commonsAction: { findUnique: vi.fn().mockResolvedValue(action), update: vi.fn().mockResolvedValue({}) },
      commonsActionParticipant: { findMany: vi.fn().mockResolvedValue([]) },
      commonsActionReview: { findFirst: vi.fn().mockResolvedValue({ id: "review-3", payloadHash: "hash-3" }) },
      commonsActionAudit: { create: vi.fn().mockResolvedValue({}) },
    };
    vi.doMock("@repo/db", () => ({ db }));
    vi.resetModules();
    const { executeSageAction: freshExecuteSageAction } = await import("../services/commons-action-tools.js");
    await freshExecuteSageAction("action-3");
    expect(db.commonsAction.update).toHaveBeenCalledWith({ where: { id: "action-3" }, data: { status: "FAILED" } });
    expect(db.commonsActionAudit.create).toHaveBeenCalledWith({
      data: { actionId: "action-3", eventType: "MISSING_TOOL", metadata: { toolKey: "compose_a_haiku" } },
    });
    vi.doUnmock("@repo/db");
  });
});

describe("Suggestion context", () => {
  const action = {
    id: "action-c", coopId: "harbor", type: "SUGGEST_ACTION", status: "PENDING", summary: "Coordinate the ride",
    sourceType: "circle_trend", sourceId: "window-1", circleId: "circle-1", payload: { capability: "comment_on_post", body: "Share your pickup area", targetPostId: "circle:msg-1" },
    evidence: "Two members asked for rides.", sourceTextSnapshot: null, payloadHash: "h",
  };
  function detailDb(membership: unknown) {
    return accountSessionDb({
      commonsAction: { findUnique: vi.fn().mockResolvedValue(action) },
      commonsActionParticipant: { findUnique: vi.fn().mockResolvedValue({ role: "SUBJECT" }) },
      commonsActionReview: { findMany: vi.fn().mockResolvedValue([]) },
      commonsActionAudit: { findMany: vi.fn().mockResolvedValue([]) },
      groupMember: { findUnique: vi.fn().mockResolvedValue(membership) },
      circleAgentWindow: { findUnique: vi.fn().mockResolvedValue({ groupId: "circle-1", openedAt: new Date("2026-10-01T10:00:00Z"), closedAt: new Date("2026-10-01T11:00:00Z"), lastMessageAt: new Date("2026-10-01T11:00:00Z") }) },
      commonsPost: {
        findFirst: vi.fn().mockResolvedValue({ id: "circle:msg-1", title: "I need a ride", content: "I need a ride Saturday", createdAt: new Date("2026-10-01T10:30:00Z"), author: { name: "Maya", handle: "maya" } }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      commonsComment: { findMany: vi.fn().mockResolvedValue([]) },
      groupComment: { findMany: vi.fn().mockResolvedValue([
        { content: "I need a ride Saturday", createdAt: new Date("2026-10-01T10:30:00Z"), author: { name: "Maya", handle: "maya" } },
        { content: "Anyone near the market?", createdAt: new Date("2026-10-01T10:20:00Z"), author: { name: null, handle: "sam" } },
      ]) },
    });
  }

  it("shows the circle, the post Sage replies to, and the conversation in order to a circle member", async () => {
    const db = detailDb({ group: { id: "circle-1", name: "Market riders", coopId: "harbor" } });
    const detail = await callerFor(db).getDetail({ actionId: "action-c" });
    expect(detail.suggestion).toMatchObject({ reason: "Two members asked for rides.", proposedText: "Share your pickup area" });
    expect(detail.context).toMatchObject({
      circle: { id: "circle-1", name: "Market riders" },
      targetPost: { id: "circle:msg-1", author: "Maya", content: "I need a ride Saturday" },
      conversation: [
        { author: "@sam", content: "Anyone near the market?" },
        { author: "Maya", content: "I need a ride Saturday" },
      ],
    });
    // Mirrored chat posts are excluded from the post list so messages aren't shown twice.
    expect(db.commonsPost.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ NOT: { id: { startsWith: "circle:" } } }),
    }));
  });

  it("hides the conversation from someone who is no longer in the circle", async () => {
    const db = detailDb(null);
    const detail = await callerFor(db).getDetail({ actionId: "action-c" });
    expect(detail.context).toBeNull();
    expect(db.groupComment.findMany).not.toHaveBeenCalled();
  });
});
