import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  aICostEvent: { aggregate: vi.fn() },
  commonsAgentSetting: { findUnique: vi.fn() },
  commonsAction: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), upsert: vi.fn() },
  commonsActionParticipant: { findMany: vi.fn(), upsert: vi.fn() },
  commonsActionReview: { findFirst: vi.fn(), create: vi.fn() },
  commonsActionAudit: { create: vi.fn() },
  commonsPost: { findUnique: vi.fn(), findMany: vi.fn() },
  commonsComment: { findFirst: vi.fn(), create: vi.fn(), delete: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
  commonsProposalDraft: { upsert: vi.fn() },
  commonsContentScan: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  circleAgentWindow: { findUnique: vi.fn() },
  group: { findUnique: vi.fn() },
  groupComment: { findMany: vi.fn() },
  sageDecisionTrail: { create: vi.fn().mockResolvedValue({ id: "trail-1" }) },
}));
const run = vi.hoisted(() => vi.fn());

vi.mock("@repo/db", () => ({ db }));
vi.mock("@openai/agents", () => {
  class MockAgent { constructor(_opts: unknown) {} }
  return { Agent: MockAgent, run };
});
vi.mock("../lib/bot.js", () => ({ ensureSageBotUser: vi.fn().mockResolvedValue({ id: "sage-bot" }) }));
vi.mock("../services/push-notification-service.js", () => ({ createNotificationAndPush: vi.fn().mockResolvedValue(undefined) }));

const { getSageAutonomyUsage, sageAutonomyAllowed, sageAutonomyLimits, AUTONOMOUS_SAGE_FEATURES } = await import("../services/sage-autonomy.js");
const { loadCircleOutcomeMemory, OUTCOME_MEMORY_MAX_CHARS } = await import("../services/sage-outcome-memory.js");
const { createTrendSuggestion, findRepeatedSuggestion, isActionableTrend, mayCommentAutonomously, processTrendWindow, titlesNearlyIdentical } = await import("../services/sage-trend-agent.js");
const { executeSageAction, publishSageCommentAutonomously } = await import("../services/commons-action-tools.js");
const { createNotificationAndPush } = await import("../services/push-notification-service.js");

function usage(costUsd: string | null, calls: number) {
  return { _sum: { costUsd }, _count: { _all: calls } };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.commonsAgentSetting.findUnique.mockResolvedValue(null);
});

