import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  group: { findUnique: vi.fn() },
  adminRole: { findMany: vi.fn() },
  userCoopMembership: { findMany: vi.fn() },
  sageAlert: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
  sageDecisionTrail: { create: vi.fn().mockResolvedValue({ id: "trail" }) },
}));
const push = vi.hoisted(() => vi.fn().mockResolvedValue({ id: "n" }));
vi.mock("@repo/db", () => ({ db }));
vi.mock("../services/push-notification-service.js", () => ({ createNotificationAndPush: push }));

const { resolveResponsible, routeSageAlert, rerouteSageAlert, expireSageAlerts, ALERTS_PER_RECIPIENT_PER_DAY } = await import("../services/sage-responsibility.js");

const NOW = new Date("2026-10-05T12:00:00.000Z");
const alertInput = {
  coopId: "harbor", circleId: "circle-1", category: "CIRCLE_LEADER" as const, subjectType: "commons_post", subjectId: "post-1", postId: "post-1",
  severity: "MEDIUM" as const, title: "Sage flagged something", body: "A member asked for help with a dispute.",
  evidence: { source: "Post text", quote: "members share tools", why: "It needs a person's judgment.", recommendation: "Take a look." },
};

beforeEach(() => {
  vi.clearAllMocks();
  db.group.findUnique.mockResolvedValue({ coopId: "harbor", leaderId: "leader-1" });
  db.adminRole.findMany.mockResolvedValue([]);
  db.userCoopMembership.findMany.mockImplementation(({ where }: { where: { userId: { in: string[] } } }) => Promise.resolve(where.userId.in.map((userId) => ({ userId }))));
  db.sageAlert.findMany.mockResolvedValue([]);
  db.sageAlert.findFirst.mockResolvedValue(null);
  db.sageAlert.count.mockResolvedValue(0);
  let n = 0;
  db.sageAlert.create.mockImplementation(() => Promise.resolve({ id: `alert-${++n}` }));
});

describe("the responsibility directory", () => {
  it("resolves a circle's leader, and falls back to an admin when the circle has none", async () => {
    expect(await resolveResponsible({ coopId: "harbor", category: "CIRCLE_LEADER", circleId: "circle-1", now: NOW })).toEqual({ category: "CIRCLE_LEADER", userIds: ["leader-1"], skipped: [] });
    db.group.findUnique.mockResolvedValueOnce({ coopId: "elsewhere", leaderId: "leader-x" });
    db.adminRole.findMany.mockResolvedValueOnce([{ userId: "admin-1", role: "SUPER_ADMIN" }]);
    expect(await resolveResponsible({ coopId: "harbor", category: "CIRCLE_LEADER", circleId: "circle-1", now: NOW }))
      .toEqual({ category: "COMMONS_ADMIN", userIds: ["admin-1"], skipped: ["CIRCLE_LEADER"] });
  });

  it("prefers the specific role over a super admin, and skips revoked or inactive people", async () => {
    db.adminRole.findMany.mockResolvedValueOnce([{ userId: "super", role: "SUPER_ADMIN" }, { userId: "treasurer", role: "TREASURY_ADMIN" }]);
    expect((await resolveResponsible({ coopId: "harbor", category: "TREASURY", now: NOW })).userIds).toEqual(["treasurer", "super"]);
    expect(db.adminRole.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { coopId: "harbor", role: { in: ["TREASURY_ADMIN", "SUPER_ADMIN"] }, revokedAt: null } }));
    db.userCoopMembership.findMany.mockResolvedValue([]);
    expect(await resolveResponsible({ coopId: "harbor", category: "CIRCLE_LEADER", circleId: "circle-1", now: NOW })).toEqual({ category: "PLATFORM_ADMIN", userIds: [], skipped: ["CIRCLE_LEADER", "COMMONS_ADMIN"] });
  });

  it("skips someone who recently said alerts like this aren't for them", async () => {
    db.sageAlert.findMany.mockResolvedValueOnce([{ recipientUserId: "leader-1" }]);
    db.adminRole.findMany.mockResolvedValueOnce([{ userId: "admin-1", role: "SUPER_ADMIN" }]);
    expect((await resolveResponsible({ coopId: "harbor", category: "CIRCLE_LEADER", circleId: "circle-1", now: NOW })).userIds).toEqual(["admin-1"]);
  });
});

