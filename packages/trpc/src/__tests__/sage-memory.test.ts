import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  commonsAction: { findMany: vi.fn() },
  sageTask: { findMany: vi.fn() },
  aIObservationSource: { findMany: vi.fn() },
  aIObservation: { findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  group: { findMany: vi.fn() },
  auditLog: { create: vi.fn().mockResolvedValue({}) },
}));
const recordObservation = vi.hoisted(() => vi.fn());
vi.mock("@repo/db", () => ({ db }));
vi.mock("../services/ai-memory.js", () => ({ recordObservation }));

const { consolidateSageMemory, expireSageMemory, loadOutcomeContext, retrieveSageMemory, overlap } = await import("../services/sage-memory.js");

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
    await expect(consolidateSageMemory("harbor", NOW)).resolves.toEqual({ remembered: 1, superseded: 0, refreshed: 0 });
    expect(recordObservation).toHaveBeenCalledWith(expect.objectContaining({
      type: "sage_outcome", scopeType: "circle", scopeId: "circle-1", visibility: "CIRCLE", confidence: 1,
      summary: expect.stringMatching(/^\[DECLINED\] · 2026-10-01 · create_event · Organize a cleanup day · reviewer correction: We already have one planned/),
      sources: [{ type: "commons_action", id: "act-1" }],
      expiresAt: new Date(NOW.getTime() + 180 * DAY), generatedByAgentKey: "sage-memory",
    }));
  });

  it("remembers each source once and records follow-up results", async () => {
    db.commonsAction.findMany.mockResolvedValueOnce([declined]);
    db.aIObservationSource.findMany
      .mockResolvedValueOnce([{ sourceId: "act-1", observation: { id: "obs-old", summary: "[DECLINED] · 2026-10-01 · create_event · Organize a cleanup day · reviewer correction: We already have one planned" } }])
      .mockResolvedValueOnce([]);
    db.sageTask.findMany.mockResolvedValueOnce([{ id: "task-1", title: "Shared drivers", status: "ABANDONED", outcome: "No response after a reminder", circleId: null, updatedAt: NOW }]);
    await expect(consolidateSageMemory("harbor", NOW)).resolves.toMatchObject({ remembered: 1, refreshed: 0 });
    expect(recordObservation).toHaveBeenCalledTimes(1);
    expect(db.aIObservation.update).not.toHaveBeenCalled();
    expect(recordObservation).toHaveBeenCalledWith(expect.objectContaining({
      type: "sage_follow_up", scopeType: "commons", scopeId: "harbor", visibility: "COMMONS_MEMBERS",
      summary: "[FOLLOW-UP DROPPED] · 2026-10-05 · Shared drivers · No response after a reminder",
    }));
  });

  it("supersedes an older memory about nearly the same thing", async () => {
    db.commonsAction.findMany.mockResolvedValueOnce([declined]);
    db.aIObservation.findMany.mockResolvedValueOnce([{ id: "old", details: { title: "Organize the cleanup days" } }, { id: "unrelated", details: { title: "Potluck dinner" } }]);
    db.aIObservation.updateMany.mockResolvedValueOnce({ count: 1 });
    await expect(consolidateSageMemory("harbor", NOW)).resolves.toEqual({ remembered: 1, superseded: 1, refreshed: 0 });
    expect(db.aIObservation.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["old"] } }, data: { status: "SUPERSEDED" } });
  });

  it("rewrites a remembered outcome that was published after approval, instead of keeping both", async () => {
    const published = { ...declined, status: "PUBLISHED", feedback: null, summary: "Comment on the cleanup thread", payload: { capability: "comment_on_post" } };
    db.commonsAction.findMany.mockResolvedValueOnce([published]);
    db.aIObservationSource.findMany
      .mockResolvedValueOnce([{ sourceId: "act-1", observation: { id: "obs-old", summary: "[APPROVED] · 2026-10-01 · comment_on_post · Comment on the cleanup thread" } }])
      .mockResolvedValueOnce([]);
    await expect(consolidateSageMemory("harbor", NOW)).resolves.toEqual({ remembered: 0, superseded: 0, refreshed: 1 });
    expect(recordObservation).not.toHaveBeenCalled();
    expect(db.aIObservation.update).toHaveBeenCalledWith({
      where: { id: "obs-old" },
      data: { summary: "[PUBLISHED] · 2026-10-01 · comment_on_post · Comment on the cleanup thread", details: expect.objectContaining({ status: "PUBLISHED" }) },
    });
  });

  it("picks up a reviewer's rating added after the outcome was remembered", async () => {
    await consolidateSageMemory("harbor", NOW);
    const since = new Date(NOW.getTime() - 30 * DAY);
    expect(db.commonsAction.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      OR: [{ updatedAt: { gte: since } }, { feedback: { updatedAt: { gte: since } } }],
    }) }));
    // Only this memory's own rows count as "already remembered", not another agent's citing the same action.
    db.commonsAction.findMany.mockResolvedValueOnce([declined]);
    await consolidateSageMemory("harbor", NOW);
    expect(db.aIObservationSource.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ observation: { generatedByAgentKey: "sage-memory" } }),
    }));
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

