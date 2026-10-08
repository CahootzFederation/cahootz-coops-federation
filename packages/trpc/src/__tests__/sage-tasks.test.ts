import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  userCoopMembership: { findUnique: vi.fn() },
  sageTask: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  sageTaskEvent: { create: vi.fn() },
  sageWakeCycle: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  commonsPost: { findUnique: vi.fn() },
  commonsComment: { findFirst: vi.fn() },
  commonsAction: { findMany: vi.fn() },
  commonsProposalDraft: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
  proposal: { findUnique: vi.fn() },
  event: { findUnique: vi.fn() },
  sageDecisionTrail: { create: vi.fn().mockResolvedValue({ id: "trail" }) },
}));
const push = vi.hoisted(() => vi.fn().mockResolvedValue({ id: "n1" }));
vi.mock("@repo/db", () => ({ db }));
vi.mock("../services/push-notification-service.js", () => ({ createNotificationAndPush: push }));
const suggestions = vi.hoisted(() => ({ checkSuggestionReview: vi.fn(), closeSuggestion: vi.fn().mockResolvedValue(true) }));
vi.mock("../services/sage-suggestion-follow-up.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/sage-suggestion-follow-up.js")>()), ...suggestions,
}));

const tasks = await import("../services/sage-tasks.js");
const { createSageTask, clampFollowUpDays, checkTaskOutcome, wakeTask, claimDueTasks, reminderText, runSageWakeCycle, dismissSageTask } = tasks;

const NOW = new Date("2026-10-05T12:00:00.000Z");
const DAY = 86_400_000;

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1", coopId: "harbor", circleId: null, kind: "FOLLOW_UP", status: "OPEN", title: "Shared drivers",
    reason: "Sage asked on the post: share your delivery days", expected: "share your delivery days and costs",
    offer: "I can draft a small proposal so members can vote on it.", ownerUserId: "member-1",
    subjectType: "commons_post", subjectId: "post-1", postId: "post-1", sourceActionId: "a1",
    dueAt: NOW, nextWakeAt: NOW, attempts: 0, maxAttempts: 1, lastWokeAt: null, leaseUntil: null, outcome: null,
    createdBy: "SAGE", createdAt: new Date(NOW.getTime() - 3 * DAY), updatedAt: NOW, ...overrides,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  db.userCoopMembership.findUnique.mockResolvedValue({ status: "ACTIVE" });
  db.sageTask.findFirst.mockResolvedValue(null);
  db.sageTask.create.mockResolvedValue({ id: "task-new" });
  db.sageTask.update.mockResolvedValue({});
  db.commonsPost.findUnique.mockResolvedValue({ id: "post-1", circleId: "general:harbor", coopId: "harbor" });
  db.commonsComment.findFirst.mockResolvedValue(null);
  db.commonsAction.findMany.mockResolvedValue([]);
});

describe("creating tasks", () => {
  const input = { coopId: "harbor", kind: "FOLLOW_UP" as const, title: "t", reason: "r", ownerUserId: "member-1", subjectType: "commons_post" as const, subjectId: "post-1" };

  it("clamps the check-back time to 1-14 days, defaulting to 3", () => {
    expect([clampFollowUpDays(undefined), clampFollowUpDays(0), clampFollowUpDays(0.2), clampFollowUpDays(30), clampFollowUpDays(5)]).toEqual([3, 3, 1, 14, 5]);
  });

  it("creates a task due when asked, with its first history entry", async () => {
    await expect(createSageTask({ ...input, dueInDays: 2 }, NOW)).resolves.toEqual({ created: true, taskId: "task-new" });
    const data = db.sageTask.create.mock.calls[0]![0].data;
    expect(data.dueAt).toEqual(new Date(NOW.getTime() + 2 * DAY));
    expect(data.nextWakeAt).toEqual(data.dueAt);
    expect(data.events).toEqual({ create: { eventType: "CREATED", detail: "r" } });
  });

  it("won't follow someone who isn't an active member, double up, or recreate a dismissed task within 30 days", async () => {
    db.userCoopMembership.findUnique.mockResolvedValueOnce({ status: "PENDING" });
    expect(await createSageTask(input, NOW)).toMatchObject({ created: false });
    db.sageTask.findFirst.mockResolvedValueOnce({ id: "open-task" });
    expect(await createSageTask(input, NOW)).toMatchObject({ created: false, taskId: "open-task" });
    db.sageTask.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "dismissed" });
    expect(await createSageTask(input, NOW)).toMatchObject({ created: false, reason: "The member dismissed this recently" });
    expect(db.sageTask.findFirst).toHaveBeenLastCalledWith({
      where: expect.objectContaining({ status: "DISMISSED", updatedAt: { gte: new Date(NOW.getTime() - 30 * DAY) } }), select: { id: true },
    });
    expect(db.sageTask.create).not.toHaveBeenCalled();
  });
});

