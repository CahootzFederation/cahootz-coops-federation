import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => {
  const client: Record<string, any> = {
    coopConfig: { findFirst: vi.fn(), update: vi.fn() },
    coopConfigAudit: { findFirst: vi.fn(), create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    commonsContentScan: { create: vi.fn(), updateMany: vi.fn() },
    aIObservation: { findUnique: vi.fn(), update: vi.fn() },
    commonsProposalDraft: { count: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    proposal: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn(), updateMany: vi.fn() },
    proposalGoalScore: { findMany: vi.fn() },
    commonsPost: { findMany: vi.fn(), create: vi.fn() },
    commonsComment: { findMany: vi.fn() },
    commonsAction: { create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    commonsActionAudit: { create: vi.fn() },
    userCoopMembership: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
    sageDecisionTrail: { create: vi.fn() },
  };
  client.$transaction = vi.fn((fn: (tx: unknown) => unknown) => fn(client));
  return client;
});
const recordObservation = vi.hoisted(() => vi.fn());
const autonomy = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());
const insights = vi.hoisted(() => vi.fn());
const activeMembers = vi.hoisted(() => vi.fn());
const readSignal = vi.hoisted(() => vi.fn());
const ensureGoalSignalMap = vi.hoisted(() => vi.fn());
const reconsider = vi.hoisted(() => vi.fn());
const announce = vi.hoisted(() => vi.fn());
vi.mock("@repo/db", () => ({ db }));
vi.mock("@openai/agents", () => {
  class MockAgent { constructor(public opts: unknown) {} }
  return { Agent: MockAgent, run: vi.fn(), tool: vi.fn() };
});
vi.mock("../lib/bot.js", () => ({ ensureSageBotUser: vi.fn().mockResolvedValue({ id: "sage" }) }));
vi.mock("../services/ai-cost.js", () => ({ recordAICost: vi.fn(), recordAgentResultCost: vi.fn() }));
vi.mock("../services/ai-memory.js", () => ({ recordObservation }));
vi.mock("../services/sage-autonomy.js", () => ({ sageAutonomyAllowed: autonomy }));
vi.mock("../services/push-notification-service.js", () => ({ createNotificationAndPush: push }));
vi.mock("../services/proposal-notifications.js", () => ({ notifyProposalOpenForVote: announce }));
vi.mock("../services/sage-community-memory.js", () => ({ retrieveCommunityInsights: insights }));
vi.mock("../services/sage-community-question.js", () => ({ countQuestionResponders: vi.fn(), COMMUNITY_QUESTION_MIN_RESPONDERS: 2 }));
vi.mock("../services/sage-dispatch.js", () => ({ enqueueCommunityMemoryReconsideration: reconsider }));
vi.mock("../services/commons-action-agent.js", () => ({ charterSnapshotKey: () => "cfg-1:4:abc" }));
vi.mock("../services/sage-community-rhythm.js", async () => {
  const actual = await vi.importActual<typeof import("../services/sage-community-rhythm.js")>("../services/sage-community-rhythm.js");
  return { isoWeekKey: actual.isoWeekKey, countActiveMembers: activeMembers };
});
vi.mock("../services/sage-goal-signals.js", async () => {
  const actual = await vi.importActual<typeof import("../services/sage-goal-signals.js")>("../services/sage-goal-signals.js");
  return { ...actual, readSignal, ensureGoalSignalMap };
});

const {
  applyCharterChange, applyVotedAmendment, checkIdea, claimProposalIdea, commonsBlockers, draftRequiresVote, goalBlockers, proposalWriterPeriod,
  normalizeNewGoals, proposalTextFor, queueAmendmentForProposal, renderIdeaPost, runProposalWriter, unbackedNumbers, NOT_STARTED_LINE,
} = await import("../services/sage-proposal-writer.js");
const { AUTONOMOUS_SAGE_FEATURES } = await vi.importActual<typeof import("../services/sage-autonomy.js")>("../services/sage-autonomy.js");

