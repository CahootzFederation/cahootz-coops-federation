import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CoopConfigData } from "../proposal-engine.js";

// Mock @openai/agents to avoid real API calls
vi.mock("@openai/agents", () => {
  class MockAgent {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    constructor(_opts: any) {}
  }
  return {
    Agent: MockAgent,
    run: vi.fn().mockResolvedValue({
      finalOutput: {
        title: "Test Proposal",
        summary: "A test proposal for community garden project with local food production",
        proposer: { wallet: "0xtest", role: "member", displayName: "Test" },
        region: { code: "US", name: "United States" },
        category: "business_funding",
        budget: { currency: "USD", amountRequested: 50000 },
        treasuryPlan: { localPercent: 70, nationalPercent: 30, acceptUC: true },
        // Evaluation agent fields
        structural_scores: {
          goal_mapping_valid: true,
          feasibility_score: 0.7,
          risk_score: 0.3,
          accountability_score: 0.6,
        },
        mission_impact_scores: [
          { goal_id: "income_stability",  impact_score: 0.7 },
          { goal_id: "asset_creation",    impact_score: 0.6 },
          { goal_id: "leakage_reduction", impact_score: 0.8 },
          { goal_id: "export_expansion",  impact_score: 0.5 },
        ],
        violations: [],
        risk_flags: ["Limited market research provided"],
        llm_summary: "Solid community garden proposal with reasonable financials.",
        quorumPercent: 20,
        approvalThresholdPercent: 60,
        votingWindowDays: 7,
        alternatives: [
          {
            label: "Lower Budget Option",
            changes: [{ field: "budget.amountRequested", from: 50000, to: 30000 }],
            rationale: "Reducing budget improves feasibility while maintaining community benefit",
          },
        ],
        missing_data: [
          {
            field: "zoning",
            question: "Is the proposed location zoned for commercial use?",
            why_needed: "Required for building permits",
            blocking: true,
          },
        ],
      },
    }),
    webSearchTool: vi.fn().mockReturnValue({}),
  };
});