describe("one outcome list for a circle agent", () => {
  const liveAction = (id: string, status: string, summary: string) => ({
    id, summary, status, createdAt: new Date("2026-10-01T00:00:00Z"), payload: { capability: "comment_on_post" }, feedback: null,
  });
  const memoryRow = (id: string, summary: string, sourceId: string) => ({
    id, summary, details: { title: summary }, scopeType: "circle", createdAt: new Date(NOW.getTime() - 3 * DAY), sources: [{ sourceId }],
  });

  it("shows each outcome once, with the live status winning over an older memory of it", async () => {
    db.commonsAction.findMany.mockResolvedValueOnce([liveAction("act-1", "PUBLISHED", "Comment on the cleanup thread")]);
    db.aIObservation.findMany.mockResolvedValueOnce([
      memoryRow("m1", "[APPROVED] · 2026-10-01 · comment_on_post · Comment on the cleanup thread", "act-1"),
      memoryRow("m2", "[FOLLOW-UP DONE] · 2026-09-20 · Shared drivers", "task-9"),
    ]);
    const lines = await loadOutcomeContext({ coopId: "harbor", circleId: "circle-1", purpose: "trend", now: NOW });
    expect(lines).toEqual([
      { text: "[PUBLISHED] · 2026-10-01 · comment_on_post · Comment on the cleanup thread", origin: "live" },
      { text: "[FOLLOW-UP DONE] · 2026-09-20 · Shared drivers (3d ago)", origin: "remembered" },
    ]);
    // Live outcomes are read for this circle only; memory for this circle and the Commons only.
    expect(db.commonsAction.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ coopId: "harbor", circleId: "circle-1" }) }));
    expect(db.aIObservation.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      OR: [
        { scopeType: "commons", scopeId: "harbor", visibility: { in: ["COMMONS_MEMBERS", "PUBLIC"] } },
        { scopeType: "circle", scopeId: "circle-1" },
      ],
    }) }));
  });

  it("keeps live and remembered lines together inside one budget, leaving room for memory", async () => {
    db.commonsAction.findMany.mockResolvedValueOnce(
      Array.from({ length: 8 }, (_, i) => liveAction(`act-${i}`, "DISMISSED", `Suggestion number ${i} ${"x".repeat(120)}`)),
    );
    db.aIObservation.findMany.mockResolvedValueOnce(
      Array.from({ length: 6 }, (_, i) => memoryRow(`m${i}`, `[FOLLOW-UP DONE] · Follow-up ${i} ${"y".repeat(80)}`, `task-${i}`)),
    );
    const lines = await loadOutcomeContext({ coopId: "harbor", circleId: "circle-1", purpose: "trend", now: NOW });
    expect(lines.length).toBeLessThanOrEqual(8);
    expect(lines.reduce((sum, line) => sum + line.text.length, 0)).toBeLessThanOrEqual(1500);
    expect(lines.filter((line) => line.origin === "live").length).toBeLessThanOrEqual(6);
    expect(lines.some((line) => line.origin === "remembered")).toBe(true);
  });
});