describe("verifying outcomes from app data", () => {
  it("a reply from the member after the task started resolves a post follow-up", async () => {
    db.commonsComment.findFirst.mockResolvedValueOnce({ id: "reply" });
    expect(await checkTaskOutcome(task(), NOW)).toEqual({ resolved: true, outcome: "The member replied in the thread" });
    expect(db.commonsComment.findFirst).toHaveBeenCalledWith({ where: { postId: "post-1", authorId: "member-1", createdAt: { gt: (task() as { createdAt: Date }).createdAt } }, select: { id: true } });
  });

  it("a draft made from the thread also resolves it, and a deleted post makes it moot", async () => {
    db.commonsAction.findMany.mockResolvedValueOnce([{ id: "act" }]);
    db.commonsProposalDraft.findFirst.mockResolvedValueOnce({ id: "draft" });
    expect(await checkTaskOutcome(task(), NOW)).toMatchObject({ resolved: true, outcome: "A proposal draft was created from the thread" });
    db.commonsPost.findUnique.mockResolvedValueOnce(null);
    expect(await checkTaskOutcome(task(), NOW)).toMatchObject({ resolved: true, moot: true });
  });

  it("checks drafts, proposals and events", async () => {
    db.commonsProposalDraft.findUnique.mockResolvedValueOnce({ submittedAt: NOW });
    expect(await checkTaskOutcome(task({ subjectType: "proposal_draft", subjectId: "d1" }), NOW)).toMatchObject({ resolved: true, outcome: "The draft was submitted" });
    db.proposal.findUnique.mockResolvedValueOnce({ status: "VOTABLE", votingEndsAt: new Date(NOW.getTime() + DAY) });
    expect(await checkTaskOutcome(task({ subjectType: "proposal", subjectId: "p1" }), NOW)).toEqual({ resolved: false });
    db.proposal.findUnique.mockResolvedValueOnce({ status: "APPROVED", votingEndsAt: null });
    expect(await checkTaskOutcome(task({ subjectType: "proposal", subjectId: "p1" }), NOW)).toMatchObject({ resolved: true });
    db.event.findUnique.mockResolvedValueOnce({ startAt: new Date(NOW.getTime() - 1000) });
    expect(await checkTaskOutcome(task({ subjectType: "event", subjectId: "e1" }), NOW)).toMatchObject({ resolved: true, moot: true });
  });
});

describe("waking a task", () => {
  it("closes a task whose outcome happened", async () => {
    db.commonsComment.findFirst.mockResolvedValueOnce({ id: "reply" });
    await expect(wakeTask(task(), NOW)).resolves.toBe("DONE");
    expect(db.sageTask.update).toHaveBeenCalledWith({ where: { id: "task-1" }, data: expect.objectContaining({ status: "DONE", outcome: "The member replied in the thread" }) });
    expect(push).not.toHaveBeenCalled();
    expect(db.sageDecisionTrail.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ agent: "cadence", sourceType: "sage_task", trigger: "SAGE_WAKE" }) }));
  });

  it("sends exactly one gentle reminder, then checks once more", async () => {
    await expect(wakeTask(task(), NOW)).resolves.toBe("REMINDED");
    expect(push).toHaveBeenCalledWith(db, expect.objectContaining({
      userId: "member-1", type: "SAGE_REMINDER", title: "Sage is checking in",
      body: "Still planning to share your delivery days and costs? Once you do, I can draft a small proposal so members can vote on it.",
      data: { taskId: "task-1", coopId: "harbor", postId: "post-1" },
    }));
    expect(db.sageTask.update).toHaveBeenCalledWith({ where: { id: "task-1" }, data: expect.objectContaining({
      attempts: { increment: 1 }, nextWakeAt: new Date(NOW.getTime() + 3 * DAY), leaseUntil: null,
    }) });
  });

  it("stops after the reminder instead of nagging", async () => {
    await expect(wakeTask(task({ attempts: 1 }), NOW)).resolves.toBe("ABANDONED");
    expect(push).not.toHaveBeenCalled();
    expect(db.sageTask.update).toHaveBeenCalledWith({ where: { id: "task-1" }, data: expect.objectContaining({ status: "ABANDONED" }) });
    expect(suggestions.closeSuggestion).not.toHaveBeenCalled();
  });
});

