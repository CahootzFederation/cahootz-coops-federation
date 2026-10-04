import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  sageDecisionTrail: { create: vi.fn() },
  commonsAction: { findMany: vi.fn() },
  commonsActionReview: { findMany: vi.fn() },
  commonsActionAudit: { findMany: vi.fn() },
  proposal: { findMany: vi.fn().mockResolvedValue([]) },
}));
vi.mock("@repo/db", () => ({ db }));

const { DecisionTrail, presentTrails } = await import("../services/sage-decision-trail.js");
const { replyPolicyChecks } = await import("../services/commons-action-agent.js");
const { sageRouter } = await import("../routers/sage.js");

beforeEach(() => {
  vi.clearAllMocks();
  db.commonsAction.findMany.mockResolvedValue([]);
  db.commonsActionReview.findMany.mockResolvedValue([]);
  db.commonsActionAudit.findMany.mockResolvedValue([]);
});

function trailRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "trail-1", agent: "sage-trend", coopId: "harbor", circleId: "circle-1", proposalId: null, sourceType: "circle_window", sourceId: "window-1",
    trigger: "CIRCLE_WINDOW_FULL", visibility: "CIRCLE", outcome: "Sent to the circle leader for approval",
    observed: { circleName: "Garden", items: [{ author: "Maya", content: "Cleanup day?", at: "2026-10-01T10:00:00.000Z" }] },
    steps: [
      { stage: "OBSERVED", label: "Read 1 posts, comments and messages in Garden" },
      { stage: "CONSIDERED", label: "Create an event: Cleanup day", outcome: "INFO" },
      { stage: "POLICY", label: "Confident enough to suggest (60%+)", outcome: "PASS" },
      { stage: "TAKEN", label: "Invited @sam to be listed", outcome: "INFO", adminOnly: true },
      { stage: "TAKEN", label: "Sent to the circle leader for approval", outcome: "PASS" },
    ],
    relatedPostIds: ["post-1"], actionIds: ["action-1"], createdAt: new Date("2026-10-01T11:00:00.000Z"),
    ...overrides,
  };
}

describe("DecisionTrail", () => {
  it("records steps in order, bounds long text, and summarizes what was taken", () => {
    const trail = new DecisionTrail({
      agent: "commons-action-agent", coopId: "harbor", sourceType: "commons_post", sourceId: "post-1", trigger: "NEW_CONTENT",
      visibility: "COMMONS_MEMBERS", observed: { content: "x".repeat(10_000) },
    });
    trail.step("OBSERVED", "Read a post").step("CONSIDERED", "Answer a question", { detail: "y".repeat(5_000) });
    expect(trail.policy("Has reply text", true)).toBe(true);
    expect(trail.policy("Confident enough", false)).toBe(false);
    trail.taken("Queued the reply for a platform admin to review", "INFO").taken("Invited @sam", "INFO", undefined, true);
    const snapshot = trail.snapshot();
    expect(snapshot.steps.map((step) => step.stage)).toEqual(["OBSERVED", "CONSIDERED", "POLICY", "POLICY", "TAKEN", "TAKEN"]);
    expect(snapshot.steps[3]).toMatchObject({ outcome: "FAIL" });
    expect(snapshot.observed.content!.length).toBeLessThanOrEqual(4000);
    expect(snapshot.steps[1]!.detail!.length).toBeLessThanOrEqual(2000);
    // Admin-only steps never leak into the one-line outcome members can see.
    expect(snapshot.outcome).toBe("Queued the reply for a platform admin to review");
  });

  it("never lets a failed save change what Sage does", async () => {
    db.sageDecisionTrail.create.mockRejectedValueOnce(new Error("db down"));
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    const trail = new DecisionTrail({ agent: "commons-action-agent", coopId: "harbor", sourceType: "commons_post", sourceId: "p", trigger: "NEW_CONTENT", visibility: "COMMONS_MEMBERS", observed: {} });
    await expect(trail.save()).resolves.toBeNull();
  });
});

describe("presenting trails", () => {
  it("adds a live result and follow-up from the linked suggestion", async () => {
    db.commonsAction.findMany.mockResolvedValue([{ id: "action-1", type: "SUGGEST_ACTION", status: "PENDING" }]);
    db.commonsActionReview.findMany.mockResolvedValue([{ actionId: "action-1", reviewType: "APPROVE_SUGGESTION", status: "PENDING" }]);
    const [view] = await presentTrails([trailRow()], { forAdmin: true });
    expect(view!.steps.slice(-2)).toEqual([
      expect.objectContaining({ stage: "RESULT", label: "Waiting for approval" }),
      expect.objectContaining({ stage: "FOLLOW_UP", label: expect.stringContaining("circle leader approves or declines") }),
    ]);
    expect(view!.triggerLabel).toBe("40 new items in the circle");
  });

  it("explains declines and refusals", async () => {
    db.commonsAction.findMany.mockResolvedValue([
      { id: "action-1", type: "SUGGEST_ACTION", status: "DISMISSED" },
      { id: "action-2", type: "SUGGEST_ACTION", status: "FAILED" },
    ]);
    db.commonsActionAudit.findMany.mockResolvedValue([
      { actionId: "action-2", eventType: "ACTION_REFUSED", metadata: { reason: "Target post is outside this suggestion's Commons and circle" }, createdAt: new Date() },
    ]);
    const [view] = await presentTrails([trailRow({ actionIds: ["action-1", "action-2"] })], { forAdmin: true });
    const results = view!.steps.filter((step) => step.stage === "RESULT" || step.stage === "FOLLOW_UP");
    expect(results[0]).toMatchObject({ label: "Declined or removed" });
    expect(results[1]!.label).toContain("won't repeat it in this circle for 30 days");
    expect(results[2]).toMatchObject({ label: "Couldn't complete", detail: expect.stringContaining("outside this suggestion's Commons and circle") });
  });

  it("removes admin-only steps and admin escalations from a member's view", async () => {
    db.commonsAction.findMany.mockResolvedValue([
      { id: "action-1", type: "SUGGEST_ACTION", status: "PUBLISHED" },
      { id: "action-esc", type: "ESCALATE_TO_ADMIN", status: "PENDING" },
    ]);
    const [member] = await presentTrails([trailRow({ actionIds: ["action-1", "action-esc"] })], { forAdmin: false });
    expect(member!.steps.some((step) => step.label.includes("@sam"))).toBe(false);
    expect(member!.steps.filter((step) => step.stage === "RESULT")).toEqual([expect.objectContaining({ label: "Published" })]);
    expect(member!.actionIds).toEqual(["action-1"]);
    expect(member!.hiddenSteps).toBeGreaterThan(0);
    const [admin] = await presentTrails([trailRow({ actionIds: ["action-1", "action-esc"] })], { forAdmin: true });
    expect(admin!.steps.some((step) => step.label.includes("@sam"))).toBe(true);
  });
});

