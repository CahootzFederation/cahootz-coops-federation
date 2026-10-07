import { beforeEach, describe, expect, it, vi } from "vitest";

const agents = vi.hoisted(() => [] as Array<{ name: string; instructions: string }>);
const run = vi.hoisted(() => vi.fn());

vi.mock("@openai/agents", () => {
  class MockAgent {
    name: string;
    constructor(opts: { name: string; instructions: string }) {
      this.name = opts.name;
      agents.push(opts);
    }
  }
  return { Agent: MockAgent, run, webSearchTool: vi.fn().mockReturnValue({}) };
});

const { ProposalEngine, normalizeKpis } = await import("../proposal-engine.js");

const base = {
  title: "Second community fridge", summary: "A fridge downtown", category: "other",
  budget: { currency: "USD", amountRequested: 800 },
  structural_scores: { goal_mapping_valid: true, feasibility_score: 0.7, risk_score: 0.3, accountability_score: 0.6 },
  mission_impact_scores: [], violations: [], risk_flags: [], llm_summary: "ok",
  quorumPercent: 20, approvalThresholdPercent: 60, votingWindowDays: 7, alternatives: [], missing_data: [],
};
const kpiAnswer = { kpis: [{ name: "Meals served", target: 500, unit: "count", higherIsBetter: true, measureAfterDays: 60 }] };

beforeEach(() => {
  agents.length = 0;
  run.mockReset();
  run.mockImplementation((agent: { name: string }) => Promise.resolve({ finalOutput: agent.name === "KPI Agent" ? kpiAnswer : base }));
});

describe("normalizeKpis", () => {
  it("keeps at most 3 valid, distinct KPIs and clamps measure dates to 7-365 days", () => {
    expect(normalizeKpis({
      kpis: [
        { name: "Meals served", target: 500, unit: "count", higherIsBetter: true, measureAfterDays: 2 },
        { name: "meals served", target: 10, unit: "count", higherIsBetter: true, measureAfterDays: 30 },
        { name: "x", target: 1, unit: "count", higherIsBetter: true, measureAfterDays: 30 },
        { name: "Cost per meal", target: 2, unit: "USD", higherIsBetter: false, measureAfterDays: 900 },
        { name: "Volunteers", target: 10, unit: "count", higherIsBetter: true, measureAfterDays: 90 },
        { name: "Jobs", target: 1, unit: "jobs", higherIsBetter: true, measureAfterDays: 90 },
      ],
    })).toEqual([
      { name: "Meals served", target: 500, unit: "count", higherIsBetter: true, measureAfterDays: 7 },
      { name: "Cost per meal", target: 2, unit: "USD", higherIsBetter: false, measureAfterDays: 365 },
      { name: "Volunteers", target: 10, unit: "count", higherIsBetter: true, measureAfterDays: 90 },
    ]);
  });

  it("returns nothing rather than invented KPIs for a missing or malformed answer", () => {
    expect(normalizeKpis(undefined)).toEqual([]);
    expect(normalizeKpis({ kpis: "lots" })).toEqual([]);
  });
});

describe("processProposal", () => {
  const input = { text: "Build a second community fridge downtown for $800.", proposer: { wallet: "0xabc", role: "member" as const }, region: { code: "US", name: "United States" } };

  it("returns the KPI agent's KPIs instead of discarding them", async () => {
    const output = await new ProposalEngine().processProposal(input);
    expect(output.kpis).toEqual([{ name: "Meals served", target: 500, unit: "count", higherIsBetter: true, measureAfterDays: 60 }]);
    expect(output.priorOutcomes).toEqual([]);
  });

  it("asks for similar past outcomes with the extracted title and gives them to the structural scorer", async () => {
    const prior = [{ text: "[PROPOSAL OUTCOME] · \"Community fridge\" · Meals served: 300 of 500 target, partly met (10d ago)", sourceIds: ["prop-1"], ageDays: 10 }];
    const lookup = vi.fn().mockResolvedValue(prior);
    const output = await new ProposalEngine().processProposal(input, undefined, { priorOutcomes: lookup });
    expect(lookup).toHaveBeenCalledWith({ title: "Second community fridge", summary: "A fridge downtown", category: "other" });
    expect(output.priorOutcomes).toEqual(prior);
    const structural = agents.find((agent) => agent.name === "Structural Scorer")!;
    expect(structural.instructions).toContain("RESULTS OF SIMILAR PAST PROPOSALS IN THIS CO-OP (reported by their authors, not verified):");
    expect(structural.instructions).toContain("Meals served: 300 of 500 target, partly met");
  });

  it("still reviews the proposal when the memory lookup or the KPI agent fails", async () => {
    run.mockImplementation((agent: { name: string }) => agent.name === "KPI Agent" ? Promise.reject(new Error("model down")) : Promise.resolve({ finalOutput: base }));
    const output = await new ProposalEngine().processProposal(input, undefined, { priorOutcomes: () => Promise.reject(new Error("db down")) });
    expect(output.kpis).toEqual([]);
    expect(output.priorOutcomes).toEqual([]);
  });
});