describe("Sage autonomy limit", () => {
  it("defaults to $5 and 2,000 calls and uses the Commons' own settings when present", async () => {
    expect(await sageAutonomyLimits("harbor")).toEqual({ usdLimit: 5, callLimit: 2000 });
    db.commonsAgentSetting.findUnique.mockResolvedValueOnce({ autonomyMonthlyUsdLimit: "12.50", autonomyMonthlyCallLimit: 300 });
    expect(await sageAutonomyLimits("harbor")).toEqual({ usdLimit: 12.5, callLimit: 300 });
    expect(db.commonsAgentSetting.findUnique).toHaveBeenLastCalledWith(expect.objectContaining({ where: { coopId: "harbor" } }));
  });

  it("pauses at a Commons' own lower limit", async () => {
    db.commonsAgentSetting.findUnique.mockResolvedValueOnce({ autonomyMonthlyUsdLimit: "0.50", autonomyMonthlyCallLimit: 2000 });
    db.aICostEvent.aggregate.mockResolvedValueOnce(usage("0.6", 10));
    expect(await getSageAutonomyUsage("harbor", db as never)).toMatchObject({ usdLimit: 0.5, paused: true, pausedReason: "USD_LIMIT" });
  });

  it("counts only autonomous Sage features for this Commons in the current UTC month", async () => {
    db.aICostEvent.aggregate.mockResolvedValue(usage("1.5", 10));
    const result = await getSageAutonomyUsage("harbor", db as never, new Date("2026-10-15T12:00:00.000Z"));
    expect(db.aICostEvent.aggregate).toHaveBeenCalledWith(expect.objectContaining({
      where: { coopId: "harbor", feature: { in: [...AUTONOMOUS_SAGE_FEATURES] }, createdAt: { gte: new Date("2026-10-01T00:00:00.000Z") } },
    }));
    expect(result).toMatchObject({ usd: 1.5, calls: 10, paused: false, pausedReason: null, resetsAt: "2026-11-01T00:00:00.000Z" });
  });

  it("pauses at either the dollar limit or the call limit", async () => {
    db.aICostEvent.aggregate.mockResolvedValueOnce(usage("5", 10));
    expect(await getSageAutonomyUsage("harbor", db as never)).toMatchObject({ paused: true, pausedReason: "USD_LIMIT" });
    // Unpriced calls add no dollars but still count toward the call limit.
    db.aICostEvent.aggregate.mockResolvedValueOnce(usage(null, 2000));
    expect(await getSageAutonomyUsage("harbor", db as never)).toMatchObject({ paused: true, pausedReason: "CALL_LIMIT" });
  });

  it("refuses autonomous work when usage cannot be read", async () => {
    db.aICostEvent.aggregate.mockRejectedValueOnce(new Error("db down"));
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    expect(await sageAutonomyAllowed("harbor")).toBe(false);
  });

  it("skips trend detection without claiming the window or calling the model once paused", async () => {
    db.circleAgentWindow.findUnique.mockResolvedValue({ id: "w1", groupId: "g1", coopId: "harbor", status: "CLOSED", openedAt: new Date(), closedAt: new Date(), lastMessageAt: new Date() });
    db.group.findUnique.mockResolvedValue({ leaderId: "leader-1", name: "Garden" });
    db.groupComment.findMany.mockResolvedValue([{ content: "Let's do a cleanup day", createdAt: new Date(), author: { name: "Maya", handle: "maya" } }]);
    db.commonsPost.findMany.mockResolvedValue([]);
    db.aICostEvent.aggregate.mockResolvedValue(usage("9", 10));
    vi.spyOn(console, "warn").mockImplementationOnce(() => {});

    await expect(processTrendWindow("w1")).resolves.toEqual({ processed: 0 });
    expect(db.commonsContentScan.findUnique).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    // The skipped analysis is still recorded in the decision trail.
    expect(db.sageDecisionTrail.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      sourceType: "circle_window", sourceId: "w1", visibility: "CIRCLE", outcome: "Not analyzed: monthly limit reached",
    }), select: { id: true } });
  });
});

describe("Sage outcome memory", () => {
  it("is scoped to one circle and stays within its character budget", async () => {
    const long = "x".repeat(400);
    db.commonsAction.findMany.mockResolvedValue(Array.from({ length: 8 }, (_, index) => ({
      summary: `${long} ${index}`, status: index % 2 ? "DISMISSED" : "APPROVED", createdAt: new Date("2026-10-01T00:00:00.000Z"),
      payload: { capability: "create_event" }, feedback: null,
    })));
    const lines = await loadCircleOutcomeMemory("harbor", "circle-1", new Date("2026-10-03T00:00:00.000Z"));
    expect(db.commonsAction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ coopId: "harbor", circleId: "circle-1", type: "SUGGEST_ACTION" }),
      take: 8,
    }));
    expect(lines.join("").length).toBeLessThanOrEqual(OUTCOME_MEMORY_MAX_CHARS);
    expect(lines[1]).toMatch(/^\[DECLINED\] · 2026-10-01 · create_event · /);
  });

  it("includes reviewer corrections", async () => {
    db.commonsAction.findMany.mockResolvedValue([{
      summary: "Post about tool library", status: "DISMISSED", createdAt: new Date("2026-10-01T00:00:00.000Z"),
      payload: { capability: "create_circle_post" }, feedback: { rating: "NEEDS_WORK", notes: null, correctedText: "We already have one" },
    }]);
    const [line] = await loadCircleOutcomeMemory("harbor", "circle-1");
    expect(line).toContain("reviewer correction: We already have one");
  });
});