const NOW = new Date("2026-10-15T15:00:00Z"); // a Thursday
const CHARTER = "We keep each other in the loop. Members share news, needs and wins in the open. Proposals need a simple majority of votes cast.";
const GOALS = [
  { key: "more_communication", label: "More communication", priorityWeight: 0.6, description: "Members talk and share what's going on" },
  { key: "local_commerce", label: "Local commerce", priorityWeight: 0.4 },
];
const CONFIG = {
  id: "cfg-1", coopId: "harbor", version: 4, isActive: true, isDemo: false, charterText: CHARTER, missionGoals: GOALS,
  scTokenName: "HarborCoin", createdAt: new Date("2026-06-01T00:00:00Z"),
};
const MAP = { configId: "cfg-1", version: 4, goals: [
  { key: "more_communication", label: "More communication", signals: ["conversation"], source: "sage" },
  { key: "local_commerce", label: "Local commerce", signals: ["local_commerce"], source: "sage" },
] };

function idea(overrides: Record<string, unknown> = {}) {
  return {
    decision: "PROPOSE", reason: "Talk dropped off hard; a standing weekly thread is cheap and easy.", goalKey: "more_communication", kind: "PROGRAM",
    title: "Start a weekly check-in thread",
    pitch: "Let's start a Monday thread where everyone shares one thing going on with them this week.",
    body: "What: a weekly Monday check-in thread in the General feed. Who: a volunteer host each month. When: starting next Monday. How we'll know: more people posting and replying within a month. Cost: nothing.",
    budgetAmount: null, charterQuote: "Members share news, needs and wins in the open", charterChange: null, newGoals: null, confidence: 0.8,
    ...overrides,
  };
}

// Goals that already had a proposal; anything else counts as not started yet.
let startedGoals = new Set<string>();
function draftLookup({ where }: { where: Record<string, unknown> }) {
  if (Object.keys(where).length === 2 && typeof where.goalKey === "string") return startedGoals.has(where.goalKey) ? { id: "old-draft" } : null;
  return null;
}
const votable = () => vi.fn().mockResolvedValue({ id: "prop-sage-1", status: "votable", decision: "advance", decisionReasons: [] });

const CONTEXT = {
  charterText: CHARTER, goals: GOALS, candidateGoalKeys: ["more_communication"],
  evidenceTexts: ["Posts and comments members write: 4 in the last two weeks, down from about 18 every two weeks before that.", "Could we get a $150 grill for the park meetups?"],
};

beforeEach(() => {
  vi.clearAllMocks();
  db.coopConfig.findFirst.mockResolvedValue(CONFIG);
  db.commonsContentScan.create.mockResolvedValue({});
  db.commonsContentScan.updateMany.mockResolvedValue({ count: 1 });
  db.aIObservation.findUnique.mockResolvedValue(null);
  db.commonsProposalDraft.count.mockResolvedValue(0);
  startedGoals = new Set(["more_communication", "local_commerce"]);
  db.commonsProposalDraft.findFirst.mockImplementation(draftLookup);
  db.commonsProposalDraft.update.mockResolvedValue({});
  db.proposal.count.mockResolvedValue(0);
  db.proposal.updateMany.mockResolvedValue({ count: 1 });
  db.commonsProposalDraft.findMany.mockResolvedValue([]);
  db.commonsProposalDraft.create.mockResolvedValue({ id: "draft-1" });
  db.proposal.findMany.mockResolvedValue([]);
  db.proposalGoalScore.findMany.mockResolvedValue([]);
  db.commonsPost.findMany.mockResolvedValue([{ title: "Park meetup", content: "Could we get a $150 grill for the park meetups?" }]);
  db.commonsPost.create.mockResolvedValue({ id: "idea-post-1" });
  db.commonsAction.create.mockResolvedValue({ id: "action-1" });
  db.commonsAction.findMany.mockResolvedValue([]);
  db.sageDecisionTrail.create.mockResolvedValue({ id: "trail-1" });
  recordObservation.mockResolvedValue({ id: "gap-1" });
  db.commonsActionAudit.create.mockResolvedValue({});
  db.coopConfigAudit.create.mockResolvedValue({});
  push.mockResolvedValue({ id: "n1" });
  reconsider.mockResolvedValue(undefined);
  announce.mockResolvedValue(3);
  autonomy.mockResolvedValue(true);
  insights.mockResolvedValue([]);
  activeMembers.mockResolvedValue(12);
  ensureGoalSignalMap.mockResolvedValue({ map: MAP, created: false, usedModel: false });
  readSignal.mockImplementation(async (_coopId: string, key: string) => key === "conversation"
    ? { key, current: 4, history: [18, 20, 16, 18] }
    : { key, current: 9, history: [8, 10, 9, 9] });
});

