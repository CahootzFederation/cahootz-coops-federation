import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => {
  const client = {
    commonsActionParticipant: { findMany: vi.fn() },
    userCoopMembership: { count: vi.fn() },
    group: { findUnique: vi.fn() },
    groupMember: { findUnique: vi.fn() },
    groupComment: { findUnique: vi.fn() },
    commonsPost: { findUnique: vi.fn() },
    commonsComment: { findFirst: vi.fn() },
    commonsProposalDraft: { findMany: vi.fn() },
    commonsAction: { updateMany: vi.fn(), findUnique: vi.fn() },
    commonsActionReview: { updateMany: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    commonsActionAudit: { create: vi.fn() },
    sageTask: { findMany: vi.fn(), update: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  };
  client.$transaction.mockImplementation((fn: (tx: typeof client) => unknown) => fn(client));
  return client;
});
const push = vi.hoisted(() => vi.fn().mockResolvedValue({ id: "n1" }));
vi.mock("@repo/db", () => ({ db }));
vi.mock("../services/push-notification-service.js", () => ({ createNotificationAndPush: push }));

const {
  suggestionNoLongerApplies, closeSuggestion, checkSuggestionReview, followUpOnSuggestions, resolveSuggestionReviewTask,
  SUGGESTION_REMIND_AFTER_DAYS, SUGGESTION_CLOSE_AFTER_DAYS,
} = await import("../services/sage-suggestion-follow-up.js");

const NOW = new Date("2026-10-07T12:00:00.000Z");
const DAY = 86_400_000;

function action(overrides: Record<string, unknown> = {}) {
  return {
    id: "a1", coopId: "harbor", status: "PENDING", summary: "Fund a shared tool library", sourceType: "circle_trend", sourceId: "w1",
    circleId: "circle-1", createdAt: new Date(NOW.getTime() - DAY),
    payload: { capability: "comment_on_post", title: "Tool library", targetPostId: "post-1" }, ...overrides,
  } as never;
}
const review = (overrides: Record<string, unknown> = {}) => ({
  id: "r1", actionId: "a1", userId: "leader-1", reviewType: "APPROVE_SUGGESTION", status: "PENDING",
  createdAt: new Date(NOW.getTime() - DAY), ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation((fn: (tx: typeof db) => unknown) => fn(db));
  db.commonsActionParticipant.findMany.mockResolvedValue([{ userId: "leader-1" }]);
  db.userCoopMembership.count.mockResolvedValue(1);
  db.group.findUnique.mockResolvedValue({ leaderId: "leader-1" });
  db.groupMember.findUnique.mockResolvedValue({ id: "m1" });
  db.groupComment.findUnique.mockResolvedValue({ id: "msg-1" });
  db.commonsPost.findUnique.mockResolvedValue({ id: "post-1" });
  db.commonsComment.findFirst.mockResolvedValue(null);
  db.commonsProposalDraft.findMany.mockResolvedValue([]);
  db.commonsAction.updateMany.mockResolvedValue({ count: 1 });
  db.commonsAction.findUnique.mockResolvedValue({ coopId: "harbor", summary: "Fund a shared tool library" });
  db.commonsActionReview.updateMany.mockResolvedValue({ count: 1 });
  db.commonsActionReview.findMany.mockResolvedValue([]);
  db.sageTask.findMany.mockResolvedValue([]);
  db.sageTask.create.mockResolvedValue({ id: "t-new" });
});

describe("deciding whether a waiting suggestion still applies", () => {
  it("still applies when everything it depends on is there", async () => {
    await expect(suggestionNoLongerApplies(review(), action(), NOW)).resolves.toBeNull();
  });

  it.each([
    ["someone left the Commons", () => db.userCoopMembership.count.mockResolvedValue(0), "Someone it involved is no longer an active member of this Commons"],
    ["the circle was deleted", () => db.group.findUnique.mockResolvedValue(null), "The circle was deleted"],
    ["the circle has a new leader", () => db.group.findUnique.mockResolvedValue({ leaderId: "someone-else" }), "The circle has a new leader"],
    ["the target post was deleted", () => db.commonsPost.findUnique.mockResolvedValue(null), "The post it was about was deleted"],
    ["Sage already commented there", () => db.commonsComment.findFirst.mockResolvedValue({ id: "c1" }), "Sage already commented on that post"],
  ])("closes when %s", async (_label, arrange, reason) => {
    arrange();
    await expect(suggestionNoLongerApplies(review(), action(), NOW)).resolves.toBe(reason);
  });

  it("closes a ride match whose message was deleted, and one whose member left the circle", async () => {
    const ride = action({ type: "RIDE_MATCH_PROPOSAL", sourceType: "circle_message", sourceId: "msg-1", payload: null });
    db.commonsActionParticipant.findMany.mockResolvedValue([{ userId: "maya" }]);
    db.groupComment.findUnique.mockResolvedValueOnce(null);
    await expect(suggestionNoLongerApplies(review({ reviewType: "PROVIDE_CONTEXT", userId: "maya" }), ride, NOW)).resolves.toBe("The message it came from was deleted");
    db.groupMember.findUnique.mockResolvedValueOnce(null);
    await expect(suggestionNoLongerApplies(review({ reviewType: "PROVIDE_CONTEXT", userId: "maya" }), ride, NOW)).resolves.toBe("The person asked left the circle");
  });

  it("closes an event whose suggested time passed, and a proposal the leader already drafted", async () => {
    const event = action({ payload: { capability: "create_event", title: "Cleanup", suggestedStartAt: new Date(NOW.getTime() - 3_600_000).toISOString() } });
    await expect(suggestionNoLongerApplies(review(), event, NOW)).resolves.toBe("The suggested time has passed");
    db.commonsProposalDraft.findMany.mockResolvedValueOnce([{ title: "Shared tool libraries" }]);
    const draft = action({ payload: { capability: "draft_proposal", title: "Shared tool library" } });
    await expect(suggestionNoLongerApplies(review(), draft, NOW)).resolves.toBe("A proposal draft on this already exists");
  });
});

describe("closing a suggestion", () => {
  it("dismisses it, expires unanswered reviews, records why, closes open follow-ups and tells only those who said yes, without a push", async () => {
    db.sageTask.findMany.mockResolvedValueOnce([{ id: "t-helper" }]);
    db.commonsActionReview.findMany.mockResolvedValueOnce([{ userId: "need-1" }]);
    await expect(closeSuggestion("a1", "Nobody answered after Sage's reminder", "NO_RESPONSE")).resolves.toBe(true);
    expect(db.commonsAction.updateMany).toHaveBeenCalledWith({ where: { id: "a1", status: "PENDING" }, data: { status: "DISMISSED" } });
    expect(db.commonsActionReview.updateMany).toHaveBeenCalledWith({ where: { actionId: "a1", status: "PENDING" }, data: { status: "EXPIRED", respondedAt: expect.any(Date) } });
    expect(db.commonsActionAudit.create).toHaveBeenCalledWith({ data: { actionId: "a1", actorId: null, eventType: "AUTO_CLOSED", metadata: { reason: "Nobody answered after Sage's reminder", kind: "NO_RESPONSE" } } });
    expect(db.sageTask.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "t-helper" }, data: expect.objectContaining({ status: "DONE" }) }));
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith(db, expect.objectContaining({ userId: "need-1", type: "SAGE_SUGGESTION_CLOSED", push: false, data: { actionId: "a1" } }));
  });

  it("does nothing to a suggestion that already finished", async () => {
    db.commonsAction.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(closeSuggestion("a1", "x", "NO_LONGER_APPLIES")).resolves.toBe(false);
    expect(db.commonsActionReview.updateMany).not.toHaveBeenCalled();
    expect(db.commonsActionAudit.create).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});

