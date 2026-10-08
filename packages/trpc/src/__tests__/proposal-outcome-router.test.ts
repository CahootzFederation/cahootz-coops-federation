import { beforeEach, describe, expect, it, vi } from "vitest";

const processProposal = vi.hoisted(() => vi.fn());
const outcomes = vi.hoisted(() => ({
  findPriorProposalOutcomes: vi.fn(),
  startProposalOutcomeTracking: vi.fn().mockResolvedValue({ started: 1 }),
  reportKpiOutcome: vi.fn(),
}));

const moduleDb = vi.hoisted(() => ({ sageDecisionTrail: { create: vi.fn().mockResolvedValue({ id: "trail" }) } }));
vi.mock("@repo/db", async () => {
  const prisma = await import("@prisma/client");
  return {
    db: moduleDb, Prisma: prisma.Prisma, ProposalStatus: prisma.ProposalStatus, ProposalCategory: prisma.ProposalCategory,
    ProposerRole: prisma.ProposerRole, Currency: prisma.Currency, VoteType: prisma.VoteType,
  };
});
vi.mock("@repo/validators", async (importOriginal) => {
  const original = await importOriginal() as Record<string, unknown>;
  return { ...original, proposalEngine: { processProposal, evaluateComment: vi.fn() } };
});
vi.mock("../services/proposal-outcomes.js", async (importOriginal) => {
  const original = await importOriginal() as Record<string, unknown>;
  return { ...original, ...outcomes };
});
vi.mock("../services/ai-cost.js", () => ({ withCostedProposalRun: (_coopId: string, _key: string, run: () => unknown) => run() }));
vi.mock("../services/ai-evaluation-log.js", () => ({ recordAIEvaluation: vi.fn().mockResolvedValue({}) }));
vi.mock("../services/admin-verification.js", () => ({ checkAdminStatusWithRole: vi.fn().mockResolvedValue({ isAdmin: true, role: "admin" }) }));

const { proposalRouter } = await import("../routers/proposal.js");
const { OutcomeReportError } = await import("../services/proposal-outcomes.js");

const WALLET = "0x1234567890123456789012345678901234567890";
const NOW = new Date("2026-10-07T12:00:00.000Z");

const engineOutput = {
  id: "prop_new", createdAt: NOW.toISOString(), status: "votable", title: "Second community fridge", summary: "A fridge downtown",
  category: "other", proposer: { wallet: WALLET, role: "member" }, region: { code: "US", name: "United States" },
  budget: { currency: "USD", amountRequested: 300 },
  evaluation: {
    structural_scores: { goal_mapping_valid: true, feasibility_score: 0.7, risk_score: 0.3, accountability_score: 0.6 },
    mission_impact_scores: [], mission_goal_breakdown: [], structural_breakdown: [],
    computed_scores: { mission_weighted_score: 0.7, structural_weighted_score: 0.7, overall_score: 0.7, passes_threshold: true, passFailReasons: [] },
    violations: [], risk_flags: [], llm_summary: "Solid.",
  },
  governance: { quorumPercent: 20, approvalThresholdPercent: 60, votingWindowDays: 7 },
  audit: { engineVersion: "proposal-engine@2.0.0", checks: [{ name: "basic_validation", passed: true }] },
  alternatives: [], decision: "advance", decisionReasons: [], missing_data: [], councilRequired: false,
  kpis: [{ name: "Meals served", target: 500, unit: "count", higherIsBetter: true, measureAfterDays: 60 }, { name: "Jobs", target: 1, unit: "jobs", higherIsBetter: true, measureAfterDays: 90 }],
  priorOutcomes: [{ text: "[PROPOSAL OUTCOME] · \"Community fridge\" · Meals served: 300 of 500 target, partly met (10d ago)", sourceIds: ["prop-1"], ageDays: 10 }],
};

function dbRow(data: Record<string, any>) {
  return {
    ...data, createdAt: NOW, updatedAt: NOW, proposerRole: "MEMBER", budgetCurrency: "USD", category: "OTHER", auditChecks: [],
    kpis: (data.kpis?.createMany?.data ?? []).map((kpi: any, index: number) => ({ id: `kpi-${index}`, measureBy: null, outcome: null, ...kpi })),
  };
}

function makeDb() {
  let saved: any = null;
  return {
    user: { findFirst: vi.fn().mockResolvedValue({ id: "author-1" }) },
    userCoopMembership: { findUnique: vi.fn().mockResolvedValue({ status: "ACTIVE" }) },
    coopConfig: { findFirst: vi.fn().mockResolvedValue(null) },
    proposal: {
      create: vi.fn().mockImplementation(({ data }) => { saved = dbRow(data); return Promise.resolve(saved); }),
      findUnique: vi.fn().mockImplementation(() => Promise.resolve(saved)),
      update: vi.fn(),
    },
    proposalRevision: { create: vi.fn() },
    proposalGoalScore: { deleteMany: vi.fn(), createMany: vi.fn() },
    proposalVote: { upsert: vi.fn(), count: vi.fn() },
    setSaved: (row: any) => { saved = row; },
  };
}

