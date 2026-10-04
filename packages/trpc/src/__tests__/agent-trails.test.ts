import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ sageDecisionTrail: { create: vi.fn().mockResolvedValue({ id: "trail-1" }) } }));
vi.mock("@repo/db", () => ({ db }));

const { buildProposalEngineTrail, buildProposalEngineFailureTrail, buildCommentEvaluationTrail, alignmentForScore } = await import("../services/proposal-trails.js");
const { traceSageReply, recordSkippedCircleMention } = await import("../services/sage-reply-trails.js");

beforeEach(() => vi.clearAllMocks());

const missionGoals = [{ key: "food", label: "Food access" }, { key: "jobs", label: "Local jobs" }];

function engineOutput(overrides: Record<string, unknown> = {}) {
  return {
    id: "prop_abc123", createdAt: "2026-10-04T00:00:00.000Z", status: "votable",
    title: "Community fridge", summary: "Stock a shared fridge", proposer: { wallet: "0xabc", role: "member" },
    region: { code: "US", name: "United States" }, category: "community", budget: { currency: "USD", amountRequested: 1200 },
    evaluation: {
      structural_scores: { goal_mapping_valid: true, feasibility_score: 0.8, risk_score: 0.2, accountability_score: 0.7 },
      mission_impact_scores: [],
      computed_scores: { mission_weighted_score: 0.72, structural_weighted_score: 0.6, overall_score: 0.68, passes_threshold: false, passFailReasons: ["FAIL_STRUCTURAL_GATE"] },
      violations: [], risk_flags: ["Ongoing restocking cost"], llm_summary: "Useful but under-planned.",
      mission_goal_breakdown: [{ goal_id: "food", score: 0.85, weight: 0.6, rationale: "Directly feeds members", evidenceRefs: ["shared fridge"] }],
      structural_breakdown: [{ factor: "feasibility", score: 0.8, weight: 0.4, rationale: "Simple", evidenceRefs: [] }],
    },
    governance: { quorumPercent: 20, approvalThresholdPercent: 60, votingWindowDays: 7 },
    audit: { engineVersion: "proposal-engine@2.0.0", checks: [{ name: "sector_exclusion_screen", passed: true, note: null }, { name: "unrealistic_claims_detected", passed: false, note: "Claims 100% food security" }] },
    alternatives: [{ label: "Pilot for one month", changes: [], overallScore: null, rationale: "Test demand before committing" }],
    decision: "revise", decisionReasons: ["Structural score below the gate"],
    missing_data: [{ field: "maintenance", question: "Who restocks it?", why_needed: "Ongoing cost", severity: "BLOCKER" }],
    councilRequired: false, rawText: "Proposal Title: Community fridge",
    ...overrides,
  } as never;
}

const proposalContext = {
  coopId: "harbor", proposalId: "prop_abc123", trigger: "PROPOSAL_SUBMITTED" as const, rawText: "Proposal Title: Community fridge…",
  charterVersion: 3, missionGoals, expertCalibrationCount: 2,
  thresholds: { structuralGate: 0.65, missionMinThreshold: 0.5, strongGoalThreshold: 0.7 },
  aiAutoApproveThresholdUSD: 500, councilVoteThresholdUSD: 5000, finalStatus: "SUBMITTED", councilRequired: false,
};

describe("proposal engine trail", () => {
  it("records each score, every gate and check, and the decision", () => {
    const { steps, outcome, proposalId, visibility, agent } = buildProposalEngineTrail(engineOutput(), proposalContext).snapshot();
    expect({ proposalId, visibility, agent }).toEqual({ proposalId: "prop_abc123", visibility: "COMMONS_MEMBERS", agent: "proposal-engine" });
    expect(steps.find((step) => step.label.startsWith("Food access: 85%"))).toMatchObject({ stage: "CONSIDERED", detail: expect.stringContaining('"shared fridge"') });
    expect(steps.find((step) => step.label === "Structural score meets the gate (65%+)")).toMatchObject({ outcome: "FAIL", detail: "Structural score 60%" });
    expect(steps.find((step) => step.label === "Mission score meets the minimum (50%+)")).toMatchObject({ outcome: "PASS" });
    expect(steps.find((step) => step.label === "No unrealistic claims")).toMatchObject({ outcome: "FAIL", detail: "Claims 100% food security" });
    expect(steps.find((step) => step.label === "Structure, feasibility: 80% (weight 40%)")).toBeTruthy();
    expect(steps.find((step) => step.label === "No blocking information is missing")).toMatchObject({ outcome: "FAIL", detail: "Who restocks it?" });
    expect(steps.find((step) => step.label.startsWith("Alternative: Pilot"))).toBeTruthy();
    expect(steps.find((step) => step.stage === "EVIDENCE" && step.label.includes("2 past expert corrections"))).toBeTruthy();
    expect(outcome).toBe("Send it back for revision → submitted (waiting on the proposer)");
  });

  it("explains the budget tier when the engine advances a proposal", () => {
    const { steps } = buildProposalEngineTrail(engineOutput({ decision: "advance", missing_data: [] }),
      { ...proposalContext, finalStatus: "VOTABLE", councilRequired: true }).snapshot();
    expect(steps.find((step) => step.label === "Budget is under the auto-approve limit ($500)")).toMatchObject({ outcome: "FAIL", detail: "Budget $1,200" });
    expect(steps.find((step) => step.label.includes("council vote"))).toBeTruthy();
    expect(steps.at(-1)).toMatchObject({ stage: "TAKEN", label: "Decision: Advance it → open for voting, council review required" });
  });

  it("records the rewrite when an alternative is applied, and failures without leaking the error", () => {
    const rewrite = buildProposalEngineTrail(engineOutput(), { ...proposalContext, trigger: "PROPOSAL_ALTERNATIVE_APPLIED", rewrite: { label: "Pilot for one month", rationale: "Test demand" } }).snapshot();
    expect(rewrite.steps.find((step) => step.label === 'Rewrote the proposal around the alternative "Pilot for one month"')).toBeTruthy();
    const failed = buildProposalEngineFailureTrail(proposalContext, new Error("model timeout")).snapshot();
    expect(failed.outcome).toBe("Review failed");
    expect(failed.steps.find((step) => step.detail === "model timeout")).toMatchObject({ adminOnly: true });
  });
});