describe("the wake loop's check on one follow-up", () => {
  it("is done once the member answered", async () => {
    db.commonsActionReview.findUnique.mockResolvedValue({ ...review({ status: "APPROVED" }), action: action() });
    await expect(checkSuggestionReview({ id: "t1", subjectId: "r1" }, NOW)).resolves.toEqual({ resolved: true, outcome: "You approved it" });
  });

  it("closes the suggestion when it no longer applies", async () => {
    db.commonsActionReview.findUnique.mockResolvedValue({ ...review(), action: action() });
    db.commonsPost.findUnique.mockResolvedValue(null);
    await expect(checkSuggestionReview({ id: "t1", subjectId: "r1" }, NOW))
      .resolves.toEqual({ resolved: true, moot: true, outcome: "Closed: the post it was about was deleted" });
    expect(db.commonsActionAudit.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ eventType: "AUTO_CLOSED" }) }));
  });

  it("keeps waiting while it applies and nobody answered", async () => {
    db.commonsActionReview.findUnique.mockResolvedValue({ ...review(), action: action() });
    await expect(checkSuggestionReview({ id: "t1", subjectId: "r1" }, NOW)).resolves.toEqual({ resolved: false });
  });
});

describe("each wake cycle's sweep", () => {
  const pending = (overrides: Record<string, unknown> = {}) => ({ ...review(overrides), action: action() });

  it("starts one follow-up per waiting answer, due after the reminder delay", async () => {
    db.commonsActionReview.findMany.mockResolvedValueOnce([pending()]);
    await expect(followUpOnSuggestions("harbor", NOW)).resolves.toEqual({ scheduled: 1, closed: 0 });
    const data = db.sageTask.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({ kind: "REVIEW_SUGGESTION", subjectType: "suggestion_review", subjectId: "r1", sourceActionId: "a1", ownerUserId: "leader-1", createdBy: "SYSTEM" });
    expect(data.dueAt).toEqual(new Date(NOW.getTime() - DAY + SUGGESTION_REMIND_AFTER_DAYS * DAY));
  });

  it("doesn't start a second follow-up, even after the first was dismissed", async () => {
    db.commonsActionReview.findMany.mockResolvedValueOnce([pending()]);
    db.sageTask.findMany.mockResolvedValueOnce([{ subjectId: "r1", status: "DISMISSED" }]);
    await expect(followUpOnSuggestions("harbor", NOW)).resolves.toEqual({ scheduled: 0, closed: 0 });
    expect(db.sageTask.create).not.toHaveBeenCalled();
  });

  it("closes a suggestion nobody answered in time when no follow-up is open, but leaves one with an open follow-up to it", async () => {
    const old = new Date(NOW.getTime() - SUGGESTION_CLOSE_AFTER_DAYS * DAY);
    db.commonsActionReview.findMany.mockResolvedValueOnce([pending({ createdAt: old })]);
    db.sageTask.findMany.mockResolvedValueOnce([{ subjectId: "r1", status: "OPEN" }]);
    await expect(followUpOnSuggestions("harbor", NOW)).resolves.toEqual({ scheduled: 0, closed: 0 });

    db.commonsActionReview.findMany.mockResolvedValueOnce([pending({ createdAt: old })]);
    await expect(followUpOnSuggestions("harbor", NOW)).resolves.toEqual({ scheduled: 0, closed: 1 });
    expect(db.commonsActionAudit.create).toHaveBeenCalledWith({ data: expect.objectContaining({ metadata: { reason: `Nobody answered within ${SUGGESTION_CLOSE_AFTER_DAYS} days`, kind: "NO_RESPONSE" } }) });
  });

  it("closes a suggestion that no longer applies right away, once per suggestion", async () => {
    db.commonsActionReview.findMany.mockResolvedValueOnce([pending(), pending({ id: "r2", userId: "helper-1" })]);
    db.commonsPost.findUnique.mockResolvedValue(null);
    await expect(followUpOnSuggestions("harbor", NOW)).resolves.toEqual({ scheduled: 0, closed: 1 });
    expect(db.commonsAction.updateMany).toHaveBeenCalledTimes(1);
  });
});

it("closes the follow-up as soon as the member answers", async () => {
  db.sageTask.findMany.mockResolvedValueOnce([{ id: "t1" }]);
  await resolveSuggestionReviewTask("r1", "You declined it");
  expect(db.sageTask.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: {
    status: "DONE", outcome: "You declined it", leaseUntil: null, events: { create: { eventType: "RESOLVED", detail: "You declined it" } },
  } });
});