describe("Trend suggestion gate", () => {
  const base = { hasSuggestion: true, confidence: 0.8, capability: "create_event", title: "Cleanup day", body: "Hold a cleanup day.", reason: "Raised four times." };

  it("drops low-confidence or empty suggestions", () => {
    expect(isActionableTrend(base, [])).toBe(true);
    expect(isActionableTrend({ ...base, confidence: 0.59 }, [])).toBe(false);
    expect(isActionableTrend({ ...base, reason: " " }, [])).toBe(false);
  });

  it("requires a comment target that is one of this window's circle posts", () => {
    const comment = { ...base, capability: "comment_on_post" };
    expect(isActionableTrend({ ...comment, targetPostId: "post-1" }, ["post-1"])).toBe(true);
    expect(isActionableTrend({ ...comment, targetPostId: "post-elsewhere" }, ["post-1"])).toBe(false);
    expect(isActionableTrend(comment, ["post-1"])).toBe(false);
  });
});

describe("Approval-gated Sage tools", () => {
  function approvedAction(capability: string, extra: Record<string, unknown> = {}) {
    const action = {
      id: "action-1", coopId: "harbor", circleId: "circle-1", type: "SUGGEST_ACTION", status: "PENDING",
      payloadHash: "hash-1", summary: "Cleanup day", payload: { capability, title: "Cleanup day", body: "Sage's text", ...extra },
    };
    db.commonsAction.findUnique.mockResolvedValue(action);
    db.commonsActionParticipant.findMany.mockResolvedValue([{ userId: "leader-1", role: "SUBJECT" }]);
    db.commonsActionReview.findFirst.mockResolvedValue({ id: "review-1", payloadHash: "hash-1" });
    return action;
  }

  it("comments as Sage on a post in the same Commons and circle", async () => {
    approvedAction("comment_on_post", { targetPostId: "post-1" });
    db.commonsPost.findUnique.mockResolvedValue({ id: "post-1", coopId: "harbor", circleId: "circle-1" });
    db.commonsComment.findFirst.mockResolvedValue(null);
    db.commonsComment.create.mockResolvedValue({ id: "comment-1" });

    await executeSageAction("action-1");
    expect(db.commonsComment.create).toHaveBeenCalledWith({ data: { postId: "post-1", authorId: "sage-bot", content: "Sage's text" } });
    expect(db.commonsAction.update).toHaveBeenCalledWith({ where: { id: "action-1" }, data: { status: "APPROVED", reviewedAt: expect.any(Date) } });
    expect(createNotificationAndPush).not.toHaveBeenCalled();
  });

  it("refuses to comment on a post in another circle and marks the action failed", async () => {
    approvedAction("comment_on_post", { targetPostId: "post-2" });
    db.commonsPost.findUnique.mockResolvedValue({ id: "post-2", coopId: "harbor", circleId: "private-circle" });

    await executeSageAction("action-1");
    expect(db.commonsComment.create).not.toHaveBeenCalled();
    expect(db.commonsAction.update).toHaveBeenCalledWith({ where: { id: "action-1" }, data: { status: "FAILED" } });
    expect(db.commonsActionAudit.create).toHaveBeenCalledWith({ data: {
      actionId: "action-1", eventType: "ACTION_REFUSED", metadata: { reason: "Target post is outside this suggestion's Commons and circle" },
    } });
  });

  it("keeps Sage to one comment per post", async () => {
    approvedAction("comment_on_post", { targetPostId: "post-1" });
    db.commonsPost.findUnique.mockResolvedValue({ id: "post-1", coopId: "harbor", circleId: "circle-1" });
    db.commonsComment.findFirst.mockResolvedValue({ id: "earlier-sage-comment" });

    await executeSageAction("action-1");
    expect(db.commonsComment.create).not.toHaveBeenCalled();
    expect(db.commonsAction.update).toHaveBeenCalledWith({ where: { id: "action-1" }, data: { status: "FAILED" } });
  });

  it("creates an editable, unsubmitted proposal draft owned by the approving member", async () => {
    approvedAction("draft_proposal");
    db.commonsProposalDraft.upsert.mockResolvedValue({ id: "draft-1" });

    await executeSageAction("action-1");
    expect(db.commonsProposalDraft.upsert).toHaveBeenCalledWith({
      where: { actionId: "action-1" },
      create: { actionId: "action-1", coopId: "harbor", authorId: "leader-1", title: "Cleanup day", body: "Sage's text" },
      update: {},
    });
    const draftData = db.commonsProposalDraft.upsert.mock.calls[0]![0].create;
    expect(draftData).not.toHaveProperty("submittedAt");
    expect(createNotificationAndPush).toHaveBeenCalledTimes(1);
    expect(createNotificationAndPush).toHaveBeenCalledWith(db, expect.objectContaining({ userId: "leader-1", type: "PROPOSAL_DRAFT_READY" }));
  });
});