function caller(db: ReturnType<typeof makeDb>) {
  return proposalRouter.createCaller({ db, req: { headers: { "x-wallet-address": WALLET } }, res: {}, coopId: "cahootz" } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  processProposal.mockResolvedValue(engineOutput);
  outcomes.findPriorProposalOutcomes.mockResolvedValue(engineOutput.priorOutcomes);
});

describe("proposal.create keeps KPIs and cites similar past outcomes", () => {
  it("gives the engine this Commons' memory lookup, stores KPIs and prior outcomes, and starts checks when auto-approved", async () => {
    const db = makeDb();
    const result = await caller(db).create({ text: "Proposal Title: Second community fridge\nSummary: A fridge downtown", coopId: "harbor", proposer: { wallet: WALLET, role: "member" }, region: { code: "US", name: "United States" } });

    const options = processProposal.mock.calls[0]![2];
    await options.priorOutcomes({ title: "Second community fridge", summary: "A fridge downtown", category: "other" });
    expect(outcomes.findPriorProposalOutcomes).toHaveBeenCalledWith({ coopId: "harbor", about: expect.objectContaining({ title: "Second community fridge" }), excludeProposalId: undefined });

    const data = db.proposal.create.mock.calls[0]![0].data;
    expect(data.kpis.createMany.data).toEqual([
      { name: "Meals served", target: 500, unit: "COUNT", higherIsBetter: true, measureAfterDays: 60 },
      { name: "Jobs", target: 1, unit: "JOBS", higherIsBetter: true, measureAfterDays: 90 },
    ]);
    expect(data.priorOutcomes).toEqual(engineOutput.priorOutcomes);
    // $300 is under the default $500 auto-approval tier.
    expect(data.status).toBe("APPROVED");
    expect(outcomes.startProposalOutcomeTracking).toHaveBeenCalledWith("prop_new");

    expect(result.kpis.map((kpi) => [kpi.name, kpi.unit])).toEqual([["Meals served", "count"], ["Jobs", "jobs"]]);
    expect(result.priorOutcomes[0]!.text).toMatch(/Community fridge.*partly met/);
    // The proposal's decision trail cites the remembered outcome as evidence.
    const trail = moduleDb.sageDecisionTrail.create.mock.calls[0]![0].data;
    expect(JSON.stringify(trail.steps)).toContain("Results of 1 similar past proposal from Sage's memory");
  });

  it("doesn't start checks for a proposal that still needs a vote", async () => {
    processProposal.mockResolvedValue({ ...engineOutput, budget: { currency: "USD", amountRequested: 2000 } });
    await caller(makeDb()).create({ text: "Proposal Title: Second community fridge\nSummary: A fridge downtown", coopId: "harbor", proposer: { wallet: WALLET, role: "member" }, region: { code: "US", name: "United States" } });
    expect(outcomes.startProposalOutcomeTracking).not.toHaveBeenCalled();
  });
});

describe("approval paths start outcome checks", () => {
  it("a council approval starts them", async () => {
    const db = makeDb();
    db.proposal.findUnique.mockResolvedValue({ id: "prop_1", coopId: "cahootz", councilRequired: true, status: "VOTABLE", votingEndsAt: new Date(Date.now() + 86_400_000) });
    db.proposalVote.count.mockResolvedValueOnce(2).mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    await expect(caller(db).councilVote({ proposalId: "prop_1", vote: "FOR" })).resolves.toMatchObject({ newStatus: "approved" });
    expect(outcomes.startProposalOutcomeTracking).toHaveBeenCalledWith("prop_1");
  });
});

describe("proposal.reportKpiOutcome", () => {
  it("records the author's report and returns the updated proposal", async () => {
    const db = makeDb();
    db.setSaved(dbRow({ id: "prop-1", title: "Community fridge", summary: "s", status: "FUNDED", proposerWallet: WALLET, regionCode: "US", regionName: "United States", budgetAmount: 1200, quorumPercent: 20, approvalThresholdPercent: 60, votingWindowDays: 7, engineVersion: "x", decisionReasons: [] }));
    outcomes.reportKpiOutcome.mockResolvedValue({ proposalId: "prop-1" });
    const result = await caller(db).reportKpiOutcome({ kpiId: "kpi-1", actualValue: 300, note: "Fridge broke" });
    expect(outcomes.reportKpiOutcome).toHaveBeenCalledWith({ kpiId: "kpi-1", userId: "author-1", actualValue: 300, note: "Fridge broke" });
    expect(result.id).toBe("prop-1");
  });

  it("turns a refusal into a clear error", async () => {
    outcomes.reportKpiOutcome.mockRejectedValue(new OutcomeReportError("FORBIDDEN", "Only the proposal's author can report its results."));
    await expect(caller(makeDb()).reportKpiOutcome({ kpiId: "kpi-1", actualValue: 300 })).rejects.toMatchObject({ code: "FORBIDDEN", message: "Only the proposal's author can report its results." });
  });
});
