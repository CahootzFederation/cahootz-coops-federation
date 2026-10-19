import { beforeEach, describe, expect, it, vi } from "vitest";

// One mock client serves both the router's ctx.db and services that import db directly.
const db = vi.hoisted(() => {
  const models: Record<string, Record<string, ReturnType<typeof vi.fn>>> = {};
  const model = (name: string) => (models[name] ??= new Proxy({}, {
    get: (target: Record<string, ReturnType<typeof vi.fn>>, method: string) => (target[method] ??= vi.fn().mockResolvedValue(method === "findMany" ? [] : method === "count" ? 0 : null)),
  }) as Record<string, ReturnType<typeof vi.fn>>);
  return { models, client: new Proxy({}, { get: (_target, name: string) => model(name) }) as any };
});
const processProposal = vi.hoisted(() => vi.fn());
const queueAmendmentForProposal = vi.hoisted(() => vi.fn());
const announceProposalVote = vi.hoisted(() => vi.fn());
vi.mock("../services/proposal-notifications.js", () => ({ announceProposalVote }));

vi.mock("@repo/db", () => ({
  db: db.client,
  ProposalStatus: { SUBMITTED: "SUBMITTED", VOTABLE: "VOTABLE", APPROVED: "APPROVED", FUNDED: "FUNDED", REJECTED: "REJECTED", FAILED: "FAILED", WITHDRAWN: "WITHDRAWN" },
  ProposalCategory: { BUSINESS_FUNDING: "BUSINESS_FUNDING", GOVERNANCE: "GOVERNANCE", OTHER: "OTHER" },
  ProposerRole: { MEMBER: "MEMBER" },
  Currency: { USD: "USD" },
  VoteType: { FOR: "FOR", AGAINST: "AGAINST", ABSTAIN: "ABSTAIN" },
}));
vi.mock("@repo/validators", async (importOriginal) => {
  const original = await importOriginal<typeof import("@repo/validators")>();
  return { ...original, proposalEngine: { ...original.proposalEngine, processProposal } };
});
vi.mock("../services/admin-verification.js", () => ({ checkAdminStatusWithRole: vi.fn().mockResolvedValue({ isAdmin: true, role: "admin" }) }));
vi.mock("../services/ai-evaluation-log.js", () => ({ recordAIEvaluation: vi.fn().mockResolvedValue(undefined) }));
const costedRun = vi.hoisted(() => vi.fn((_coopId: string, _feature: string, fn: () => unknown) => fn()));
vi.mock("../services/ai-cost.js", () => ({ withCostedProposalRun: costedRun }));
vi.mock("../services/sage-goal-ideas.js", async () => {
  const actual = await vi.importActual<typeof import("../services/sage-goal-ideas.js")>("../services/sage-goal-ideas.js");
  return { ...actual, queueAmendmentForProposal };
});

const { createProposalFromText, proposalRouter } = await import("../routers/proposal.js");

const WALLET = "0x1234567890123456789012345678901234567890";

function engineOutput(budget: number) {
  return {
    id: "prop_new", createdAt: "2026-10-18T00:00:00.000Z", status: "votable", title: "Weekly check-in thread", summary: "A Monday thread.",
    category: "other", proposer: { wallet: WALLET, role: "member", displayName: "Maya" }, region: { code: "US", name: "United States" },
    budget: { currency: "USD", amountRequested: budget },
    evaluation: {
      structural_scores: { goal_mapping_valid: true, feasibility_score: 0.8, risk_score: 0.2, accountability_score: 0.7 },
      mission_impact_scores: [], computed_scores: { mission_weighted_score: 0.7, structural_weighted_score: 0.8, overall_score: 0.75, passes_threshold: true },
      violations: [], risk_flags: [], llm_summary: "Good.",
    },
    governance: { quorumPercent: 20, approvalThresholdPercent: 60, votingWindowDays: 7 },
    audit: { engineVersion: "proposal-engine@2.0.0", checks: [] },
    alternatives: [], bestAlternative: null, decision: "advance", decisionReasons: [], missing_data: [], councilRequired: false,
  };
}

function caller() {
  return proposalRouter.createCaller({ db: db.client, req: { headers: { "x-wallet-address": WALLET } }, res: {}, coopId: "harbor" } as any);
}

beforeEach(() => {
  for (const name of Object.keys(db.models)) delete db.models[name];
  vi.clearAllMocks();
  processProposal.mockResolvedValue(engineOutput(0));
  queueAmendmentForProposal.mockResolvedValue(true);
  db.client.user.findFirst.mockResolvedValue({ id: "maya", deletedAt: null });
  db.client.userCoopMembership.findUnique.mockResolvedValue({ status: "ACTIVE" });
  db.client.coopConfig.findFirst.mockResolvedValue({ id: "cfg-1", version: 4, aiAutoApproveThresholdUSD: 500, councilVoteThresholdUSD: 5000, missionGoals: [], structuralWeights: {}, scoreMix: {}, proposalCategories: [], sectorExclusions: [] });
  db.client.coopConfig.findMany.mockResolvedValue([]);
  db.client.proposal.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...data, id: "prop_new" }));
  db.client.proposal.findUnique.mockImplementation(async () => ({
    id: "prop_new", createdAt: new Date(), updatedAt: new Date(), status: db.client.proposal.create.mock.calls[0]?.[0].data.status ?? "SUBMITTED",
    coopId: "harbor", title: "Weekly check-in thread", summary: "A Monday thread.", category: "OTHER", categoryKey: "other", proposerWallet: WALLET,
    proposerRole: "MEMBER", proposerDisplayName: "Maya", regionCode: "US", regionName: "United States", budgetCurrency: "USD", budgetAmount: 0,
    evaluation: null, quorumPercent: 20, approvalThresholdPercent: 60, votingWindowDays: 7, votingEndsAt: null, engineVersion: "x",
    auditChecks: [], kpis: [], decisionReasons: [], councilRequired: true,
  }));
  db.client.commonsProposalDraft.updateMany.mockResolvedValue({ count: 1 });
  db.client.proposalComment.findMany.mockResolvedValue([]);
  db.client.proposalRevision.findMany.mockResolvedValue([]);
});