describe("Autonomous Sage comments", () => {
  const comment = { hasSuggestion: true, confidence: 0.75, capability: "comment_on_post", title: "t", body: "b", reason: "r", targetPostId: "post-1" };

  it("comments without approval only when confident and Auto-reply is on", () => {
    expect(mayCommentAutonomously(comment, true)).toBe(true);
    expect(mayCommentAutonomously({ ...comment, confidence: 0.74 }, true)).toBe(false);
    expect(mayCommentAutonomously(comment, false)).toBe(false);
    expect(mayCommentAutonomously({ ...comment, capability: "draft_proposal" }, true)).toBe(false);
  });

  function pendingComment(targetPostId = "post-1") {
    db.commonsAction.findUnique.mockResolvedValue({
      id: "action-9", coopId: "harbor", circleId: "circle-1", type: "SUGGEST_ACTION", status: "PENDING",
      summary: "s", payload: { capability: "comment_on_post", title: "t", body: "Sage's comment", targetPostId },
    });
    db.commonsActionParticipant.findMany.mockResolvedValue([{ userId: "leader-1", role: "SUBJECT" }]);
    db.commonsPost.findUnique.mockResolvedValue({ id: targetPostId, coopId: "harbor", circleId: "circle-1" });
    db.commonsComment.findFirst.mockResolvedValue(null);
    db.commonsComment.create.mockResolvedValue({ id: "comment-9" });
  }

  it("publishes the comment, records it as an auto-reply an admin can remove, and audits it", async () => {
    pendingComment();
    db.commonsAction.update.mockResolvedValue({});
    await expect(publishSageCommentAutonomously("action-9")).resolves.toEqual({ published: true });
    expect(db.commonsComment.create).toHaveBeenCalledWith({ data: { postId: "post-1", authorId: "sage-bot", content: "Sage's comment" } });
    expect(db.commonsAction.update).toHaveBeenCalledWith({ where: { id: "action-9" }, data: {
      status: "PUBLISHED", publishedCommentId: "comment-9", replySourceKey: "commons_post:post-1",
    } });
    expect(db.commonsActionAudit.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actionId: "action-9", eventType: "AUTO_PUBLISHED" }) });
  });

  it("withdraws its comment if another Sage path already claimed the post", async () => {
    pendingComment();
    db.commonsAction.update.mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002" })).mockResolvedValue({});
    await expect(publishSageCommentAutonomously("action-9")).resolves.toEqual({ published: false, reason: "Sage has already commented on this post" });
    expect(db.commonsComment.delete).toHaveBeenCalledWith({ where: { id: "comment-9" } });
    expect(db.commonsAction.update).toHaveBeenLastCalledWith({ where: { id: "action-9" }, data: { status: "FAILED" } });
  });

  it("sends an off-topic comment to the circle leader instead of posting it", async () => {
    db.commonsAction.findMany.mockResolvedValue([]);
    db.commonsAction.upsert.mockResolvedValue({ id: "action-10", status: "PENDING" });
    db.commonsActionReview.findFirst.mockResolvedValue(null);
    db.commonsPost.findUnique.mockResolvedValue({ title: "Ladder", content: "Can I borrow a ladder this weekend?" });
    const judge = vi.fn().mockResolvedValue({ relevant: false, reason: "The comment is about proposals, not the ladder." });
    await createTrendSuggestion("harbor", "circle-1", "leader-1", "window-3", "hash-3", { ...comment, confidence: 0.9, body: "Proposals need a vote." },
      { autoReply: true, relevanceJudge: judge });
    expect(judge).toHaveBeenCalledWith({ post: "Ladder\nCan I borrow a ladder this weekend?", reply: "Proposals need a vote.", evidence: "r" });
    expect(db.commonsComment.create).not.toHaveBeenCalled();
    expect(db.commonsActionReview.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actionId: "action-10", userId: "leader-1", reviewType: "APPROVE_SUGGESTION" }) });
  });

  it("does nothing for an action that is no longer pending", async () => {
    db.commonsAction.findUnique.mockResolvedValue({ id: "action-9", status: "PUBLISHED" });
    await expect(publishSageCommentAutonomously("action-9")).resolves.toMatchObject({ published: false });
    expect(db.commonsComment.create).not.toHaveBeenCalled();
  });
});