describe("ProposalEngine with CoopConfig", () => {
  let ProposalEngine: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../proposal-engine.js");
    ProposalEngine = mod.ProposalEngine;
  });

  const createInput = () => ({
    text: "Build a community garden for $50,000 to grow local food and create 3 jobs in Hampton Roads.",
    proposer: { wallet: "0xtest", role: "member" as const, displayName: "Test" },
    region: { code: "US", name: "United States" },
  });

  const createConfig = (): CoopConfigData => ({
    charterText: "Cahootz Co-op charter text for testing purposes with enough content to pass validation",
    missionGoals: [
      { key: "income_stability",  label: "Income Stability",  priorityWeight: 0.35 },
      { key: "asset_creation",    label: "Asset Creation",    priorityWeight: 0.25 },
      { key: "leakage_reduction", label: "Leakage Reduction", priorityWeight: 0.20 },
      { key: "export_expansion",  label: "Export Expansion",  priorityWeight: 0.20 },
    ],
    structuralWeights: { feasibility: 0.40, risk: 0.35, accountability: 0.25 },
    scoreMix: { missionWeight: 0.60, structuralWeight: 0.40 },
    screeningPassThreshold: 0.6,
    proposalCategories: [
      { key: "business_funding", label: "Business Funding", isActive: true },
      { key: "infrastructure",   label: "Infrastructure",   isActive: true },
      { key: "other",            label: "Other",            isActive: true },
    ],
    sectorExclusions: [{ value: "gambling" }, { value: "tobacco" }],
    quorumPercent: 25,
    approvalThresholdPercent: 55,
    votingWindowDays: 10,
  });

  describe("currency normalization", () => {
    it("normalizes lowercase 'uc' to 'UC'", async () => {
      const { run } = await import("@openai/agents");
      (run as any).mockResolvedValueOnce({
        finalOutput: {
          title: "Test",
          summary: "Test",
          proposer: { wallet: "0x1", role: "member", displayName: "T" },
          region: { code: "US", name: "US" },
          category: "business_funding",
          budget: { currency: "uc", amountRequested: 1000 },
          treasuryPlan: { localPercent: 70, nationalPercent: 30, acceptUC: true },
        },
      });

      const engine = new ProposalEngine();
      const result = await engine.processProposal(createInput());
      expect(result.budget.currency).toBe("UC");
    });

    it("normalizes lowercase 'usd' to 'USD'", async () => {
      const { run } = await import("@openai/agents");
      (run as any).mockResolvedValueOnce({
        finalOutput: {
          title: "Test",
          summary: "Test",
          proposer: { wallet: "0x1", role: "member", displayName: "T" },
          region: { code: "US", name: "US" },
          category: "business_funding",
          budget: { currency: "usd", amountRequested: 5000 },
          treasuryPlan: { localPercent: 70, nationalPercent: 30, acceptUC: true },
        },
      });

      const engine = new ProposalEngine();
      const result = await engine.processProposal(createInput());
      expect(result.budget.currency).toBe("USD");
    });

    it("normalizes 'Mixed' to 'mixed'", async () => {
      const { run } = await import("@openai/agents");
      (run as any).mockResolvedValueOnce({
        finalOutput: {
          title: "Test",
          summary: "Test",
          proposer: { wallet: "0x1", role: "member", displayName: "T" },
          region: { code: "US", name: "US" },
          category: "business_funding",
          budget: { currency: "Mixed", amountRequested: 5000 },
          treasuryPlan: { localPercent: 70, nationalPercent: 30, acceptUC: true },
        },
      });

      const engine = new ProposalEngine();
      const result = await engine.processProposal(createInput());
      expect(result.budget.currency).toBe("mixed");
    });

    it("preserves correctly cased 'UC'", async () => {
      const { run } = await import("@openai/agents");
      (run as any).mockResolvedValueOnce({
        finalOutput: {
          title: "Test",
          summary: "Test",
          proposer: { wallet: "0x1", role: "member", displayName: "T" },
          region: { code: "US", name: "US" },
          category: "business_funding",
          budget: { currency: "UC", amountRequested: 5000 },
          treasuryPlan: { localPercent: 70, nationalPercent: 30, acceptUC: true },
        },
      });

      const engine = new ProposalEngine();
      const result = await engine.processProposal(createInput());
      expect(result.budget.currency).toBe("UC");
    });
  });

  it("processProposal without config still works", async () => {
    const engine = new ProposalEngine();
    const result = await engine.processProposal(createInput());

    expect(result.id).toBeDefined();
    expect(result.title).toBeDefined();
    expect(result.evaluation).toBeDefined();
    expect(result.evaluation.computed_scores.overall_score).toBeGreaterThanOrEqual(0);
  });

  it("processProposal with config produces valid evaluation output", async () => {
    const engine = new ProposalEngine();
    const result = await engine.processProposal(createInput(), createConfig());

    expect(result.id).toBeDefined();
    expect(result.title).toBeDefined();
    expect(result.evaluation).toBeDefined();
    expect(result.evaluation.structural_scores).toBeDefined();
    expect(result.evaluation.mission_impact_scores.length).toBeGreaterThan(0);
    expect(result.evaluation.computed_scores.overall_score).toBeGreaterThanOrEqual(0);
    expect(result.evaluation.computed_scores.overall_score).toBeLessThanOrEqual(1);
    expect(result.decision).toBeDefined();
  });

  it("computeEvaluation calculates correct weighted totals", () => {
    const engine = new ProposalEngine();
    const config = createConfig();

    const rawEval = {
      structural_scores: {
        goal_mapping_valid: true,
        feasibility_score: 0.8,
        risk_score: 0.2,
        accountability_score: 0.7,
      },
      mission_impact_scores: [
        { goal_id: "income_stability",  impact_score: 0.8 },
        { goal_id: "asset_creation",    impact_score: 0.7 },
        { goal_id: "leakage_reduction", impact_score: 0.9 },
        { goal_id: "export_expansion",  impact_score: 0.6 },
      ],
      violations: [],
      risk_flags: [],
      llm_summary: "Test",
    };

    const evaluation = engine.computeEvaluation(rawEval, config);

    // Mission: 0.8*0.35 + 0.7*0.25 + 0.9*0.20 + 0.6*0.20 = 0.28+0.175+0.18+0.12 = 0.755
    expect(evaluation.computed_scores.mission_weighted_score).toBeCloseTo(0.755, 2);

    // Structural: 0.8*0.40 + (1-0.2)*0.35 + 0.7*0.25 = 0.32+0.28+0.175 = 0.775
    expect(evaluation.computed_scores.structural_weighted_score).toBeCloseTo(0.775, 2);

    // Overall: 0.755*0.60 + 0.775*0.40 = 0.453+0.31 = 0.763
    expect(evaluation.computed_scores.overall_score).toBeCloseTo(0.763, 2);

    expect(evaluation.computed_scores.passes_threshold).toBe(true);
  });

  it("compliance checks use config sector exclusions", async () => {
    const engine = new ProposalEngine();
    const config = createConfig();
    config.sectorExclusions = [{ value: "gambling" }, { value: "tobacco" }];

    const checks = await (engine).runComplianceChecks(
      { text: "This is about a gambling business", proposer: null, region: null },
      { title: "Gambling Proposal", summary: "..." },
      config,
    );

    const sectorCheck = checks.find((c: any) => c.name === "sector_exclusion_screen");
    expect(sectorCheck).toBeDefined();
    expect(sectorCheck?.passed).toBe(false);
  });

  it("compliance checks pass with non-excluded sectors", async () => {
    const engine = new ProposalEngine();
    const config = createConfig();

    const checks = await (engine).runComplianceChecks(
      { text: "Community solar panel installation project" },
      { title: "Solar Panels", summary: "Green energy project" },
      config,
    );

    const sectorCheck = checks.find((c: any) => c.name === "sector_exclusion_screen");
    expect(sectorCheck?.passed).toBe(true);
  });

  it("charter_loaded check uses config charterText", async () => {
    const engine = new ProposalEngine();
    const config = createConfig();

    const checks = await (engine).runComplianceChecks(
      { text: "Test proposal text for community project" },
      { title: "Test", summary: "test" },
      config,
    );

    const charterCheck = checks.find((c: any) => c.name === "charter_loaded");
    expect(charterCheck?.passed).toBe(true);
  });
});