describe("sending a Sage idea", () => {
  it("never lets the engine approve a Sage idea without a member vote, and marks the draft sent", async () => {
    db.client.commonsProposalDraft.findFirst.mockResolvedValue({ id: "draft-1", kind: "PROGRAM", ideaPostId: "idea-post-1" });
    await caller().create({ text: "Proposal Title: Weekly check-in thread\n\nA Monday thread where everyone shares one thing.", coopId: "harbor", commonsDraftId: "draft-1" });
    expect(db.client.commonsProposalDraft.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "draft-1", authorId: "maya", submittedAt: null } }));
    expect(db.client.proposal.create.mock.calls[0][0].data).toMatchObject({ status: "VOTABLE", councilRequired: true });
    expect(db.client.commonsProposalDraft.updateMany).toHaveBeenCalledWith({ where: { id: "draft-1", submittedAt: null }, data: expect.objectContaining({ submittedProposalId: "prop_new" }) });
    // Open for a vote, so members are told.
    expect(announceProposalVote).toHaveBeenCalledWith("prop_new", expect.anything());
  });

  it("leaves an ordinary thread draft on the normal approval path", async () => {
    db.client.commonsProposalDraft.findFirst.mockResolvedValue({ id: "draft-2", kind: "GENERAL", ideaPostId: null });
    await caller().create({ text: "Proposal Title: Weekly check-in thread\n\nA Monday thread where everyone shares one thing.", coopId: "harbor", commonsDraftId: "draft-2" });
    expect(db.client.proposal.create.mock.calls[0][0].data).toMatchObject({ status: "APPROVED" });
    // Approved without a vote: nothing to vote on, so no alert.
    expect(announceProposalVote).not.toHaveBeenCalled();
  });
});

describe("Sage putting up its own proposal", () => {
  it("saves it as Sage, sends it to a member vote, and counts the review toward Sage's limit", async () => {
    processProposal.mockResolvedValue({ ...engineOutput(0), proposer: { wallet: "sage:bot", role: "bot", displayName: "Sage" } });
    await createProposalFromText(db.client, {
      walletAddress: "sage:bot", coopId: "harbor", memberVoteRequired: true, costFeature: "sage-goal-proposal", announce: false,
      input: { text: "Proposal Title: Weekly check-in thread\n\nA Monday thread where everyone shares one thing.", coopId: "harbor", proposer: { wallet: "sage:bot", role: "bot", displayName: "Sage" } },
    });
    expect(db.client.proposal.create.mock.calls[0][0].data).toMatchObject({ status: "VOTABLE", councilRequired: true, proposerWallet: "sage:bot", proposerRole: "BOT", proposerDisplayName: "Sage" });
    expect(costedRun).toHaveBeenCalledWith("harbor", "sage-goal-proposal", expect.any(Function));
    // Sage tells members itself, only after it decides to keep the proposal.
    expect(announceProposalVote).not.toHaveBeenCalled();
  });
});

describe("approving a proposal that came from an amendment idea", () => {
  it("queues the change for a steward, but not for a program idea", async () => {
    db.client.proposal.findUnique.mockResolvedValue({ id: "prop_9", status: "VOTABLE", votingWindowDays: 7 });
    db.client.proposal.update.mockResolvedValue({
      id: "prop_9", coopId: "harbor", title: "Longer votes", status: "APPROVED", createdAt: new Date(), updatedAt: new Date(),
      summary: "s", category: "GOVERNANCE", proposerWallet: WALLET, proposerRole: "MEMBER", regionCode: "US", regionName: "US",
      budgetCurrency: "USD", budgetAmount: 0, quorumPercent: 20, approvalThresholdPercent: 60, votingWindowDays: 7, engineVersion: "x",
      auditChecks: [], kpis: [], decisionReasons: [], councilRequired: true,
    });
    db.client.commonsProposalDraft.findUnique.mockResolvedValueOnce({ kind: "CHARTER_AMENDMENT", proposedChanges: { find: "a", replace: "b" } });
    await caller().updateStatus({ id: "prop_9", status: "approved" });
    expect(queueAmendmentForProposal).toHaveBeenCalledWith("harbor", { id: "prop_9", title: "Longer votes" }, { kind: "CHARTER_AMENDMENT", proposedChanges: { find: "a", replace: "b" } });

    db.client.commonsProposalDraft.findUnique.mockResolvedValueOnce({ kind: "PROGRAM", proposedChanges: null });
    await caller().updateStatus({ id: "prop_9", status: "approved" });
    expect(queueAmendmentForProposal).toHaveBeenCalledTimes(1);
  });
});