describe("when Sage checks goals", () => {
  it("runs at most twice a week: Monday to Wednesday, and Thursday to Sunday", () => {
    expect(proposalWriterPeriod(new Date("2026-10-12T09:00:00Z"))).toBe("2026-W42-a");
    expect(proposalWriterPeriod(new Date("2026-10-14T23:00:00Z"))).toBe("2026-W42-a");
    expect(proposalWriterPeriod(new Date("2026-10-15T00:30:00Z"))).toBe("2026-W42-b");
    expect(proposalWriterPeriod(new Date("2026-10-18T12:00:00Z"))).toBe("2026-W42-b");
  });

  it("counts its model calls toward the monthly autonomy limit", () => {
    expect(AUTONOMOUS_SAGE_FEATURES).toEqual(expect.arrayContaining(["sage-proposal-writer", "sage-goal-map", "sage-goal-proposal"]));
  });
});

describe("the rules that say no before any model call", () => {
  it("welcomes a new or tiny Commons, but blocks a full week, too many open votes or ideas, and a spent limit", () => {
    const ok = { activeMembers: 10, ideasThisWeek: 0, firstWeek: false, openSageProposals: 0, openIdeas: 0, autonomyAllowed: true };
    expect(commonsBlockers(ok)).toEqual([]);
    expect(commonsBlockers({ ...ok, activeMembers: 1 })).toEqual([]);
    expect(commonsBlockers({ ...ok, activeMembers: 0 })[0]).toMatch(/No active members/);
    expect(commonsBlockers({ ...ok, ideasThisWeek: 2 })[0]).toMatch(/already put up 2 proposals this week/);
    // A Commons' first week with Sage gets one proposal, not two.
    expect(commonsBlockers({ ...ok, firstWeek: true })).toEqual([]);
    expect(commonsBlockers({ ...ok, firstWeek: true, ideasThisWeek: 1 })[0]).toMatch(/first proposal here/);
    expect(commonsBlockers({ ...ok, ideasThisWeek: 1 })).toEqual([]);
    expect(commonsBlockers({ ...ok, openSageProposals: 2 })[0]).toMatch(/still being voted on/);
    expect(commonsBlockers({ ...ok, openIdeas: 2 })[0]).toMatch(/still waiting for someone/);
    expect(commonsBlockers({ ...ok, autonomyAllowed: false })[0]).toMatch(/spending limit/);
  });

  it("blocks a goal with a recent idea, an open proposal, or a recent no vote", () => {
    expect(goalBlockers({ lastIdeaAt: null, openDraftOrProposal: false, recentlyRejected: false }, NOW)).toEqual([]);
    expect(goalBlockers({ lastIdeaAt: new Date("2026-10-01T00:00:00Z"), openDraftOrProposal: false, recentlyRejected: false }, NOW)[0]).toMatch(/last 30 days/);
    expect(goalBlockers({ lastIdeaAt: new Date("2026-08-01T00:00:00Z"), openDraftOrProposal: true, recentlyRejected: true }, NOW)).toHaveLength(2);
  });
});