describe("Repeated suggestions", () => {
  it("treats titles as near-identical despite case, punctuation, filler words and plurals", () => {
    expect(titlesNearlyIdentical("Organize a cleanup day", "organize the Cleanup Days!")).toBe(true);
    expect(titlesNearlyIdentical("Cleanup day", "Organize a block cleanup day")).toBe(true);
    expect(titlesNearlyIdentical("Cleanup day", "Potluck dinner")).toBe(false);
    expect(titlesNearlyIdentical("Shared tool library", "shared tool libraries")).toBe(true);
    expect(titlesNearlyIdentical("Class schedule", "Glass schedule")).toBe(false);
    expect(titlesNearlyIdentical("Ride", "Ride share for the market")).toBe(false);
  });

  const prior = (overrides: Record<string, unknown>) => ({ id: "prior-1", summary: "Organize a cleanup day", status: "PENDING",
    payload: { capability: "create_event", title: "Organize a cleanup day" }, ...overrides });

  it("looks only at this circle's pending suggestions and those declined or done in the last 30 days", async () => {
    db.commonsAction.findMany.mockResolvedValue([]);
    const now = new Date("2026-10-31T00:00:00.000Z");
    await findRepeatedSuggestion("harbor", "circle-1", "window-2", { capability: "create_event", title: "Cleanup day" }, now);
    expect(db.commonsAction.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      coopId: "harbor", circleId: "circle-1", type: "SUGGEST_ACTION", sourceId: { not: "window-2" },
      OR: [
        { status: "PENDING" },
        { status: { in: ["DISMISSED", "APPROVED", "PUBLISHED"] }, createdAt: { gte: new Date("2026-10-01T00:00:00.000Z") } },
      ],
    } }));
  });

  it("matches the same post, or the same kind with a near-identical title, but not a different kind", async () => {
    db.commonsAction.findMany.mockResolvedValue([prior({})]);
    expect(await findRepeatedSuggestion("harbor", "circle-1", "w", { capability: "create_event", title: "Cleanup days" })).toMatchObject({ id: "prior-1" });
    expect(await findRepeatedSuggestion("harbor", "circle-1", "w", { capability: "create_circle_post", title: "Cleanup day" })).toBeNull();
    db.commonsAction.findMany.mockResolvedValue([prior({ payload: { capability: "comment_on_post", title: "Share pickup area", targetPostId: "post-7" } })]);
    expect(await findRepeatedSuggestion("harbor", "circle-1", "w", { capability: "comment_on_post", title: "Something else", targetPostId: "post-7" })).toMatchObject({ id: "prior-1" });
  });

  it("skips a repeat and records it on the earlier suggestion's audit trail", async () => {
    db.commonsAction.findMany.mockResolvedValue([prior({ status: "DISMISSED" })]);
    await createTrendSuggestion("harbor", "circle-1", "leader-1", "window-2", "hash-2", {
      hasSuggestion: true, confidence: 0.9, capability: "create_event", title: "Organize the cleanup day", body: "b", reason: "r",
    }, { autoReply: true });
    expect(db.commonsAction.upsert).not.toHaveBeenCalled();
    expect(db.commonsActionAudit.create).toHaveBeenCalledWith({ data: {
      actionId: "prior-1", actorId: null, eventType: "DUPLICATE_SKIPPED",
      metadata: { title: "Organize the cleanup day", capability: "create_event", windowId: "window-2", priorStatus: "DISMISSED" },
    } });
  });
});