// ── Acceptance criteria A–E ────────────────────────────────────────────────────
//
// These tests call computeEvaluation() directly with crafted rawEval fixtures
// to verify the three scoring gates and the breakdown output shape.
// No LLM calls are made — completely deterministic.
// ──────────────────────────────────────────────────────────────────────────────

describe("Scoring gates — acceptance criteria A–E", () => {
  let engine: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../proposal-engine.js");
    engine = new mod.ProposalEngine();
  });

  /** Shared mission goals with equal weight (each 0.25, total 1.0 → normalized stays 0.25). */
  const fourGoals = [
    { key: "goal_a", label: "Goal A", priorityWeight: 0.25 },
    { key: "goal_b", label: "Goal B", priorityWeight: 0.25 },
    { key: "goal_c", label: "Goal C", priorityWeight: 0.25 },
    { key: "goal_d", label: "Goal D", priorityWeight: 0.25 },
  ];

  const structuralPassingBase = {
    goal_mapping_valid: true,
    feasibility_score: 0.80,
    risk_score: 0.20,       // inverted → 0.80 effective
    accountability_score: 0.75,
    // structural_weighted_score = 0.80*0.40 + 0.80*0.35 + 0.75*0.25 = 0.32+0.28+0.1875 = 0.7875 ≥ 0.65 ✓
  };

  const makeRawEval = (
    missionScores: { goal_id: string; impact_score: number }[],
    structuralOverrides: Partial<typeof structuralPassingBase> = {},
  ) => ({
    structural_scores: { ...structuralPassingBase, ...structuralOverrides },
    mission_impact_scores: missionScores,
    violations: [],
    risk_flags: [],
    llm_summary: "Test summary.",
  });

  // ── A: One goal 0.90 but average is still >= 0.50 → PASS ──────────────────
  it("A: passes mission alignment when one goal >= 0.70 AND weighted average >= 0.50", () => {
    // Scores: 0.90, 0.40, 0.40, 0.40 → average = 0.525 ≥ 0.50 ✓; max = 0.90 ≥ 0.70 ✓
    const rawEval = makeRawEval([
      { goal_id: "goal_a", impact_score: 0.90 },
      { goal_id: "goal_b", impact_score: 0.40 },
      { goal_id: "goal_c", impact_score: 0.40 },
      { goal_id: "goal_d", impact_score: 0.40 },
    ]);

    const evaluation = engine.computeEvaluation(rawEval, { missionGoals: fourGoals });

    expect(evaluation.computed_scores.passes_threshold).toBe(true);
    expect(evaluation.computed_scores.passFailReasons).toHaveLength(0);
    expect(evaluation.computed_scores.mission_weighted_score).toBeCloseTo(0.525, 2);
  });

  // ── B: MissionImpactScore 0.80 but StructuralScore 0.60 → FAIL_STRUCTURAL_GATE
  it("B: fails with FAIL_STRUCTURAL_GATE when structural score < 0.65", () => {
    // structural: feasibility=0.50, risk=0.50 (inverted=0.50), accountability=0.50
    // structural_weighted = 0.50*0.40 + 0.50*0.35 + 0.50*0.25 = 0.50 < 0.65 → gate fires
    const rawEval = makeRawEval(
      [
        { goal_id: "goal_a", impact_score: 0.90 },
        { goal_id: "goal_b", impact_score: 0.80 },
        { goal_id: "goal_c", impact_score: 0.75 },
        { goal_id: "goal_d", impact_score: 0.75 },
      ],
      { feasibility_score: 0.50, risk_score: 0.50, accountability_score: 0.50 },
    );

    const evaluation = engine.computeEvaluation(rawEval, { missionGoals: fourGoals });

    expect(evaluation.computed_scores.passes_threshold).toBe(false);
    expect(evaluation.computed_scores.passFailReasons).toContain("FAIL_STRUCTURAL_GATE");
    expect(evaluation.computed_scores.passFailReasons).not.toContain("FAIL_MISSION_MIN_THRESHOLD");
    expect(evaluation.computed_scores.passFailReasons).not.toContain("FAIL_NO_STRONG_MISSION_GOAL");
  });

  // ── C: StructuralScore 0.90, MissionImpactScore 0.45 → FAIL_MISSION_MIN_THRESHOLD
  it("C: fails with FAIL_MISSION_MIN_THRESHOLD when weighted mission average < 0.50", () => {
    // mission scores all low → average 0.40 < 0.50; max = 0.70 (exactly on threshold — 0.70 is NOT < 0.70)
    const rawEval = makeRawEval([
      { goal_id: "goal_a", impact_score: 0.70 },
      { goal_id: "goal_b", impact_score: 0.35 },
      { goal_id: "goal_c", impact_score: 0.35 },
      { goal_id: "goal_d", impact_score: 0.20 },
    ]);
    // average = (0.70+0.35+0.35+0.20)/4 = 0.40 < 0.50

    const evaluation = engine.computeEvaluation(rawEval, { missionGoals: fourGoals });

    expect(evaluation.computed_scores.passes_threshold).toBe(false);
    expect(evaluation.computed_scores.passFailReasons).toContain("FAIL_MISSION_MIN_THRESHOLD");
  });

  // ── D: MissionImpactScore 0.75 but max goal 0.60 → FAIL_NO_STRONG_MISSION_GOAL
  it("D: fails with FAIL_NO_STRONG_MISSION_GOAL when no single goal reaches 0.70", () => {
    // All goals at 0.60 → max = 0.60 < 0.70; average = 0.60 ≥ 0.50
    const rawEval = makeRawEval([
      { goal_id: "goal_a", impact_score: 0.60 },
      { goal_id: "goal_b", impact_score: 0.60 },
      { goal_id: "goal_c", impact_score: 0.60 },
      { goal_id: "goal_d", impact_score: 0.60 },
    ]);

    const evaluation = engine.computeEvaluation(rawEval, { missionGoals: fourGoals });

    expect(evaluation.computed_scores.passes_threshold).toBe(false);
    expect(evaluation.computed_scores.passFailReasons).toContain("FAIL_NO_STRONG_MISSION_GOAL");
    expect(evaluation.computed_scores.passFailReasons).not.toContain("FAIL_MISSION_MIN_THRESHOLD");
    expect(evaluation.computed_scores.passFailReasons).not.toContain("FAIL_STRUCTURAL_GATE");
  });

  // ── E: output includes breakdown objects with stable keys ─────────────────
  it("E: output includes missionGoalBreakdown and structuralBreakdown with correct shapes", () => {
    const rawEval = {
      ...makeRawEval([
        { goal_id: "goal_a", impact_score: 0.85, score_reason: "Strong community focus.", evidenceRefs: ["create 5 jobs"] } as any,
        { goal_id: "goal_b", impact_score: 0.70, score_reason: "Moderate asset creation." } as any,
        { goal_id: "goal_c", impact_score: 0.55 },
        { goal_id: "goal_d", impact_score: 0.55 },
      ]),
      structural_scores: {
        ...structuralPassingBase,
        feasibility_rationale: "Clear timeline and realistic budget.",
        feasibility_evidence_refs: ["12-month timeline"],
        risk_rationale: "Low market risk in established sector.",
        risk_evidence_refs: [],
        accountability_rationale: "Milestones defined quarterly.",
        accountability_evidence_refs: ["quarterly reports"],
      },
    };

    const evaluation = engine.computeEvaluation(rawEval, { missionGoals: fourGoals });

    // missionGoalBreakdown
    expect(Array.isArray(evaluation.mission_goal_breakdown)).toBe(true);
    expect(evaluation.mission_goal_breakdown).toHaveLength(4);
    const mbA = evaluation.mission_goal_breakdown.find((b: any) => b.goal_id === "goal_a");
    expect(mbA).toBeDefined();
    expect(mbA.score).toBeCloseTo(0.85, 2);
    expect(typeof mbA.weight).toBe("number");
    expect(typeof mbA.rationale).toBe("string");
    expect(Array.isArray(mbA.evidenceRefs)).toBe(true);
    expect(mbA.evidenceRefs).toContain("create 5 jobs");

    // structuralBreakdown
    expect(Array.isArray(evaluation.structural_breakdown)).toBe(true);
    expect(evaluation.structural_breakdown).toHaveLength(3);
    const factors = evaluation.structural_breakdown.map((b: any) => b.factor);
    expect(factors).toContain("feasibility");
    expect(factors).toContain("risk");
    expect(factors).toContain("accountability");

    const feasBreakdown = evaluation.structural_breakdown.find((b: any) => b.factor === "feasibility");
    expect(feasBreakdown.rationale).toBe("Clear timeline and realistic budget.");
    expect(feasBreakdown.evidenceRefs).toContain("12-month timeline");

    // risk score is inverted: 1 - 0.20 = 0.80
    const riskBreakdown = evaluation.structural_breakdown.find((b: any) => b.factor === "risk");
    expect(riskBreakdown.score).toBeCloseTo(0.80, 2);

    // passFailReasons must be an array with stable string keys
    expect(Array.isArray(evaluation.computed_scores.passFailReasons)).toBe(true);
    evaluation.computed_scores.passFailReasons.forEach((r: string) => {
      expect(["FAIL_STRUCTURAL_GATE", "FAIL_MISSION_MIN_THRESHOLD", "FAIL_NO_STRONG_MISSION_GOAL"]).toContain(r);
    });
  });

  // ── Extra: weight normalization ─────────────────────────────────────────────
  it("normalizes mission goal weights that do not sum to 1.0", () => {
    // Weights: 2, 1, 1, 1 → sum = 5 → normalized: 0.40, 0.20, 0.20, 0.20
    const unequalGoals = [
      { key: "goal_a", label: "A", priorityWeight: 2 },
      { key: "goal_b", label: "B", priorityWeight: 1 },
      { key: "goal_c", label: "C", priorityWeight: 1 },
      { key: "goal_d", label: "D", priorityWeight: 1 },
    ];
    const rawEval = makeRawEval([
      { goal_id: "goal_a", impact_score: 1.0 },
      { goal_id: "goal_b", impact_score: 0.0 },
      { goal_id: "goal_c", impact_score: 0.0 },
      { goal_id: "goal_d", impact_score: 0.0 },
    ]);

    const evaluation = engine.computeEvaluation(rawEval, { missionGoals: unequalGoals });

    // normalized weights: 2/5=0.40, 1/5=0.20, 1/5=0.20, 1/5=0.20
    // mission_weighted_score = 1.0*0.40 + 0 + 0 + 0 = 0.40
    expect(evaluation.computed_scores.mission_weighted_score).toBeCloseTo(0.40, 2);

    // stored goal_priority_weight should be the normalized value
    const goalA = evaluation.mission_impact_scores.find((s: any) => s.goal_id === "goal_a");
    expect(goalA?.goal_priority_weight).toBeCloseTo(0.40, 2);
  });

  // ── Extra: custom thresholds respected ────────────────────────────────────
  it("respects custom strongGoalThreshold config override", () => {
    // maxGoalScore = 0.65 — fails default 0.70 but passes custom 0.60
    const rawEval = makeRawEval([
      { goal_id: "goal_a", impact_score: 0.65 },
      { goal_id: "goal_b", impact_score: 0.65 },
      { goal_id: "goal_c", impact_score: 0.65 },
      { goal_id: "goal_d", impact_score: 0.65 },
    ]);

    const withDefault = engine.computeEvaluation(rawEval, { missionGoals: fourGoals });
    expect(withDefault.computed_scores.passFailReasons).toContain("FAIL_NO_STRONG_MISSION_GOAL");

    const withCustom = engine.computeEvaluation(rawEval, {
      missionGoals: fourGoals,
      strongGoalThreshold: 0.60,
    });
    expect(withCustom.computed_scores.passFailReasons).not.toContain("FAIL_NO_STRONG_MISSION_GOAL");
    expect(withCustom.computed_scores.passes_threshold).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Missing-data severity & budget tier tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Missing data severity classification and budget tiers", () => {
  let engine: any;

  beforeEach(async () => {
    const mod = await import("../proposal-engine.js");
    engine = new mod.ProposalEngine();
  });

  // Shared passing evaluation fixture
  const passingEval = {
    structural_scores: {
      goal_mapping_valid: true,
      feasibility_score: 0.75,
      risk_score: 0.25,
      accountability_score: 0.70,
    },
    mission_impact_scores: [
      { goal_id: "income_stability",  impact_score: 0.80 },
      { goal_id: "asset_creation",    impact_score: 0.75 },
      { goal_id: "leakage_reduction", impact_score: 0.60 },
    ],
    computed_scores: {
      overall_score: 0.75,
      structural_weighted_score: 0.72,
      mission_weighted_score: 0.72,
      passes_threshold: true,
      goal_mapping_valid: true,
      passFailReasons: [] as string[],
    },
    risk_flags: [],
    violations: [],
    mission_goal_breakdown: [],
    structural_breakdown: [],
  };

  // ── determineBudgetTier ────────────────────────────────────────────────────

  it("determineBudgetTier: budget below aiAutoApproveThreshold → Tier 1", () => {
    const tier = engine.determineBudgetTier(300, {
      aiAutoApproveThresholdUSD: 500,
      councilVoteThresholdUSD: 5000,
    });
    expect(tier).toBe(1);
  });

  it("determineBudgetTier: budget between thresholds → Tier 2", () => {
    const tier = engine.determineBudgetTier(2500, {
      aiAutoApproveThresholdUSD: 500,
      councilVoteThresholdUSD: 5000,
    });
    expect(tier).toBe(2);
  });

  it("determineBudgetTier: budget at or above councilVoteThreshold → Tier 3", () => {
    const tierAtBoundary = engine.determineBudgetTier(5000, {
      aiAutoApproveThresholdUSD: 500,
      councilVoteThresholdUSD: 5000,
    });
    expect(tierAtBoundary).toBe(3);

    const tierAbove = engine.determineBudgetTier(50000, {
      aiAutoApproveThresholdUSD: 500,
      councilVoteThresholdUSD: 5000,
    });
    expect(tierAbove).toBe(3);
  });

  // ── decideWithAlternatives — SOFT items do NOT block ──────────────────────

  it("Tier 1 — SOFT missing: proposal with passing scores can still advance", () => {
    const softMissing = [
      { field: "Team bio", question: "Who is on the team?", why_needed: "Improves accountability score", severity: "SOFT" as const },
    ];
    const { decision } = engine.decideWithAlternatives(passingEval, [], softMissing);
    expect(decision).toBe("advance");
  });

  it("Tier 2 — multiple SOFT items: proposal can still advance", () => {
    const softMissing = [
      { field: "Timeline", question: "When does each phase start?", why_needed: "Improves feasibility", severity: "SOFT" as const },
      { field: "Market research", question: "What is the market size?", why_needed: "Validates demand", severity: "SOFT" as const },
    ];
    const { decision } = engine.decideWithAlternatives(passingEval, [], softMissing);
    expect(decision).toBe("advance");
  });

  it("INFO missing: proposal advances without penalty", () => {
    const infoMissing = [
      { field: "Logo", question: "Do you have a logo?", why_needed: "Nice to have", severity: "INFO" as const },
    ];
    const { decision } = engine.decideWithAlternatives(passingEval, [], infoMissing);
    expect(decision).toBe("advance");
  });

  // ── decideWithAlternatives — BLOCKER items force needs_info ───────────────

  it("Tier 1 — BLOCKER missing: decision is needs_info even when scores pass", () => {
    const blockerMissing = [
      { field: "Budget", question: "How much is requested?", why_needed: "Cannot score without a budget", severity: "BLOCKER" as const, blocking: true },
    ];
    const { decision } = engine.decideWithAlternatives(passingEval, [], blockerMissing);
    expect(decision).toBe("needs_info");
  });

  it("Tier 2 — BLOCKER missing: decision is needs_info", () => {
    const blockerMissing = [
      { field: "Financial plan", question: "Where does the money go?", why_needed: "No financial plan", severity: "BLOCKER" as const, blocking: true },
    ];
    const { decision } = engine.decideWithAlternatives(passingEval, [], blockerMissing);
    expect(decision).toBe("needs_info");
  });

  it("Tier 3 — BLOCKER missing: decision is needs_info", () => {
    const blockerMissing = [
      { field: "Procurement plan", question: "How will vendors be selected?", why_needed: "Required for council vote", severity: "BLOCKER" as const, blocking: true },
      { field: "Escrow schedule", question: "What are the milestone-release conditions?", why_needed: "Required for large spend", severity: "BLOCKER" as const, blocking: true },
    ];
    const { decision } = engine.decideWithAlternatives(passingEval, [], blockerMissing);
    expect(decision).toBe("needs_info");
  });

  it("Mixed SOFT + BLOCKER: BLOCKER wins — decision is needs_info", () => {
    const mixed = [
      { field: "Team bio", question: "Who leads?", why_needed: "Improves score", severity: "SOFT" as const },
      { field: "Procurement plan", question: "How vendors selected?", why_needed: "Required", severity: "BLOCKER" as const, blocking: true },
    ];
    const { decision } = engine.decideWithAlternatives(passingEval, [], mixed);
    expect(decision).toBe("needs_info");
  });

  // ── applyMissingDataPenalties — structural score reduction ────────────────

  it("1 SOFT item reduces structural_weighted_score by 0.05", () => {
    const softMissing = [
      { field: "Timeline", question: "?", why_needed: "y", severity: "SOFT" as const },
    ];
    const penalized = engine.applyMissingDataPenalties(passingEval, softMissing);
    expect(penalized.computed_scores.structural_weighted_score).toBeCloseTo(
      passingEval.computed_scores.structural_weighted_score - 0.05,
      2,
    );
  });

  it("5 SOFT items cap structural penalty at 0.20", () => {
    const softMissing = Array.from({ length: 5 }, (_, i) => ({
      field: `Item ${i}`,
      question: "?",
      why_needed: "y",
      severity: "SOFT" as const,
    }));
    const penalized = engine.applyMissingDataPenalties(passingEval, softMissing);
    const reduction = passingEval.computed_scores.structural_weighted_score - penalized.computed_scores.structural_weighted_score;
    expect(reduction).toBeCloseTo(0.20, 2);
  });

  it("BLOCKER items do NOT reduce structural score", () => {
    const blockerMissing = [
      { field: "Budget", question: "?", why_needed: "y", severity: "BLOCKER" as const, blocking: true },
    ];
    const penalized = engine.applyMissingDataPenalties(passingEval, blockerMissing);
    expect(penalized.computed_scores.structural_weighted_score).toBe(
      passingEval.computed_scores.structural_weighted_score,
    );
  });

  it("INFO items do NOT reduce structural score", () => {
    const infoMissing = [
      { field: "Logo", question: "?", why_needed: "y", severity: "INFO" as const },
    ];
    const penalized = engine.applyMissingDataPenalties(passingEval, infoMissing);
    expect(penalized.computed_scores.structural_weighted_score).toBe(
      passingEval.computed_scores.structural_weighted_score,
    );
  });

  it("SOFT item with affectedGoalIds reduces that goal's impact_score", () => {
    const softMissing = [
      {
        field: "Market data",
        question: "What is the market size?",
        why_needed: "Needed to score income_stability goal",
        severity: "SOFT" as const,
        affectedGoalIds: ["income_stability"],
      },
    ];
    const penalized = engine.applyMissingDataPenalties(passingEval, softMissing);
    const original = passingEval.mission_impact_scores.find((m: any) => m.goal_id === "income_stability")!.impact_score;
    const updated = penalized.mission_impact_scores.find((m: any) => m.goal_id === "income_stability").impact_score;
    expect(updated).toBeCloseTo(original - 0.05, 2);
  });

  // ── Full tier scenario: Tier 3 proposal with SOFT missing can still advance ─

  it("Tier 3 — SOFT missing does not block (structural score penalty only)", () => {
    const tier3Eval = {
      ...passingEval,
      computed_scores: { ...passingEval.computed_scores, structural_weighted_score: 0.80 },
    };
    const softItems = [
      { field: "Vendor quotes", question: "Do you have vendor quotes?", why_needed: "Improves feasibility", severity: "SOFT" as const },
      { field: "Risk register", question: "What are the risks?", why_needed: "Improves accountability", severity: "SOFT" as const },
    ];
    // Apply penalties first, then decide
    const penalized = engine.applyMissingDataPenalties(tier3Eval, softItems);
    const { decision } = engine.decideWithAlternatives(penalized, [], softItems);
    expect(decision).not.toBe("needs_info");
    // Structural score is reduced by 2 × 0.05
    expect(penalized.computed_scores.structural_weighted_score).toBeCloseTo(0.70, 2);
  });
});