describe("reply policy checks", () => {
  it("names every rule an automatic reply must pass", () => {
    const config = { charterText: "Members share tools and maintain a community workshop.", missionGoals: [] } as never;
    const item = { sourceType: "commons_post", sourceId: "p", sourcePostId: "p", sourceAuthorId: "u", createdAt: new Date("2026-10-01T10:00:00Z"), title: "", content: "Can I borrow a drill?", context: "", coopId: "harbor" } as const;
    const action = { type: "ANSWER_QUESTION", summary: "s", evidence: "Members share tools", confidence: 0.6, draftText: "Yes.", resourceKind: "", resourceTitle: "", targetHandle: "" } as const;
    const checks = replyPolicyChecks(action, item, config, true, new Date("2026-10-01T12:00:00Z"));
    expect(checks.find((check) => check.label.startsWith("Confident enough"))).toMatchObject({ passed: false, detail: "Confidence 60%" });
    expect(checks.filter((check) => !check.passed)).toHaveLength(1);
  });
});

describe("member access to trails", () => {
  function routerDb(overrides: Record<string, unknown>) {
    return {
      session: {
        findUnique: vi.fn().mockResolvedValue({ id: "s", userId: "user-1", isRevoked: false, expiresAt: new Date(Date.now() + 60000) }),
        update: vi.fn().mockResolvedValue({}),
      },
      commonsAction: db.commonsAction, commonsActionReview: db.commonsActionReview, commonsActionAudit: db.commonsActionAudit, proposal: db.proposal,
      commonsPost: { findMany: vi.fn().mockResolvedValue([{ id: "post-1" }]) },
      commonsComment: { findMany: vi.fn().mockResolvedValue([]) },
      userCoopMembership: { findMany: vi.fn().mockResolvedValue([{ coopId: "harbor" }]) },
      groupMember: { findMany: vi.fn().mockResolvedValue([]) },
      ...overrides,
    };
  }
  const caller = (client: Record<string, unknown>) => sageRouter.createCaller({ db: client, req: { headers: { "x-session-token": "t" } }, res: {}, coopId: undefined } as never);
  const user = (show: boolean) => ({
    findUnique: vi.fn().mockResolvedValue({ id: "user-1", email: "u@example.com", handle: "u", name: "U", phone: null, roles: [], status: "ACTIVE", showSageDecisionTrails: show }),
  });

  it("returns nothing until the member turns the setting on", async () => {
    const findMany = vi.fn();
    const result = await caller(routerDb({ user: user(false), sageDecisionTrail: { findMany } })).listTrails({ postId: "post-1" });
    expect(result).toEqual({ enabled: false, trails: [] });
    expect(findMany).not.toHaveBeenCalled();
  });

  it("never queries admin-only trails, and hides a circle's trail from someone outside the circle", async () => {
    const findMany = vi.fn().mockResolvedValue([
      trailRow(),
      trailRow({ id: "trail-2", circleId: null, sourceType: "commons_post", sourceId: "post-1", visibility: "COMMONS_MEMBERS", steps: [], actionIds: [] }),
    ]);
    const result = await caller(routerDb({ user: user(true), sageDecisionTrail: { findMany } })).listTrails({ postId: "post-1" });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { visibility: { not: "ADMINS" }, relatedPostIds: { has: "post-1" } } }));
    expect(result.trails.map((trail) => trail.id)).toEqual(["trail-2"]);
  });

  it("shows a circle trail to a circle member and redacts deleted Commons content", async () => {
    const findMany = vi.fn().mockResolvedValue([
      trailRow(),
      trailRow({ id: "trail-3", circleId: null, sourceType: "commons_comment", sourceId: "comment-gone", visibility: "COMMONS_MEMBERS", observed: { content: "secret" }, steps: [], actionIds: [] }),
    ]);
    const result = await caller(routerDb({
      user: user(true), sageDecisionTrail: { findMany },
      groupMember: { findMany: vi.fn().mockResolvedValue([{ groupId: "circle-1", group: { coopId: "harbor" } }]) },
    })).listTrails({ postId: "post-1" });
    expect(result.trails.map((trail) => trail.id)).toEqual(["trail-1", "trail-3"]);
    expect(result.trails[1]!.observed).toEqual({ content: "This content was deleted." });
  });
});
