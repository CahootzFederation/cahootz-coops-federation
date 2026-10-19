import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  aIObservation: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  commonsPost: { count: vi.fn(), findMany: vi.fn() },
  commonsComment: { count: vi.fn(), findMany: vi.fn() },
}));
const recordObservation = vi.hoisted(() => vi.fn());
vi.mock("@repo/db", () => ({ db }));
vi.mock("@openai/agents", () => {
  class MockAgent { constructor(public opts: unknown) {} }
  return { Agent: MockAgent, run: vi.fn() };
});
vi.mock("../services/ai-cost.js", () => ({ recordAICost: vi.fn(), recordAgentResultCost: vi.fn() }));
vi.mock("../services/ai-memory.js", () => ({ recordObservation }));

const {
  GOAL_SIGNAL_KEYS, cleanSignalChoice, countSignal, describeGap, displayGoalSignalMap, ensureGoalSignalMap, findSignalGap, keywordSignalsFor, readSignal, setGoalSignals,
} = await import("../services/sage-goal-signals.js");

const CONFIG = { id: "cfg-1", version: 4, charterText: "We keep each other informed and buy from each other first." };
const GOALS = [
  { key: "more_communication", label: "More communication", description: "Members talk and share what's going on" },
  { key: "local_commerce", label: "Local commerce", description: "Buy from member stores first" },
  { key: "income_stability", label: "Income Stability", description: "" },
];

beforeEach(() => {
  vi.clearAllMocks();
  db.aIObservation.findUnique.mockResolvedValue(null);
  db.aIObservation.findFirst.mockResolvedValue(null);
  recordObservation.mockResolvedValue({ id: "map-1" });
});

describe("comparing a goal with the Commons' own normal", () => {
  it("calls a 40%+ drop from a real baseline a gap, with exact numbers", () => {
    const gap = findSignalGap({ key: "conversation", current: 4, history: [18, 20, 16, 18] });
    expect(gap).toMatchObject({ kind: "DROPPED", current: 4, usual: 18 });
    expect(describeGap(gap!)).toBe("Posts and comments members write: 4 in the last two weeks, down from about 18 every two weeks before that.");
  });

  it("ignores small or normal swings and tiny baselines", () => {
    expect(findSignalGap({ key: "conversation", current: 12, history: [18, 20, 16, 18] })).toBeNull();
    expect(findSignalGap({ key: "conversation", current: 1, history: [2, 2] })).toBeNull();
  });

  it("calls six weeks with nothing at all a gap, but needs history to judge", () => {
    expect(findSignalGap({ key: "events", current: 0, history: [0, 0] })).toMatchObject({ kind: "NOT_HAPPENING" });
    expect(describeGap(findSignalGap({ key: "events", current: 0, history: [0, 0, 0] })!)).toBe("No events held in the last six weeks or more.");
    expect(findSignalGap({ key: "events", current: 0, history: [0] })).toBeNull();
    expect(findSignalGap({ key: "events", current: 0, history: [] })).toBeNull();
  });

  it("only counts two-week periods after the Commons existed", async () => {
    db.commonsPost.count.mockResolvedValue(3);
    db.commonsComment.count.mockResolvedValue(2);
    const now = new Date("2026-10-18T12:00:00Z");
    const reading = await readSignal("harbor", "conversation", now, new Date("2026-09-10T00:00:00Z"));
    expect(reading).toEqual({ key: "conversation", current: 5, history: [5] });
  });

  it("counts people, not posts, for taking part", async () => {
    db.commonsPost.findMany.mockResolvedValue([{ authorId: "a" }, { authorId: "b" }]);
    db.commonsComment.findMany.mockResolvedValue([{ authorId: "b" }, { authorId: "c" }]);
    await expect(countSignal("harbor", "participation", new Date(0), new Date())).resolves.toBe(3);
  });
});

