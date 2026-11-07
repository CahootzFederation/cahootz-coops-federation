import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  user: { findFirst: vi.fn(), findMany: vi.fn() },
  groupComment: { findMany: vi.fn(), groupBy: vi.fn() },
  auditLog: { create: vi.fn().mockResolvedValue({}) },
}));
const directCircles = vi.hoisted(() => ({
  openDirectCircle: vi.fn(),
  sendDirectCircleMessage: vi.fn(),
  directKeyFor: vi.fn(),
}));

vi.mock("@repo/db", () => ({ db }));
vi.mock("../lib/bot.js", () => ({ ensureSageBotUser: vi.fn().mockResolvedValue({ id: "sage" }) }));
vi.mock("../services/direct-circles.js", () => directCircles);

import { listSageOutreachHistory, searchOutreachMembers, sendSageOutreachNow } from "../services/sage-weekly-outreach.js";

describe("Sage outreach admin controls", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends a manual check-in to the chosen member with its own key, audited as the admin", async () => {
    const now = new Date("2026-10-12T15:00:00Z");
    db.user.findFirst.mockResolvedValue({ id: "admin-1", name: "Deon R", email: "d@example.com" });
    (db as any).userCoopMembership = { findMany: vi.fn().mockResolvedValue([]) };
    (db as any).commonsPost = { findMany: vi.fn().mockResolvedValue([]) };
    (db as any).commonsComment = { findMany: vi.fn().mockResolvedValue([]) };
    directCircles.openDirectCircle.mockResolvedValue({ group: { id: "g1" } });

    const result = await sendSageOutreachNow("admin-1", { now, generateWithModel: false, sentBy: "admin-user" });

    expect(result.groupId).toBe("g1");
    expect(result.content).toContain("Hi Deon");
    expect(directCircles.sendDirectCircleMessage).toHaveBeenCalledWith(db, expect.objectContaining({
      systemKey: `sage-weekly:admin-1:manual-${now.getTime()}`,
    }));
    expect(db.auditLog.create.mock.calls[0]![0].data).toMatchObject({
      actorId: "admin-user", action: "SAGE_OUTREACH_SENT_MANUALLY", resource: "User", resourceId: "admin-1",
    });
  });

  it("searches only active members by name or email, and ignores one-letter queries", async () => {
    db.user.findMany.mockResolvedValue([{ id: "u1", name: "Release Click", email: "releaseclick1@test.cahootz.local" }]);
    expect(await searchOutreachMembers("r")).toEqual([]);
    expect(db.user.findMany).not.toHaveBeenCalled();

    await searchOutreachMembers(" releaseclick ");
    const where = db.user.findMany.mock.calls[0]![0].where;
    expect(where).toMatchObject({ deletedAt: null, isBot: false, status: "ACTIVE", memberships: { some: { status: "ACTIVE" } } });
    expect(where.OR).toEqual([
      { name: { contains: "releaseclick", mode: "insensitive" } },
      { email: { contains: "releaseclick", mode: "insensitive" } },
    ]);
  });

  it("refuses accounts that are not active Commons members", async () => {
    db.user.findFirst.mockResolvedValue(null);
    await expect(sendSageOutreachNow("nobody")).rejects.toThrow(/active members/);
    expect(directCircles.sendDirectCircleMessage).not.toHaveBeenCalled();
  });

  it("reports the latest check-in per member and whether they replied after it", async () => {
    db.groupComment.findMany.mockResolvedValue([
      { groupId: "g1", content: "newest", createdAt: new Date("2026-10-10"), systemKey: "sage-weekly:u1:manual-1" },
      { groupId: "g2", content: "u2 only", createdAt: new Date("2026-10-08"), systemKey: "sage-weekly:u2:2026-W41" },
      { groupId: "g1", content: "older", createdAt: new Date("2026-10-01"), systemKey: "sage-weekly:u1:2026-W40" },
    ]);
    db.user.findMany.mockResolvedValue([
      { id: "u1", name: "One", email: "one@example.com" },
      { id: "u2", name: null, email: "two@example.com" },
    ]);
    db.groupComment.groupBy.mockResolvedValue([
      { groupId: "g1", authorId: "u1", _max: { createdAt: new Date("2026-10-11") } },
      { groupId: "g2", authorId: "u2", _max: { createdAt: new Date("2026-10-02") } },
    ]);

    const rows = await listSageOutreachHistory();

    expect(rows.map((row) => row.userId)).toEqual(["u1", "u2"]);
    expect(rows[0]).toMatchObject({ lastTrigger: "manual", lastMessage: "newest", outreachCount: 2, repliedAt: "2026-10-11T00:00:00.000Z" });
    expect(rows[1]).toMatchObject({ lastTrigger: "scheduled", outreachCount: 1, repliedAt: null });
  });
});