describe("routing an alert", () => {
  it("delivers it with its evidence and why the person was chosen", async () => {
    const result = await routeSageAlert(alertInput, NOW);
    expect(result).toEqual({ status: "ROUTED", category: "CIRCLE_LEADER", alerts: [{ id: "alert-1", recipientUserId: "leader-1", delivered: true }] });
    expect(db.sageAlert.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      recipientUserId: "leader-1", status: "SENT", expiresAt: new Date(NOW.getTime() + 7 * 86_400_000),
      evidence: expect.objectContaining({ why: "It needs a person's judgment. You're getting this as the circle's leader." }),
    }), select: { id: true } });
    expect(push).toHaveBeenCalledWith(db, expect.objectContaining({ userId: "leader-1", type: "SAGE_ALERT", data: { alertId: "alert-1", coopId: "harbor", postId: "post-1" } }));
    expect(db.sageDecisionTrail.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ agent: "guardian", visibility: "ADMINS" }) }));
  });

  it("doesn't raise the same thing twice", async () => {
    db.sageAlert.findFirst.mockResolvedValueOnce({ id: "open-alert" });
    expect(await routeSageAlert(alertInput, NOW)).toEqual({ status: "DEDUPED", alertId: "open-alert" });
    expect(db.sageAlert.create).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("holds the alert without a push once the person has had their daily share", async () => {
    db.sageAlert.count.mockResolvedValueOnce(ALERTS_PER_RECIPIENT_PER_DAY);
    const result = await routeSageAlert(alertInput, NOW);
    expect(result).toMatchObject({ alerts: [{ delivered: false }] });
    expect(db.sageAlert.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: "QUEUED" }), select: { id: true } });
    expect(push).not.toHaveBeenCalled();
  });

  it("goes to the platform admin queue when nobody in the Commons is responsible", async () => {
    db.group.findUnique.mockResolvedValueOnce(null);
    const result = await routeSageAlert(alertInput, NOW);
    expect(result).toEqual({ status: "ROUTED", category: "PLATFORM_ADMIN", alerts: [{ id: "alert-1", recipientUserId: null, delivered: false }] });
  });
});

describe("Not for me", () => {
  it("passes the alert up the chain, excluding everyone who already had it", async () => {
    db.sageAlert.findUnique.mockResolvedValueOnce({
      id: "alert-9", coopId: "harbor", circleId: "circle-1", category: "CIRCLE_LEADER", recipientUserId: "leader-1", status: "SENT",
      subjectType: "commons_post", subjectId: "post-1", postId: "post-1", severity: "MEDIUM", title: "t", body: "b",
      evidence: { source: "s", why: "It needs a person's judgment. You're getting this as the circle's leader.", recommendation: "r" },
      dueAt: null, sourceActionId: null,
    });
    db.sageAlert.findMany.mockResolvedValueOnce([{ recipientUserId: "leader-1" }]).mockResolvedValue([]);
    db.adminRole.findMany.mockResolvedValueOnce([{ userId: "admin-1", role: "SUPER_ADMIN" }]);
    const result = await rerouteSageAlert("alert-9", "leader-1", "I'm not involved", NOW);
    expect(db.sageAlert.update).toHaveBeenCalledWith({ where: { id: "alert-9" }, data: { status: "REROUTED", feedback: "I'm not involved" } });
    expect(result).toMatchObject({ status: "ROUTED", category: "COMMONS_ADMIN", alerts: [{ recipientUserId: "admin-1" }] });
    expect(db.sageAlert.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      reroutedFromId: "alert-9", evidence: expect.objectContaining({ why: "It needs a person's judgment. You're getting this as a Commons admin." }),
    }), select: { id: true } });
  });

  it("only the recipient can pass it on", async () => {
    db.sageAlert.findUnique.mockResolvedValueOnce({ id: "alert-9", recipientUserId: "leader-1", status: "SENT" });
    expect(await rerouteSageAlert("alert-9", "someone-else", null, NOW)).toBeNull();
    expect(db.sageAlert.update).not.toHaveBeenCalled();
  });

  it("expires old alerts", async () => {
    db.sageAlert.updateMany.mockResolvedValueOnce({ count: 2 });
    expect(await expireSageAlerts("harbor", NOW)).toBe(2);
    expect(db.sageAlert.updateMany).toHaveBeenCalledWith({ where: { coopId: "harbor", status: { in: ["SENT", "QUEUED"] }, expiresAt: { lte: NOW } }, data: { status: "EXPIRED" } });
  });
});