describe("matching goals to signals", () => {
  it("falls back to keywords, and leaves a goal with no honest match unmeasured", () => {
    expect(keywordSignalsFor(GOALS[0]!)).toContain("conversation");
    expect(keywordSignalsFor(GOALS[1]!)).toContain("local_commerce");
    expect(keywordSignalsFor({ key: "x", label: "Asset Creation" })).toEqual([]);
    // "Share news" is talking, not lending things.
    expect(keywordSignalsFor({ key: "c", label: "More communication", description: "Members talk and share news" })).toEqual(["conversation"]);
    expect(keywordSignalsFor({ key: "t", label: "Tool library", description: "Lend and borrow tools" })).toContain("resources_shared");
  });

  it("only keeps signals from the list, without repeats, at most three", () => {
    expect(cleanSignalChoice(["conversation", "made_up", "conversation", "events", "governance", "needs_met"])).toEqual(["conversation", "events", "governance"]);
    expect(cleanSignalChoice("conversation")).toEqual([]);
    expect(GOAL_SIGNAL_KEYS).toHaveLength(10);
  });

  it("matches once per charter version with the model, visible to members", async () => {
    const matcher = vi.fn().mockResolvedValue({ more_communication: ["conversation", "participation"], local_commerce: ["local_commerce", "bogus"], income_stability: [] });
    const result = await ensureGoalSignalMap("harbor", CONFIG, GOALS, { matcher });
    expect(result).toMatchObject({ created: true, usedModel: true });
    expect(result.map.goals).toEqual([
      { key: "more_communication", label: "More communication", signals: ["conversation", "participation"], source: "sage" },
      { key: "local_commerce", label: "Local commerce", signals: ["local_commerce"], source: "sage" },
      { key: "income_stability", label: "Income Stability", signals: [], source: "sage" },
    ]);
    expect(recordObservation).toHaveBeenCalledWith(expect.objectContaining({
      type: "goal_signal_map", visibility: "COMMONS_MEMBERS", systemKey: "goal_signal_map:harbor:cfg-1:4",
    }));
    expect(db.aIObservation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "SUPERSEDED" } }));
  });

  it("reuses an existing map without another model call", async () => {
    db.aIObservation.findUnique.mockResolvedValue({ id: "map-1", details: { configId: "cfg-1", version: 4, goals: [{ key: "more_communication", label: "More communication", signals: ["conversation"], source: "sage" }] } });
    const matcher = vi.fn();
    const result = await ensureGoalSignalMap("harbor", CONFIG, GOALS, { matcher });
    expect(result.created).toBe(false);
    expect(matcher).not.toHaveBeenCalled();
  });

  it("carries a steward's choice to the next charter version and uses keywords if the model fails", async () => {
    db.aIObservation.findFirst.mockResolvedValue({ id: "old", details: { configId: "cfg-1", version: 3, goals: [
      { key: "income_stability", label: "Income Stability", signals: ["member_payments"], source: "steward" },
    ] } });
    const matcher = vi.fn().mockRejectedValue(new Error("model down"));
    const result = await ensureGoalSignalMap("harbor", CONFIG, GOALS, { matcher });
    expect(matcher).toHaveBeenCalledWith(expect.not.arrayContaining([expect.objectContaining({ key: "income_stability" })]), expect.any(String), "harbor");
    expect(result.map.goals.find((goal) => goal.key === "income_stability")).toEqual({ key: "income_stability", label: "Income Stability", signals: ["member_payments"], source: "steward" });
    expect(result.map.goals.find((goal) => goal.key === "more_communication")?.source).toBe("keywords");
  });

  it("lets a steward change one goal's matches", async () => {
    db.aIObservation.findUnique.mockResolvedValue({ id: "map-1", details: { configId: "cfg-1", version: 4, goals: [
      { key: "income_stability", label: "Income Stability", signals: [], source: "sage" },
    ] } });
    const result = await setGoalSignals("harbor", CONFIG, "income_stability", ["member_payments", "nope"], "steward-1");
    expect(result.updated).toBe(true);
    expect(db.aIObservation.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "map-1" },
      data: expect.objectContaining({ verifiedById: "steward-1", details: expect.objectContaining({ goals: [{ key: "income_stability", label: "Income Stability", signals: ["member_payments"], source: "steward" }] }) }),
    }));
    await expect(setGoalSignals("harbor", CONFIG, "missing", [], "steward-1")).resolves.toMatchObject({ updated: false });
  });

  it("shows and edits last version's matches right after a charter change", async () => {
    db.aIObservation.findUnique.mockResolvedValue(null);
    db.aIObservation.findFirst.mockResolvedValue({ details: { configId: "cfg-1", version: 3, goals: [
      { key: "more_communication", label: "More communication", signals: ["conversation"], source: "sage" },
    ] } });
    const config = { ...CONFIG, version: 5, missionGoals: [{ key: "more_communication", label: "More communication" }, { key: "new_goal", label: "Brand new goal" }] };
    await expect(displayGoalSignalMap("harbor", config)).resolves.toEqual({ configId: "cfg-1", version: 5, goals: [
      { key: "more_communication", label: "More communication", signals: ["conversation"], source: "sage" },
      { key: "new_goal", label: "Brand new goal", signals: [], source: "keywords" },
    ] });
    recordObservation.mockResolvedValue({ id: "map-5" });
    await expect(setGoalSignals("harbor", config, "new_goal", ["events"], "steward-1")).resolves.toMatchObject({ updated: true });
    expect(recordObservation).toHaveBeenCalledWith(expect.objectContaining({ systemKey: "goal_signal_map:harbor:cfg-1:5" }));
    expect(db.aIObservation.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "map-5" } }));
  });
});