describe("comment evaluation trail", () => {
  const context = { coopId: "harbor", proposalId: "prop_abc123", proposalTitle: "Community fridge", commentId: "c1", content: "Great for families", missionGoals, charterLength: 5200 };

  it("flags a label that contradicts the score", () => {
    expect(alignmentForScore(0.6)).toBe("ALIGNED");
    expect(alignmentForScore(0.59)).toBe("NEUTRAL");
    const consistent = buildCommentEvaluationTrail({ alignment: "ALIGNED", score: 0.8, analysis: "Supports food access.", goalsImpacted: ["food"] }, context).snapshot();
    expect(consistent.steps.find((step) => step.stage === "POLICY")).toMatchObject({ outcome: "PASS" });
    expect(consistent.steps.find((step) => step.label === "Goals it touches: Food access")).toBeTruthy();
    expect(consistent.steps.find((step) => step.stage === "EVIDENCE")!.label).toContain("first 2,000 of the charter's 5,200 characters");
    const contradictory = buildCommentEvaluationTrail({ alignment: "ALIGNED", score: 0.2, analysis: "x", goalsImpacted: [] }, context).snapshot();
    expect(contradictory.steps.find((step) => step.stage === "POLICY")).toMatchObject({ outcome: "FAIL", detail: "A 20% score is misaligned, but the label is aligned" });
  });
});

describe("Sage reply trail", () => {
  const grounding = { charterChars: 1800, missionGoalCount: 4, model: "gpt-5.2", usedFallback: false };

  it("records a DM reply, visible only within that conversation", async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    await traceSageReply({ kind: "dm", coopId: "harbor", groupId: "dm-1", messageId: "m1" },
      { message: "When is the next vote?", threadContext: "You: hi", threadCount: 1 },
      async () => ({ reply: "The charter sets a 7-day voting window.", grounding }), publish);
    expect(publish).toHaveBeenCalledWith("The charter sets a 7-day voting window.");
    const data = db.sageDecisionTrail.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({ agent: "sage-reply", sourceType: "sage_dm", circleId: "dm-1", visibility: "CIRCLE", trigger: "SAGE_DM", outcome: "Replied in the direct message" });
    expect(data.steps.map((step: { stage: string }) => step.stage)).toEqual(["OBSERVED", "EVIDENCE", "POLICY", "POLICY", "EVIDENCE", "CONSIDERED", "POLICY", "POLICY", "TAKEN", "RESULT", "FOLLOW_UP"]);
  });

  it("flags the fallback reply and records failures before rethrowing", async () => {
    await traceSageReply({ kind: "post", coopId: "harbor", postId: "p1" }, { message: "@sage?", threadCount: 0 },
      async () => ({ reply: "I don't have a grounded answer…", grounding: { ...grounding, usedFallback: true } }), async () => {});
    const fallback = db.sageDecisionTrail.create.mock.calls[0]![0].data;
    expect(fallback).toMatchObject({ visibility: "COMMONS_MEMBERS", relatedPostIds: ["p1"] });
    expect(fallback.steps.find((step: { label: string }) => step.label === "The model gave an answer")).toMatchObject({ outcome: "FAIL" });

    await expect(traceSageReply({ kind: "comment", coopId: "harbor", postId: "p1", commentId: "c1" }, { message: "@sage", threadCount: 2 },
      async () => { throw new Error("rate limited"); }, async () => {})).rejects.toThrow("rate limited");
    expect(db.sageDecisionTrail.create.mock.calls[1]![0].data).toMatchObject({ outcome: "Reply failed" });
  });

  it("records why Sage didn't answer an @mention in a circle", async () => {
    await recordSkippedCircleMention({ coopId: "harbor", circleId: "circle-1", postId: "p2", sourceId: "p2", kind: "post" }, "@sage help");
    expect(db.sageDecisionTrail.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      visibility: "CIRCLE", circleId: "circle-1", outcome: "Didn't reply: @mentions in circles aren't answered",
    }), select: { id: true } });
  });
});
