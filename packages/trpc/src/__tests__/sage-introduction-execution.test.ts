import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  commonsAction: { findUnique: vi.fn(), update: vi.fn() },
  commonsActionParticipant: { findMany: vi.fn() },
  commonsActionReview: { findFirst: vi.fn(), count: vi.fn() },
  commonsActionAudit: { create: vi.fn() },
  group: { findUnique: vi.fn().mockResolvedValue(null) },
  $transaction: vi.fn(),
}));
vi.mock("@repo/db", () => ({ db }));
vi.mock("../services/push-notification-service.js", () => ({ createNotificationAndPush: vi.fn().mockResolvedValue({}) }));

const { executeSageAction } = await import("../services/commons-action-tools.js");

beforeEach(() => {
  vi.clearAllMocks();
  db.commonsAction.findUnique.mockResolvedValue({
    id: "intro-1", coopId: "harbor", type: "CONNECT_MEMBERS", status: "PENDING", payloadHash: "h", summary: "Introduction: bookkeeping",
    payload: { circleName: "Introduction", needSummary: "bookkeeping" },
  });
  db.commonsActionParticipant.findMany.mockResolvedValue([{ userId: "u1", role: "SUBJECT" }, { userId: "u2", role: "HELPER" }]);
  db.commonsActionReview.findFirst.mockResolvedValue({ id: "r1", payloadHash: "h" });
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({
    group: { create: vi.fn().mockResolvedValue({ id: "circle-new" }) },
    groupMember: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  }));
});

describe("introduction execution", () => {
  it("doesn't create the circle until both people have said yes", async () => {
    db.commonsActionReview.count.mockResolvedValueOnce(1);
    await executeSageAction("intro-1");
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.commonsAction.update).not.toHaveBeenCalled();
  });

  it("creates a private Introduction circle for the two of them once both accept", async () => {
    db.commonsActionReview.count.mockResolvedValueOnce(2);
    await executeSageAction("intro-1");
    expect(db.commonsActionReview.count).toHaveBeenCalledWith({ where: { actionId: "intro-1", reviewType: "ACCEPT_INTRODUCTION", status: "APPROVED", payloadHash: "h" } });
    const tx = await db.$transaction.mock.results[0]!.value;
    expect(tx).toEqual({ id: "circle-new" });
    expect(db.commonsAction.update).toHaveBeenCalledWith({ where: { id: "intro-1" }, data: expect.objectContaining({ status: "APPROVED" }) });
  });
});