describe("code's checks on Sage's idea", () => {
  it("accepts a charter-grounded idea that uses no made-up numbers", () => {
    const result = checkIdea(idea() as never, CONTEXT);
    expect(result).toMatchObject({ ok: true, idea: { kind: "PROGRAM", goalKey: "more_communication", budgetAmount: null } });
  });

  it("passes on the model's no, with its reason", () => {
    expect(checkIdea(idea({ decision: "NO_PROPOSAL", reason: "Probably just a slow month after the holiday." }) as never, CONTEXT))
      .toEqual({ ok: false, reason: "Probably just a slow month after the holiday." });
  });

  it("refuses an idea for a goal that wasn't open, a weak one, or one with no charter quote", () => {
    expect(checkIdea(idea({ goalKey: "local_commerce" }) as never, CONTEXT)).toMatchObject({ ok: false, reason: expect.stringMatching(/wasn't open/) });
    expect(checkIdea(idea({ confidence: 0.4 }) as never, CONTEXT)).toMatchObject({ ok: false, reason: expect.stringMatching(/sure enough/) });
    expect(checkIdea(idea({ charterQuote: "Members must always attend meetings" }) as never, CONTEXT)).toMatchObject({ ok: false, reason: expect.stringMatching(/quote our charter/) });
  });

  it("refuses numbers nobody gave, but allows small counts and figures members used", () => {
    expect(unbackedNumbers("Meet 2 times a month for 3 months", [])).toEqual([]);
    expect(unbackedNumbers("A $150 grill and a $900 tent", CONTEXT.evidenceTexts)).toEqual(["$900"]);
    expect(checkIdea(idea({ body: `${idea().body} We'd spend $400 on snacks.` }) as never, CONTEXT)).toMatchObject({ ok: false, reason: expect.stringMatching(/\$400/) });
  });

  it("keeps a member's cost for a spending idea, and refuses one it made up", () => {
    const grill = idea({ kind: "SPENDING", budgetAmount: 150, body: `${idea().body} A grill for the park meetups costs $150, which a member already priced.` });
    expect(checkIdea(grill as never, CONTEXT)).toMatchObject({ ok: true, idea: { budgetAmount: 150 } });
    expect(checkIdea(idea({ kind: "SPENDING", budgetAmount: 500 }) as never, CONTEXT)).toMatchObject({ ok: false, reason: expect.stringMatching(/cost nobody/) });
  });

  it("needs a charter change to point at one exact passage", () => {
    const change = idea({ kind: "CHARTER_AMENDMENT", charterChange: { find: "Proposals need a simple majority of votes cast.", replace: "Proposals need a simple majority of votes cast, and at least 50 members voting." } });
    const result = checkIdea(change as never, { ...CONTEXT, evidenceTexts: [...CONTEXT.evidenceTexts] });
    expect(result).toMatchObject({ ok: false, reason: expect.stringMatching(/numbers/) });
    const ok = idea({ kind: "CHARTER_AMENDMENT", charterChange: { find: "Proposals need a simple majority of votes cast.", replace: "Proposals need a simple majority of the votes cast, and the vote stays open a full week." } });
    expect(checkIdea(ok as never, CONTEXT)).toMatchObject({ ok: true, idea: { proposedChanges: { find: "Proposals need a simple majority of votes cast." } } });
    expect(checkIdea(idea({ kind: "CHARTER_AMENDMENT", charterChange: { find: "Text that isn't in the charter at all", replace: "New" } }) as never, CONTEXT))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/one exact passage/) });
  });

  it("turns a goals change into a clean list with weights that add up", () => {
    const goals = normalizeNewGoals([{ label: "Talk more", priorityWeight: 3, description: "" }, { label: "Buy local", priorityWeight: 1, description: "From member stores" }]);
    expect(goals).toEqual([
      { key: "talk_more", label: "Talk more", priorityWeight: 0.75 },
      { key: "buy_local", label: "Buy local", priorityWeight: 0.25, description: "From member stores" },
    ]);
    expect(normalizeNewGoals([])).toBeNull();
  });

  it("swaps exactly one passage, and refuses a passage that's missing or repeated", () => {
    expect(applyCharterChange("Start. The middle part is here. End.", "The middle part is here.", "The middle part changed.")).toBe("Start. The middle part changed. End.");
    expect(applyCharterChange("same thing here, same thing here", "same thing here", "new")).toBeNull();
    expect(applyCharterChange(CHARTER, "not in the charter text", "new")).toBeNull();
  });

  it("frames the post: a proposal up for a vote, or an idea a member takes on when the review sent it back", () => {
    const idea = { kind: "CHARTER_AMENDMENT" as const, pitch: "Let's make votes stay open a full week." };
    const submitted = renderIdeaPost(idea, "Deciding together", "Proposals made and votes cast: 1 in the last two weeks.", true);
    expect(submitted).toContain('Why now: our goal "Deciding together". Proposals made and votes cast');
    expect(submitted).toContain("I put it up for a vote");
    expect(submitted).toContain("It only happens if members say yes");
    expect(submitted).toContain("a steward applies the change");
    const open = renderIdeaPost(idea, "Deciding together", null, false);
    expect(open).toContain('Tap "Take this on" to make it yours');
    expect(open).toContain("nothing goes to a vote until you send it");
  });

  it("sends the review the draft, a member's cost, and the exact change voters decide on", () => {
    const text = proposalTextFor({ title: "Longer votes", body: "Keep votes open a week.", kind: "CHARTER_AMENDMENT", budgetAmount: 150,
      proposedChanges: { find: "Proposals need a simple majority of votes cast.", replace: "Votes stay open a week." } });
    expect(text).toBe('Proposal Title: Longer votes\n\nKeep votes open a week.\n\nBudget Requested: $150\n\nCharter change members are voting on:\nReplace: "Proposals need a simple majority of votes cast."\nWith: "Votes stay open a week."');
  });
});

