import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  userCoopMembership: { findUnique: vi.fn(), findMany: vi.fn() },
  sageTask: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  event: { findMany: vi.fn(), findUnique: vi.fn() },
  proposal: { findMany: vi.fn(), findUnique: vi.fn(), groupBy: vi.fn() },
  commonsProposalDraft: { findMany: vi.fn(), findUnique: vi.fn() },
  commonsActionReview: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), count: vi.fn() },
  coopConfig: { findFirst: vi.fn() },
  adminRole: { findMany: vi.fn() },
  group: { findUnique: vi.fn() },
  commonsResource: { findMany: vi.fn() },
  commonsAction: { findFirst: vi.fn(), create: vi.fn(), findUnique: vi.fn() },
  commonsActionParticipant: { findFirst: vi.fn() },
  sageDecisionTrail: { findFirst: vi.fn(), create: vi.fn().mockResolvedValue({ id: "trail" }) },
}));
const routeSageAlert = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn().mockResolvedValue({ id: "n" }));
vi.mock("@repo/db", () => ({ db }));
vi.mock("../services/sage-responsibility.js", () => ({ routeSageAlert, RESPONSIBILITY_CATEGORIES: ["CIRCLE_LEADER", "COMMONS_ADMIN", "GOVERNANCE", "TREASURY", "SUPPORT"] }));
vi.mock("../services/sage-memory.js", () => ({ retrieveSageMemory: vi.fn().mockResolvedValue([]) }));
vi.mock("../services/sage-autonomy.js", () => ({ sageAutonomyAllowed: vi.fn().mockResolvedValue(true) }));
vi.mock("../services/push-notification-service.js", () => ({ createNotificationAndPush: push }));

const { buildSpecialistTools } = await import("../agents/tools/specialist-tools.js");
const { applyStewardAction, runStewardReview } = await import("../services/sage-steward.js");
const { createIntroductionSuggestion, askIntroductionHelper } = await import("../services/sage-introductions.js");
const { DecisionTrail } = await import("../services/sage-decision-trail.js");
const { sageAutonomyAllowed } = await import("../services/sage-autonomy.js");

const ctx = { db: db as never, requestingUserId: null, coopId: "harbor" };
const call = (tools: Array<{ name: string; invoke: (c: unknown, args: string) => Promise<unknown> }>, name: string, args: Record<string, unknown>) =>
  tools.find((t) => t.name === name)!.invoke({}, JSON.stringify(args));
const blankAction = {
  type: "NONE" as const, reason: "r", subjectType: "" as const, subjectId: "", ownerUserId: "", expected: "", followUpDays: 0,
  category: "" as const, circleId: "", severity: "MEDIUM" as const, title: "", recommendation: "", needUserId: "", helperUserId: "", needSummary: "",
};
const trail = () => new DecisionTrail({ agent: "steward", coopId: "harbor", sourceType: "commons_review", sourceId: "x", trigger: "SAGE_WAKE", visibility: "ADMINS", observed: {} });

beforeEach(() => {
  vi.clearAllMocks();
  db.userCoopMembership.findUnique.mockResolvedValue({ status: "ACTIVE" });
  db.sageTask.findFirst.mockResolvedValue(null);
  db.sageTask.create.mockResolvedValue({ id: "task-new" });
  routeSageAlert.mockResolvedValue({ status: "ROUTED", category: "COMMONS_ADMIN", alerts: [] });
});

describe("specialist tools", () => {
  it("Bridge finds only active members of this Commons whose profile matches the need", async () => {
    db.userCoopMembership.findMany.mockResolvedValueOnce([
      { userId: "u1", user: { name: "Avery", skills: ["Bookkeeping"], resourcesOffered: [], interests: [] } },
      { userId: "u2", user: { name: "Sam", skills: ["Gardening"], resourcesOffered: ["Pickup truck"], interests: [] } },
    ]);
    const result = await call(buildSpecialistTools(ctx), "find_members_for_need", { need: "help setting up bookkeeping", excludeUserId: "u9" });
    expect(result).toEqual([{ userId: "u1", name: "Avery", matched: ["Bookkeeping"] }]);
    expect(db.userCoopMembership.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { coopId: "harbor", status: "ACTIVE", user: { isBot: false, deletedAt: null }, userId: { not: "u9" } },
    }));
  });

  it("Guardian checks authority deterministically and only counts a leader of a circle in this Commons", async () => {
    db.adminRole.findMany.mockResolvedValueOnce([{ role: "TREASURY_ADMIN" }]);
    db.group.findUnique.mockResolvedValueOnce({ coopId: "elsewhere", leaderId: "u1" });
    expect(await call(buildSpecialistTools(ctx), "check_authority", { userId: "u1", circleId: "c1" }))
      .toEqual({ isActiveMember: true, adminRoles: ["TREASURY_ADMIN"], isCircleLeader: false });
  });

  it("Ledger reads proposal budgets only, scoped to this Commons, and logs to the trail", async () => {
    db.coopConfig.findFirst.mockResolvedValueOnce({ aiAutoApproveThresholdUSD: 500, councilVoteThresholdUSD: 5000 });
    db.proposal.groupBy.mockResolvedValueOnce([{ status: "VOTABLE", _sum: { budgetAmount: 1200 }, _count: { _all: 2 } }]);
    db.proposal.findMany.mockResolvedValueOnce([]);
    const log = vi.fn();
    const result = await call(buildSpecialistTools(ctx, log), "get_proposal_exposure", {}) as { byStatus: unknown };
    expect(result.byStatus).toEqual({ VOTABLE: { count: 2, budget: 1200 } });
    expect(db.proposal.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ coopId: "harbor" }) }));
    expect(log).toHaveBeenCalledWith("Ledger", "Proposal budgets (last 12 months)", "votable: 2 · $1,200");
  });
});

