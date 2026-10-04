import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  commonsAction: { findMany: vi.fn() },
  sageTask: { findMany: vi.fn() },
  aIObservationSource: { findMany: vi.fn() },
  aIObservation: { findMany: vi.fn(), updateMany: vi.fn() },
  group: { findMany: vi.fn() },
  auditLog: { create: vi.fn().mockResolvedValue({}) },
}));
const recordObservation = vi.hoisted(() => vi.fn());
vi.mock("@repo/db", () => ({ db }));
vi.mock("../services/ai-memory.js", () => ({ recordObservation }));

const { consolidateSageMemory, expireSageMemory, retrieveSageMemory, overlap } = await import("../services/sage-memory.js");

const NOW = new Date("2026-10-05T12:00:00.000Z");
const DAY = 86_400_000;

beforeEach(() => {
  vi.clearAllMocks();
  db.commonsAction.findMany.mockResolvedValue([]);
  db.sageTask.findMany.mockResolvedValue([]);
  db.aIObservationSource.findMany.mockResolvedValue([]);
  db.aIObservation.findMany.mockResolvedValue([]);
  db.aIObservation.updateMany.mockResolvedValue({ count: 0 });
  let n = 0;
  recordObservation.mockImplementation(() => Promise.resolve({ id: `obs-${++n}` }));
});

describe("consolidating outcomes into memory", () => {
  const declined = {
    id: "act-1", summary: "Organize a cleanup day", status: "DISMISSED", createdAt: new Date("2026-10-01T00:00:00Z"),
    payload: { capability: "create_event" }, circleId: "circle-1", type: "SUGGEST_ACTION",
    feedback: { rating: "NEEDS_WORK", notes: null, correctedText: "We already have one planned" },
  };

  it("remembers a circle's outcome in that circle only, with its source and an expiry", async () => {
    db.commonsAction.findMany.mockResolvedValueOnce([declined]);
    await expect(consolidateSageMemory("harbor", NOW)).resolves.toEqual({ remembered: 1, superseded: 0 });
    expect(recordObservation).toHaveBeenCalledWith(expect.objectContaining({
      type: "sage_outcome", scopeType: "circle", scopeId: "circle-1", visibility: "CIRCLE", confidence: 1,
      summary: expect.stringMatching(/^\[DECLINED\] · 2026-10-01 · create_event · Organize a cleanup day · reviewer correction: We already have one planned/),
      sources: [{ type: "commons_action", id: "act-1" }],
      expiresAt: new Date(NOW.getTime() + 180 * DAY), generatedByAgentKey: "sage-memory",
    }));
  });

  it("remembers each source once and records follow-up results", async () => {
    db.commonsAction.findMany.mockResolvedValueOnce([declined]);
    db.aIObservationSource.findMany.mockResolvedValueOnce([{ sourceId: "act-1" }]).mockResolvedValueOnce([]);
    db.sageTask.findMany.mockResolvedValueOnce([{ id: "task-1", title: "Shared drivers", status: "ABANDONED", outcome: "No response after a reminder", circleId: null, updatedAt: NOW }]);
    await expect(consolidateSageMemory("harbor", NOW)).resolves.toMatchObject({ remembered: 1 });
    expect(recordObservation).toHaveBeenCalledTimes(1);
    expect(recordObservation).toHaveBeenCalledWith(expect.objectContaining({
      type: "sage_follow_up", scopeType: "commons", scopeId: "harbor", visibility: "COMMONS_MEMBERS",
      summary: "[FOLLOW-UP DROPPED] · 2026-10-05 · Shared drivers · No response after a reminder",
    }));
  });

  it("supersedes an older memory about nearly the same thing", async () => {
    db.commonsAction.findMany.mockResolvedValueOnce([declined]);
    db.aIObservation.findMany.mockResolvedValueOnce([{ id: "old", details: { title: "Organize the cleanup days" } }, { id: "unrelated", details: { title: "Potluck dinner" } }]);
    db.aIObservation.updateMany.mockResolvedValueOnce({ count: 1 });
    await expect(consolidateSageMemory("harbor", NOW)).resolves.toEqual({ remembered: 1, superseded: 1 });
    expect(db.aIObservation.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["old"] } }, data: { status: "SUPERSEDED" } });
  });

  it("expires memory past its date in this Commons and its circles only", async () => {
    db.group.findMany.mockResolvedValueOnce([{ id: "circle-1" }]);
    db.aIObservation.updateMany.mockResolvedValueOnce({ count: 3 });
    await expect(expireSageMemory("harbor", NOW)).resolves.toBe(3);
    expect(db.aIObservation.updateMany).toHaveBeenCalledWith({
      where: { status: "ACTIVE", expiresAt: { lte: NOW }, OR: [{ scopeType: "commons", scopeId: "harbor" }, { scopeType: "circle", scopeId: { in: ["circle-1"] } }] },
      data: { status: "EXPIRED" },
    });
  });
});

describe("retrieving memory", () => {
  const row = (id: string, summary: string, title: string, scopeType: string, ageDays: number) => ({
    id, summary, details: { title }, scopeType, createdAt: new Date(NOW.getTime() - ageDays * DAY), sources: [{ sourceId: `src-${id}` }],
  });

  it("asks only for this circle and the Commons' member-visible memory, never another circle", async () => {
    await retrieveSageMemory({ coopId: "harbor", circleId: "circle-1", purpose: "test", now: NOW });
    expect(db.aIObservation.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      status: "ACTIVE", generatedByAgentKey: "sage-memory",
      OR: [
        { scopeType: "commons", scopeId: "harbor", visibility: { in: ["COMMONS_MEMBERS", "PUBLIC"] } },
        { scopeType: "circle", scopeId: "circle-1" },
      ],
    }) }));
  });

  it("ranks by relevance and recency, stays within budget, and audits the read", async () => {
    db.aIObservation.findMany.mockResolvedValueOnce([
      row("a", "[APPROVED] Potluck dinner", "Potluck dinner", "commons", 2),
      row("b", "[DECLINED] Organize a cleanup day", "Organize a cleanup day", "circle", 40),
      row("c", "x".repeat(900), "Something else", "commons", 1),
    ]);
    const lines = await retrieveSageMemory({ coopId: "harbor", circleId: "circle-1", about: "cleanup day this weekend?", purpose: "trend", maxChars: 1000, now: NOW });
    expect(lines[0]).toMatchObject({ text: "[DECLINED] Organize a cleanup day (40d ago)", scope: "circle", sourceIds: ["src-b"] });
    expect(lines.reduce((sum, line) => sum + line.text.length, 0)).toBeLessThanOrEqual(1000);
    expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      actorId: "system/sage", action: "SAGE_MEMORY_READ", metadata: expect.objectContaining({ purpose: "trend", returned: lines.length }),
    }) });
  });

  it("measures topic overlap ignoring filler words and plurals", () => {
    expect(overlap("Organize a cleanup day", "cleanup days this weekend")).toBeCloseTo(2 / 3);
    expect(overlap("Shared tool library", "tool libraries")).toBe(1);
    expect(overlap("", "anything")).toBe(0);
  });
});