describe("a proposal-writer run", () => {
  it("notes a quiet Commons in memory, writes a proposal and puts it up for a vote", async () => {
    const decide = vi.fn().mockResolvedValue(idea());
    const submit = votable();
    const result = await runProposalWriter("harbor", { now: NOW, decide, submit });

    expect(result).toEqual({ status: "PROPOSED", ideaPostId: "idea-post-1", draftId: "draft-1", proposalId: "prop-sage-1", gaps: 1 });
    expect(submit).toHaveBeenCalledWith({ coopId: "harbor", text: expect.stringMatching(/^Proposal Title: Start a weekly check-in thread\n\nWhat: a weekly Monday check-in thread/) });
    expect(db.commonsProposalDraft.update).toHaveBeenCalledWith({ where: { id: "draft-1" }, data: expect.objectContaining({ ideaPostId: "idea-post-1", submittedProposalId: "prop-sage-1" }) });
    expect(db.proposal.updateMany).not.toHaveBeenCalled();
    expect(announce).toHaveBeenCalledWith("prop-sage-1");
    expect(db.commonsContentScan.create).toHaveBeenCalledWith({ data: expect.objectContaining({ sourceType: "sage_proposal_writer", contentHash: "2026-W42-b" }) });
    expect(recordObservation).toHaveBeenCalledWith(expect.objectContaining({
      type: "goal_gap", systemKey: "goal_gap:harbor:more_communication", visibility: "COMMONS_MEMBERS",
      summary: expect.stringContaining('Goal "More communication" looks behind. Posts and comments members write: 4 in the last two weeks'),
    }));
    expect(decide).toHaveBeenCalledTimes(1);
    const prompt = JSON.parse(decide.mock.calls[0]![0]);
    expect(prompt.candidates).toEqual([expect.objectContaining({ goalKey: "more_communication" })]);
    expect(db.commonsPost.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      authorId: "sage", classification: "sage_proposal_idea", title: "Start a weekly check-in thread",
      content: expect.stringContaining("I put it up for a vote"),
    }), select: { id: true } });
    expect(db.commonsProposalDraft.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      authorId: null, kind: "PROGRAM", goalKey: "more_communication", originObservationId: "gap-1",
    }), select: { id: true } });
    expect(db.commonsAction.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: "PROPOSE_IDEA", replySourceKey: "goal_idea:harbor:2026-W42-b" }) });
    const trail = db.sageDecisionTrail.create.mock.calls[0]![0].data;
    expect(trail).toMatchObject({ agent: "sage-proposal-writer", visibility: "COMMONS_MEMBERS", outcome: "Put up a proposal for a vote", relatedPostIds: ["idea-post-1"] });
  });

  it("withdraws a proposal the review sent back, and shares it as an idea a member can take on", async () => {
    // The review lands a "revise" as votable, but it's saying the proposal isn't strong enough yet.
    const submit = vi.fn().mockResolvedValue({ id: "prop-sage-2", status: "votable", decision: "revise", decisionReasons: ["Scored below the minimum to move forward"] });
    const result = await runProposalWriter("harbor", { now: NOW, decide: vi.fn().mockResolvedValue(idea()), submit });
    expect(result).toMatchObject({ status: "PROPOSED", proposalId: null });
    expect(db.proposal.updateMany).toHaveBeenCalledWith({ where: { id: "prop-sage-2", proposerWallet: "sage:bot" }, data: expect.objectContaining({ status: "WITHDRAWN", withdrawnBy: "sage:bot" }) });
    expect(db.commonsPost.create.mock.calls[0]![0].data.content).toContain('Tap "Take this on"');
    expect(db.commonsProposalDraft.update).toHaveBeenCalledWith({ where: { id: "draft-1" }, data: { ideaPostId: "idea-post-1" } });
    // Nobody is told to vote on a proposal Sage withdrew.
    expect(announce).not.toHaveBeenCalled();
    expect(db.sageDecisionTrail.create.mock.calls[0]![0].data.outcome).toBe("Shared a proposal idea");

    vi.clearAllMocks();
    db.commonsPost.create.mockResolvedValue({ id: "idea-post-2" });
    db.commonsAction.create.mockResolvedValue({ id: "action-2" });
    db.commonsProposalDraft.create.mockResolvedValue({ id: "draft-2" });
    const failing = vi.fn().mockRejectedValue(new Error("engine down"));
    await expect(runProposalWriter("harbor", { now: NOW, decide: vi.fn().mockResolvedValue(idea()), submit: failing, force: true })).resolves.toMatchObject({ status: "PROPOSED", proposalId: null });
  });

  it("gives a brand-new Commons a starter proposal for a goal nobody has proposed anything for", async () => {
    startedGoals = new Set(["local_commerce"]);
    db.coopConfig.findFirst.mockResolvedValue({ ...CONFIG, createdAt: new Date("2026-10-12T00:00:00Z") });
    activeMembers.mockResolvedValue(1);
    readSignal.mockImplementation(async (_coopId: string, key: string) => ({ key, current: 1, history: [] }));
    const decide = vi.fn().mockResolvedValue(idea());
    const submit = votable();
    const result = await runProposalWriter("harbor", { now: NOW, decide, submit });
    expect(result).toMatchObject({ status: "PROPOSED", proposalId: "prop-sage-1", gaps: 1 });
    const prompt = JSON.parse(decide.mock.calls[0]![0]);
    expect(prompt.candidates).toEqual([expect.objectContaining({ goalKey: "more_communication", notStartedYet: true, numbers: [NOT_STARTED_LINE] })]);
    expect(db.commonsPost.create.mock.calls[0]![0].data.content).toContain(`Why now: our goal "More communication". ${NOT_STARTED_LINE}`);
  });

  it("records the model's decision not to propose, with its reason", async () => {
    db.aIObservation.findUnique.mockImplementation(async ({ where }: { where: { id?: string; systemKey?: string } }) => where.id ? { details: { goalKey: "more_communication" } } : null);
    const decide = vi.fn().mockResolvedValue(idea({ decision: "NO_PROPOSAL", reason: "Looks like a slow stretch after the fair." }));
    const result = await runProposalWriter("harbor", { now: NOW, decide });
    expect(result).toEqual({ status: "NO_PROPOSAL", reasons: ["Looks like a slow stretch after the fair."], gaps: 1 });
    expect(db.commonsPost.create).not.toHaveBeenCalled();
    expect(db.aIObservation.update).toHaveBeenCalledWith({ where: { id: "gap-1" }, data: { details: expect.objectContaining({
      lastDecision: expect.objectContaining({ decision: "NO_PROPOSAL", reason: "Looks like a slow stretch after the fair." }),
    }) } });
    expect(db.sageDecisionTrail.create.mock.calls[0]![0].data.outcome).toBe("No proposal this time");
  });

  it("says no without a model call when a rule blocks it", async () => {
    const decide = vi.fn();
    db.proposal.count.mockResolvedValueOnce(2);
    const busy = await runProposalWriter("harbor", { now: NOW, decide });
    expect(busy).toMatchObject({ status: "NO_PROPOSAL", reasons: [expect.stringMatching(/2 of Sage's proposals are still being voted on/)] });

    readSignal.mockImplementation(async (_coopId: string, key: string) => key === "conversation"
      ? { key, current: 4, history: [18, 20, 16, 18] }
      : { key, current: 9, history: [8, 10, 9, 9] });
    db.commonsProposalDraft.findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => where.ideaPostId ? { createdAt: new Date("2026-10-10T00:00:00Z") } : draftLookup({ where }));
    const cooled = await runProposalWriter("harbor", { now: NOW, decide, force: true });
    expect(cooled).toMatchObject({ status: "NO_PROPOSAL", reasons: [expect.stringMatching(/last 30 days/)] });
    expect(decide).not.toHaveBeenCalled();
  });

  it("says every goal is on track without a model call", async () => {
    readSignal.mockResolvedValue({ key: "conversation", current: 18, history: [18, 20] });
    const decide = vi.fn();
    await expect(runProposalWriter("harbor", { now: NOW, decide })).resolves.toEqual({ status: "NO_PROPOSAL", reasons: ["Every goal we can check looks on track"], gaps: 0 });
    expect(decide).not.toHaveBeenCalled();
  });

  it("drops an idea that uses a made-up cost", async () => {
    const decide = vi.fn().mockResolvedValue(idea({ body: `${idea().body} Snacks would cost $400.` }));
    const result = await runProposalWriter("harbor", { now: NOW, decide });
    expect(result).toMatchObject({ status: "NO_PROPOSAL", reasons: [expect.stringMatching(/couldn't back up: \$400/)] });
    expect(db.commonsPost.create).not.toHaveBeenCalled();
  });

  it("lets a platform admin run it now, on its own keys, and optionally skip the weekly limits", async () => {
    db.commonsContentScan.create.mockRejectedValue(new Error("already claimed"));
    // A first-week Commons that already has its one Sage proposal this week.
    db.commonsProposalDraft.count.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => where.authorId === null ? 0 : 1);
    const blocked = await runProposalWriter("harbor", { now: NOW, decide: vi.fn(), admin: { actor: "admin@cahootz", skipLimits: false } });
    expect(blocked).toMatchObject({ status: "NO_PROPOSAL", reasons: [expect.stringMatching(/first proposal here/)] });
    expect(db.sageDecisionTrail.create.mock.calls[0]![0].data).toMatchObject({ trigger: "ADMIN_PROPOSAL_WRITER" });

    const submit = votable();
    const result = await runProposalWriter("harbor", { now: NOW, decide: vi.fn().mockResolvedValue(idea()), submit, admin: { actor: "admin@cahootz", skipLimits: true } });
    expect(result).toMatchObject({ status: "PROPOSED", proposalId: "prop-sage-1" });
    expect(db.commonsAction.create).toHaveBeenCalledWith({ data: expect.objectContaining({ replySourceKey: `goal_idea:harbor:2026-W42-b-admin-${NOW.getTime()}` }) });
    const steps = db.sageDecisionTrail.create.mock.calls[1]![0].data.steps as Array<{ label: string; adminOnly?: boolean }>;
    expect(steps).toEqual(expect.arrayContaining([expect.objectContaining({ label: "A platform admin ran this check now and skipped the weekly limits", adminOnly: true })]));
  });

  it("runs once per half-week and skips a Commons with no goals", async () => {
    db.commonsContentScan.create.mockRejectedValue(new Error("unique"));
    await expect(runProposalWriter("harbor", { now: NOW, decide: vi.fn() })).resolves.toEqual({ status: "SKIPPED", reason: "Already checked this half of the week" });
    db.coopConfig.findFirst.mockResolvedValue({ ...CONFIG, missionGoals: [] });
    await expect(runProposalWriter("harbor", { now: NOW, decide: vi.fn() })).resolves.toEqual({ status: "SKIPPED", reason: "No goals in the charter" });
  });
});

describe("taking an idea on and sending it", () => {
  it("gives the idea to the first member who taps, and tells the second it's taken", async () => {
    db.commonsProposalDraft.findUnique.mockResolvedValue({ id: "draft-1", actionId: "action-1", coopId: "harbor", authorId: null });
    db.commonsProposalDraft.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await expect(claimProposalIdea("idea-post-1", "maya", NOW)).resolves.toEqual({ claimed: true, draftId: "draft-1", coopId: "harbor" });
    expect(db.commonsProposalDraft.updateMany).toHaveBeenCalledWith({ where: { id: "draft-1", authorId: null, submittedAt: null }, data: { authorId: "maya", claimedAt: NOW } });
    await expect(claimProposalIdea("idea-post-1", "dev", NOW)).resolves.toEqual({ claimed: false, reason: "TAKEN" });
  });

  it("always sends a Sage idea or an amendment to a member vote, but not an ordinary thread draft", async () => {
    db.commonsProposalDraft.findFirst.mockResolvedValueOnce({ id: "d1", kind: "PROGRAM", ideaPostId: "p1" });
    await expect(draftRequiresVote("d1", "maya")).resolves.toEqual({ draftId: "d1", kind: "PROGRAM" });
    db.commonsProposalDraft.findFirst.mockResolvedValueOnce({ id: "d2", kind: "GENERAL", ideaPostId: null });
    await expect(draftRequiresVote("d2", "maya")).resolves.toBeNull();
    await expect(draftRequiresVote(undefined, "maya")).resolves.toBeNull();
  });
});

describe("after members vote yes on an amendment", () => {
  it("queues the new charter text once for a steward, and tells the stewards", async () => {
    db.coopConfigAudit.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "already" });
    db.userCoopMembership.findMany.mockResolvedValue([{ userId: "steward-1" }]);
    const draft = { kind: "CHARTER_AMENDMENT", proposedChanges: { find: "Proposals need a simple majority of votes cast.", replace: "Proposals need a simple majority, and votes stay open a week." } };
    await expect(queueAmendmentForProposal("harbor", { id: "prop-9", title: "Longer votes" }, draft)).resolves.toBe(true);
    expect(db.coopConfigAudit.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      section: "charterText", status: "PENDING", changedBy: "proposal:prop-9",
      proposedChanges: { charterText: CHARTER.replace("Proposals need a simple majority of votes cast.", "Proposals need a simple majority, and votes stay open a week.") },
    }) });
    expect(push).toHaveBeenCalledWith(db, expect.objectContaining({ userId: "steward-1", type: "SAGE_AMENDMENT_READY", title: "Members passed a charter change" }));
    await expect(queueAmendmentForProposal("harbor", { id: "prop-9", title: "Longer votes" }, draft)).resolves.toBe(false);
  });

  it("asks a steward to step in when the charter changed since the vote", async () => {
    db.coopConfigAudit.findFirst.mockResolvedValue(null);
    db.userCoopMembership.findMany.mockResolvedValue([{ userId: "steward-1" }]);
    const draft = { kind: "CHARTER_AMENDMENT", proposedChanges: { find: "A passage that has since been rewritten.", replace: "New words." } };
    await expect(queueAmendmentForProposal("harbor", { id: "prop-10", title: "Old change" }, draft)).resolves.toBe(false);
    expect(db.coopConfigAudit.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: "REJECTED", changedBy: "proposal:prop-10" }) });
    expect(push).toHaveBeenCalledWith(db, expect.objectContaining({ title: "A charter change members passed needs a look" }));
  });

  it("applies a voted change as a new charter version when a steward taps apply", async () => {
    db.coopConfigAudit.findUnique.mockResolvedValue({ id: "audit-1", status: "PENDING", changedBy: "proposal:prop-9", coopConfigId: "cfg-1", section: "missionGoals",
      proposedChanges: { missionGoals: [{ key: "", label: "Talk more", priorityWeight: 1 }] } });
    db.coopConfigAudit.findFirst.mockResolvedValue({ sequence: 7 });
    db.coopConfig.update.mockResolvedValue({ ...CONFIG, version: 5 });
    await expect(applyVotedAmendment("harbor", "audit-1", "steward-1")).resolves.toEqual({ applied: true, version: 5 });
    expect(db.coopConfig.update).toHaveBeenCalledWith({ where: { id: "cfg-1" }, data: { version: 5, missionGoals: [{ key: "talk_more", label: "Talk more", priorityWeight: 1 }] } });
    expect(db.coopConfigAudit.update).toHaveBeenCalledWith({ where: { id: "audit-1" }, data: expect.objectContaining({ status: "APPLIED", sequence: 8, reviewedBy: "user:steward-1" }) });
    expect(reconsider).toHaveBeenCalledWith("harbor", 5);

    db.coopConfigAudit.findUnique.mockResolvedValue({ id: "audit-2", status: "PENDING", changedBy: "0xadmin", coopConfigId: "cfg-1", section: "charterText", proposedChanges: {} });
    await expect(applyVotedAmendment("harbor", "audit-2", "steward-1")).resolves.toMatchObject({ applied: false });
  });
});
