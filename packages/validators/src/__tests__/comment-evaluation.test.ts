import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CoopConfigData } from "../proposal-engine.js";

// Mock @openai/agents
vi.mock("@openai/agents", () => {
  class MockAgent {
    constructor(opts: any) {
      // no-op
    }
  }
  return {
    Agent: MockAgent,
    run: vi.fn().mockResolvedValue({
      finalOutput: {
        alignment: "ALIGNED",
        score: 0.8,
        analysis: "This comment strongly supports the charter goal of reducing economic leakage by advocating for local sourcing.",
        goalsImpacted: ["LeakageReduction", "LocalJobs"],
      },
    }),
    webSearchTool: vi.fn().mockReturnValue({}),
  };
});

describe("ProposalEngine.evaluateComment", () => {
  let ProposalEngine: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../proposal-engine.js");
    ProposalEngine = mod.ProposalEngine;
  });

  const proposalContext = {
    title: "Community Grocery Store",
    summary: "Fund a local grocery to reduce food deserts",
    category: "business_funding",
  };

  const config: CoopConfigData = {
    charterText: "Cahootz exists to rebuild economic sovereignty through internal investment and local production.",
    missionGoals: [
      { key: "income_stability",  label: "Income Stability",  priorityWeight: 0.35 },
      { key: "leakage_reduction", label: "Leakage Reduction", priorityWeight: 0.20 },
      { key: "asset_creation",    label: "Asset Creation",    priorityWeight: 0.25 },
      { key: "export_expansion",  label: "Export Expansion",  priorityWeight: 0.20 },
    ],
    structuralWeights: { feasibility: 0.40, risk: 0.35, accountability: 0.25 },
    scoreMix: { missionWeight: 0.60, structuralWeight: 0.40 },
    screeningPassThreshold: 0.6,
    proposalCategories: [{ key: "business_funding", label: "BF", isActive: true }],
    sectorExclusions: [],
    quorumPercent: 15,
    approvalThresholdPercent: 51,
    votingWindowDays: 7,
  };

  it("returns valid evaluation shape", async () => {
    const engine = new ProposalEngine();
    const result = await engine.evaluateComment(
      "This grocery store would help keep money in our community",
      proposalContext,
      config,
    );

    expect(result).toHaveProperty("alignment");
    expect(result).toHaveProperty("score");
    expect(result).toHaveProperty("analysis");
    expect(result).toHaveProperty("goalsImpacted");
  });

  it("score is between 0 and 1", async () => {
    const engine = new ProposalEngine();
    const result = await engine.evaluateComment(
      "Great proposal, let's fund it",
      proposalContext,
      config,
    );

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it("alignment is a valid enum value", async () => {
    const engine = new ProposalEngine();
    const result = await engine.evaluateComment(
      "I support this initiative",
      proposalContext,
      config,
    );

    expect(["ALIGNED", "NEUTRAL", "MISALIGNED"]).toContain(result.alignment);
  });

  it("analysis is a non-empty string", async () => {
    const engine = new ProposalEngine();
    const result = await engine.evaluateComment(
      "This will help reduce food costs for families",
      proposalContext,
      config,
    );

    expect(typeof result.analysis).toBe("string");
    expect(result.analysis.length).toBeGreaterThan(0);
  });

  it("goalsImpacted contains valid goal keys", async () => {
    const engine = new ProposalEngine();
    const result = await engine.evaluateComment(
      "Local jobs and reduced leakage are the key benefits",
      proposalContext,
      config,
    );

    const validKeys = config.missionGoals.map(g => g.key);
    for (const goal of result.goalsImpacted) {
      expect(validKeys).toContain(goal);
    }
  });

  it("works without config (uses defaults)", async () => {
    const engine = new ProposalEngine();
    const result = await engine.evaluateComment(
      "Good proposal for the community",
      proposalContext,
    );

    expect(result.alignment).toBeDefined();
    expect(result.score).toBeDefined();
  });
});
