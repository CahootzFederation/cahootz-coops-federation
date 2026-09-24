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
      commonsActionReview: { findUnique: vi.fn().mockResolvedValue(review), update: vi.fn().mockResolvedValue({}) },
      commonsAction: { findUnique: vi.fn().mockResolvedValue(action) },
      commonsActionAudit: { create: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    });
    const caller = callerFor(db);
    await expect(caller.respondToReview({ reviewId: "review-1", response: "ESCALATE" })).resolves.toEqual({ success: true });
    expect((db.commonsActionReview as { update: ReturnType<typeof vi.fn> }).update).toHaveBeenCalledWith({ where: { id: "review-1" }, data: { status: "ESCALATED", respondedAt: expect.any(Date) } });
    expect((db.commonsActionAudit as { create: ReturnType<typeof vi.fn> }).create).toHaveBeenCalledWith({
      data: { actionId: "action-1", actorId: "leader-1", eventType: "ESCALATED_TO_ADMIN", metadata: { reviewType: "APPROVE_SUGGESTION" } },
    });
  });

  it("dispatches execution once a SUGGEST_ACTION suggestion is approved", async () => {
    const review = { id: "review-2", userId: "leader-1", status: "PENDING", payloadHash: "hash-2", actionId: "action-2", reviewType: "APPROVE_SUGGESTION" };
    const action = { id: "action-2", payloadHash: "hash-2", revision: 1 };
    const db = accountSessionDb({
      commonsActionReview: { findUnique: vi.fn().mockResolvedValue(review), update: vi.fn().mockResolvedValue({}) },
      commonsAction: { findUnique: vi.fn().mockResolvedValue(action) },
      commonsActionAudit: { create: vi.fn().mockResolvedValue({}) },
    });
    const caller = callerFor(db);
    await expect(caller.respondToReview({ reviewId: "review-2", response: "APPROVE" })).resolves.toEqual({ success: true });
    expect(enqueueSageActionExecute).toHaveBeenCalledWith("action-2", 1);
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
