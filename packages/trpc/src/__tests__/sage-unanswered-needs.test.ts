import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  auditLog: { count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn().mockResolvedValue({}) },
  commonsPost: { findMany: vi.fn() },
  commonsComment: { findFirst: vi.fn() },
  coopConfig: { findFirst: vi.fn() },
}));
const proactive = vi.hoisted(() => ({ sendProactiveSageMessage: vi.fn() }));
const specialists = vi.hoisted(() => ({ findMembersForNeed: vi.fn() }));

vi.mock("@repo/db", () => ({ db }));
vi.mock("../services/sage-proactive.js", () => proactive);
vi.mock("../agents/tools/specialist-tools.js", () => specialists);

import { NEED_ASKS_PER_COMMONS_PER_DAY, askHelpersForUnansweredNeeds } from "../services/sage-unanswered-needs.js";

const now = new Date("2026-10-13T12:00:00Z");
const post = { id: "p1", title: "Need a ride to the clinic Thursday", content: "Anyone driving downtown?", authorId: "author" };

beforeEach(() => {
  vi.clearAllMocks();
  db.auditLog.count.mockResolvedValue(0);
  db.auditLog.findMany.mockResolvedValue([]);
  db.auditLog.findFirst.mockResolvedValue(null);
  db.commonsPost.findMany.mockResolvedValue([post]);
  db.commonsComment.findFirst.mockResolvedValue(null);
  db.coopConfig.findFirst.mockResolvedValue({ name: "Harbor Commons" });
  specialists.findMembersForNeed.mockResolvedValue([{ userId: "helper", name: "Pat", matched: ["driving"] }]);
  proactive.sendProactiveSageMessage.mockResolvedValue({ status: "SENT", groupId: "g" });
});

describe("needs nobody answered", () => {
  it("looks only at quiet Need/Ask posts 24 hours to 14 days old in the feed, not bots", async () => {
    await askHelpersForUnansweredNeeds("harbor", now);
    const where = db.commonsPost.findMany.mock.calls[0]![0].where;
    expect(where.OR).toEqual([{ tag: { in: ["Need", "Ask"] } }, { classification: "need" }]);
    expect(where.createdAt.lte.toISOString()).toBe("2026-10-12T12:00:00.000Z");
    expect(where.createdAt.gte.toISOString()).toBe("2026-09-29T12:00:00.000Z");
    expect(where.author).toEqual({ isBot: false });
  });

  it("privately asks the best-matching member, never the author, and records it", async () => {
    expect(await askHelpersForUnansweredNeeds("harbor", now)).toEqual({ considered: 1, asked: 1 });
    expect(specialists.findMembersForNeed.mock.calls[0]![2]).toBe("author");
    const sent = proactive.sendProactiveSageMessage.mock.calls[0]![0];
    expect(sent).toMatchObject({ userId: "helper", kind: "need", key: "p1:helper" });
    expect(sent.content).toContain("Harbor Commons");
    expect(sent.content).toContain("Need a ride to the clinic Thursday");
    expect(sent.content).toContain("driving");
    expect(db.auditLog.create.mock.calls[0]![0].data).toMatchObject({ action: "SAGE_NEED_HELPER_ASKED", resourceId: "p1" });
  });

  it("skips a post someone already answered", async () => {
    db.commonsComment.findFirst.mockResolvedValue({ id: "c1" });
    expect((await askHelpersForUnansweredNeeds("harbor", now)).asked).toBe(0);
    expect(db.commonsComment.findFirst.mock.calls[0]![0].where).toEqual({ postId: "p1", authorId: { not: "author" } });
  });

  it("asks at most two helpers per post, a week apart, and never the same one twice", async () => {
    db.auditLog.findMany.mockResolvedValue([{ occurredAt: new Date("2026-10-12"), metadata: { helperId: "other" } }]);
    expect((await askHelpersForUnansweredNeeds("harbor", now)).asked).toBe(0);
    db.auditLog.findMany.mockResolvedValue([{ occurredAt: new Date("2026-10-01"), metadata: { helperId: "helper" } }]);
    specialists.findMembersForNeed.mockResolvedValue([{ userId: "helper", name: "Pat", matched: ["driving"] }, { userId: "second", name: "Sam", matched: ["car"] }]);
    await askHelpersForUnansweredNeeds("harbor", now);
    expect(proactive.sendProactiveSageMessage.mock.calls[0]![0].userId).toBe("second");
    db.auditLog.findMany.mockResolvedValue([{ occurredAt: new Date("2026-09-01") }, { occurredAt: new Date("2026-09-08") }]);
    proactive.sendProactiveSageMessage.mockClear();
    await askHelpersForUnansweredNeeds("harbor", now);
    expect(proactive.sendProactiveSageMessage).not.toHaveBeenCalled();
  });

  it("tries the next helper when one is at their weekly limit or was asked about another need this week", async () => {
    specialists.findMembersForNeed.mockResolvedValue([{ userId: "busy", name: "A", matched: ["driving"] }, { userId: "limited", name: "B", matched: ["car"] }, { userId: "free", name: "C", matched: ["rides"] }]);
    db.auditLog.findFirst.mockImplementation(async ({ where }: { where: { metadata: { equals: string } } }) => (where.metadata.equals === "busy" ? { id: "x" } : null));
    proactive.sendProactiveSageMessage.mockImplementation(async ({ userId }: { userId: string }) => (userId === "limited" ? { status: "LIMITED" } : { status: "SENT", groupId: "g" }));
    expect((await askHelpersForUnansweredNeeds("harbor", now)).asked).toBe(1);
    expect(proactive.sendProactiveSageMessage.mock.calls.map(([input]) => input.userId)).toEqual(["limited", "free"]);
  });

  it("stops at the daily cap per Commons", async () => {
    db.auditLog.count.mockResolvedValue(NEED_ASKS_PER_COMMONS_PER_DAY);
    expect(await askHelpersForUnansweredNeeds("harbor", now)).toEqual({ considered: 0, asked: 0 });
    expect(db.commonsPost.findMany).not.toHaveBeenCalled();
  });
});