describe("waking a suggestion follow-up", () => {
  const suggestionTask = (overrides: Record<string, unknown> = {}) => task({
    kind: "REVIEW_SUGGESTION", subjectType: "suggestion_review", subjectId: "review-1", sourceActionId: "action-1", postId: null,
    circleId: "circle-1", title: "Fund a shared tool library", expected: "answer Sage's suggestion", offer: null, ...overrides,
  });

  it("reminds once with a link to the suggestion, then waits until it would close", async () => {
    suggestions.checkSuggestionReview.mockResolvedValueOnce({ resolved: false });
    await expect(wakeTask(suggestionTask(), NOW)).resolves.toBe("REMINDED");
    expect(push).toHaveBeenCalledWith(db, expect.objectContaining({
      userId: "member-1", type: "SAGE_SUGGESTION_REMINDER", title: "Sage is still waiting on you",
      body: "\"Fund a shared tool library\" needs your answer.",
      data: { taskId: "task-1", coopId: "harbor", actionId: "action-1" },
    }));
    expect(db.sageTask.update).toHaveBeenCalledWith({ where: { id: "task-1" }, data: expect.objectContaining({ nextWakeAt: new Date(NOW.getTime() + 4 * DAY) }) });
    // Suggestions are private to the people in them, so the trail is admin-only.
    expect(db.sageDecisionTrail.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ visibility: "ADMINS" }) }));
  });

  it("closes the suggestion when nobody answered after the reminder", async () => {
    suggestions.checkSuggestionReview.mockResolvedValueOnce({ resolved: false });
    await expect(wakeTask(suggestionTask({ attempts: 1 }), NOW)).resolves.toBe("ABANDONED");
    expect(push).not.toHaveBeenCalled();
    expect(suggestions.closeSuggestion).toHaveBeenCalledWith("action-1", "Nobody answered after Sage's reminder", "NO_RESPONSE", { skipTaskId: "task-1" });
  });

  it("closes the follow-up without a reminder once the member answered", async () => {
    suggestions.checkSuggestionReview.mockResolvedValueOnce({ resolved: true, outcome: "You approved it" });
    await expect(wakeTask(suggestionTask(), NOW)).resolves.toBe("DONE");
    expect(push).not.toHaveBeenCalled();
  });
});

describe("the wake loop", () => {
  it("claims due tasks with a lease so overlapping runs skip them", async () => {
    db.sageTask.findMany.mockResolvedValueOnce([task(), task({ id: "task-2" })]);
    db.sageTask.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const claimed = await claimDueTasks({ coopId: "harbor", now: NOW });
    expect(claimed.map((entry: { id: string }) => entry.id)).toEqual(["task-1"]);
    expect(db.sageTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { leaseUntil: new Date(NOW.getTime() + 10 * 60 * 1000) } }));
  });

  it("doesn't start a cycle while another one for the Commons holds the lease", async () => {
    db.sageWakeCycle.findFirst.mockResolvedValueOnce({ id: "running" });
    await expect(runSageWakeCycle("harbor", "SCHEDULED", NOW)).resolves.toEqual({ skipped: true });
    expect(db.sageWakeCycle.create).not.toHaveBeenCalled();
  });

  it("runs due tasks and the cycle's extra work, then records the cycle", async () => {
    db.sageWakeCycle.findFirst.mockResolvedValueOnce(null);
    db.sageWakeCycle.create.mockResolvedValueOnce({ id: "cycle-1" });
    db.commonsProposalDraft.findMany.mockResolvedValueOnce([]);
    db.sageTask.findMany.mockResolvedValueOnce([task()]);
    db.sageTask.updateMany.mockResolvedValueOnce({ count: 1 });
    const extra = vi.fn().mockResolvedValue(undefined);
    await expect(runSageWakeCycle("harbor", "MANUAL", NOW, extra)).resolves.toMatchObject({ processed: 1, results: { REMINDED: 1 } });
    expect(extra).toHaveBeenCalledWith("harbor");
    expect(db.sageWakeCycle.update).toHaveBeenCalledWith({ where: { id: "cycle-1" }, data: expect.objectContaining({ status: "DONE", tasksProcessed: 1 }) });
  });

  it("lets only the owner dismiss an open task", async () => {
    db.sageTask.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(dismissSageTask("task-1", "someone-else")).resolves.toBe(false);
    db.sageTask.updateMany.mockResolvedValueOnce({ count: 1 });
    await expect(dismissSageTask("task-1", "member-1")).resolves.toBe(true);
    expect(db.sageTaskEvent.create).toHaveBeenCalledWith({ data: { taskId: "task-1", eventType: "DISMISSED", detail: "Dismissed by the member" } });
  });

  it("words reminders for stale drafts", () => {
    expect(reminderText({ kind: "REVIEW_STALE_DRAFT", title: "Tool library", expected: null, offer: null } as never).title).toBe("Your proposal draft is waiting");
  });
});