describe("the steward's actions are checked in code", () => {
  it("only follows up on a real subject in this Commons", async () => {
    db.commonsProposalDraft.findUnique.mockResolvedValueOnce({ coopId: "elsewhere", title: "Other" });
    expect(await applyStewardAction("harbor", { ...blankAction, type: "FOLLOW_UP", subjectType: "proposal_draft", subjectId: "d1", ownerUserId: "u1" }, trail())).toBe("rejected");
    expect(db.sageTask.create).not.toHaveBeenCalled();
    db.commonsProposalDraft.findUnique.mockResolvedValueOnce({ coopId: "harbor", title: "Tool library" });
    expect(await applyStewardAction("harbor", { ...blankAction, type: "FOLLOW_UP", subjectType: "proposal_draft", subjectId: "d1", ownerUserId: "u1", followUpDays: 2 }, trail())).toBe("follow-up");
    expect(db.sageTask.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: "REVIEW_STALE_DRAFT", subjectId: "d1", ownerUserId: "u1" }) }));
  });

  it("routes alerts by responsibility only, never to a named person or a foreign circle", async () => {
    expect(await applyStewardAction("harbor", { ...blankAction, type: "ROUTE_ALERT", category: "" }, trail())).toBe("rejected");
    db.group.findUnique.mockResolvedValueOnce({ coopId: "elsewhere" });
    expect(await applyStewardAction("harbor", { ...blankAction, type: "ROUTE_ALERT", category: "CIRCLE_LEADER", circleId: "c9" }, trail())).toBe("rejected");
    expect(routeSageAlert).not.toHaveBeenCalled();
    expect(await applyStewardAction("harbor", { ...blankAction, type: "ROUTE_ALERT", category: "TREASURY", title: "Budget question", recommendation: "Check it" }, trail())).toBe("alert");
    expect(routeSageAlert).toHaveBeenCalledWith(expect.objectContaining({ coopId: "harbor", category: "TREASURY", title: "Budget question" }));
  });

  it("skips the daily review if it ran recently or Sage is over its limit, and otherwise applies what passes", async () => {
    db.sageDecisionTrail.findFirst.mockResolvedValueOnce({ id: "recent" });
    expect(await runStewardReview("harbor")).toEqual({ skipped: "recent" });
    db.sageDecisionTrail.findFirst.mockResolvedValueOnce(null);
    vi.mocked(sageAutonomyAllowed).mockResolvedValueOnce(false);
    expect(await runStewardReview("harbor")).toEqual({ skipped: "limit" });

    db.sageDecisionTrail.findFirst.mockResolvedValueOnce(null);
    db.coopConfig.findFirst.mockResolvedValueOnce({ name: "Harbor" });
    const decide = vi.fn().mockResolvedValue({ summary: "One stale draft", actions: [
      { ...blankAction, type: "ROUTE_ALERT", category: "GOVERNANCE", title: "Vote question" },
      { ...blankAction, type: "NONE" },
    ] });
    expect(await runStewardReview("harbor", new Date(), decide)).toEqual({ skipped: false, outcomes: ["alert"] });
    expect(db.sageDecisionTrail.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      agent: "steward", visibility: "ADMINS", outcome: "Daily review: alert",
    }) }));
  });
});

describe("introductions", () => {
  it("asks the person with the need first and never pairs someone with themselves or outsiders", async () => {
    expect(await createIntroductionSuggestion({ coopId: "harbor", needUserId: "u1", helperUserId: "u1", needSummary: "n", reason: "r" })).toMatchObject({ created: false });
    db.userCoopMembership.findMany.mockResolvedValueOnce([{ userId: "u1" }]);
    expect(await createIntroductionSuggestion({ coopId: "harbor", needUserId: "u1", helperUserId: "u2", needSummary: "n", reason: "r" })).toMatchObject({ created: false });

    db.userCoopMembership.findMany.mockResolvedValueOnce([{ userId: "u1" }, { userId: "u2" }]);
    db.commonsAction.findFirst.mockResolvedValueOnce(null);
    db.commonsAction.create.mockResolvedValueOnce({ id: "intro-1" });
    expect(await createIntroductionSuggestion({ coopId: "harbor", needUserId: "u1", helperUserId: "u2", needSummary: "bookkeeping help", reason: "r" }))
      .toEqual({ created: true, actionId: "intro-1" });
    const data = db.commonsAction.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({ type: "CONNECT_MEMBERS", sourceType: "sage_introduction" });
    expect(data.participants.create).toEqual([{ userId: "u1", role: "SUBJECT" }, { userId: "u2", role: "HELPER" }]);
    expect(data.reviews.create).toMatchObject({ userId: "u1", reviewType: "ACCEPT_INTRODUCTION" });
    expect(push).toHaveBeenCalledWith(db, expect.objectContaining({ userId: "u1", type: "SAGE_SUGGESTION_NEEDS_YOU" }));
  });

  it("asks the helper only after the person with the need accepts, and only once", async () => {
    db.commonsAction.findUnique.mockResolvedValue({ id: "intro-1", coopId: "harbor", payload: { needSummary: "bookkeeping help" }, payloadHash: "h" });
    db.commonsActionParticipant.findFirst.mockResolvedValue({ userId: "u2" });
    db.commonsActionReview.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "existing" });
    expect(await askIntroductionHelper("intro-1")).toBe(true);
    expect(db.commonsActionReview.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: "u2", reviewType: "ACCEPT_INTRODUCTION", payloadHash: "h" }) });
    expect(await askIntroductionHelper("intro-1")).toBe(false);
  });
});
