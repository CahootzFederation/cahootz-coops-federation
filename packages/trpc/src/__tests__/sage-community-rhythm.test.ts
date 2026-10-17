import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  commonsAction: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  commonsActionAudit: { create: vi.fn(), findMany: vi.fn() },
  commonsPost: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
  commonsComment: { findMany: vi.fn(), findFirst: vi.fn() },
  commonsResource: { findMany: vi.fn() },
  coopConfig: { findFirst: vi.fn() },
  event: { findMany: vi.fn() },
  proposal: { findMany: vi.fn(), count: vi.fn() },
  proposalGoalScore: { findMany: vi.fn() },
  sageTask: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), count: vi.fn() },
  user: { findMany: vi.fn() },
  userCoopMembership: { count: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
}));
const push = vi.hoisted(() => ({ createNotificationAndPush: vi.fn() }));
vi.mock("@repo/db", () => ({ db }));
vi.mock("../lib/bot.js", () => ({ ensureSageBotUser: vi.fn().mockResolvedValue({ id: "sage-bot" }) }));
vi.mock("../services/push-notification-service.js", () => push);

const rhythm = await import("../services/sage-community-rhythm.js");
const { checkSageOutput } = await import("../services/untrusted-input.js");
const { FULFILLED_TASK_OUTCOMES } = await import("../services/sage-tasks.js");
const {
  appreciationText, dueRhythms, EMPTY_ACTIVITY, gatherActivity, isoWeekKey, monthlyText,
  openWorkText, prioritiesText, publishRhythmPost, runCommunityRhythm, explicitCommitment,
  gatherMondayFollowUp, gatherStopCandidates, hasActiveRhythmDiscussion, RHYTHM_MIN_ACTIVE_MEMBERS,
} = rhythm;

const at = (iso: string) => new Date(iso);
const FRIDAY = at("2026-10-16T15:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  for (const model of Object.values(db)) for (const fn of Object.values(model)) (fn as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  db.commonsAction.findUnique.mockResolvedValue(null);
  db.commonsAction.create.mockResolvedValue({ id: "action-1" });
  db.commonsAction.update.mockResolvedValue({});
  db.commonsActionAudit.create.mockResolvedValue({});
  db.commonsPost.create.mockResolvedValue({ id: "post-1" });
  db.commonsPost.findFirst.mockResolvedValue(null);
  db.commonsComment.findFirst.mockResolvedValue(null);
  db.coopConfig.findFirst.mockResolvedValue({ isDemo: false, missionGoals: [] });
  db.userCoopMembership.count.mockResolvedValue(12);
  db.userCoopMembership.findUnique.mockResolvedValue({ status: "ACTIVE" });
  db.sageTask.create.mockResolvedValue({ id: "task-1" });
  db.sageTask.findFirst.mockResolvedValue(null);
  db.sageTask.count.mockResolvedValue(0);
  db.proposal.count.mockResolvedValue(0);
  push.createNotificationAndPush.mockResolvedValue({ id: "n-1" });
});
describe("the schedule", () => {
  it("keys weeks by ISO week", () => {
    expect(isoWeekKey(at("2026-10-16T12:00:00Z"))).toBe("2026-W42");
    expect(isoWeekKey(at("2021-01-03T12:00:00Z"))).toBe("2020-W53");
    expect(isoWeekKey(at("2026-10-12T00:00:00Z"))).toBe(isoWeekKey(at("2026-10-18T23:00:00Z")));
  });

  it("posts each ritual in its two-day window, waiting for the posting hour on the first day", () => {
    expect(dueRhythms(at("2026-10-12T09:00:00Z"))).toEqual([]);
    expect(dueRhythms(at("2026-10-12T14:00:00Z"))).toEqual([{ category: "weekly_priorities", periodKey: "2026-W42" }]);
    expect(dueRhythms(at("2026-10-13T02:00:00Z"))).toEqual([{ category: "weekly_priorities", periodKey: "2026-W42" }]);
    expect(dueRhythms(at("2026-10-14T14:00:00Z")).map((entry) => entry.category)).toEqual(["midweek_open_work"]);
    expect(dueRhythms(FRIDAY).map((entry) => entry.category)).toEqual(["friday_appreciation"]);
    expect(dueRhythms(at("2026-10-18T14:00:00Z"))).toEqual([]);
  });

  it("reviews the month before on the first days of a month", () => {
    expect(dueRhythms(at("2026-10-01T14:00:00Z"))).toContainEqual({ category: "monthly_review", periodKey: "2026-09" });
    expect(dueRhythms(at("2027-01-02T01:00:00Z"))).toContainEqual({ category: "monthly_review", periodKey: "2026-12" });
    expect(dueRhythms(at("2026-10-04T14:00:00Z")).some((entry) => entry.category === "monthly_review")).toBe(false);
  });
});
describe("Monday priorities", () => {
  const votingEndsAt = at("2026-10-15T18:00:00Z");
  const input = {
    proposals: [{ id: "p1", title: "Buy a shared freezer", votingEndsAt }, { id: "p2", title: "Second vote", votingEndsAt }],
    events: [{ title: "Garden workday", startAt: at("2026-10-17T15:00:00Z") }],
    openRequests: 2,
    goals: [{ label: "Food access" }],
  };

  it("takes one from each source first: the closing vote, the next event, then open requests", () => {
    const text = prioritiesText(input)!;
    expect(text.title).toBe("This week's three priorities");
    expect(text.body).toMatch(/^1\. Vote on 'Buy a shared freezer' before voting closes Thursday, Oct 15\./);
    expect(text.body).toContain("2. Show up for 'Garden workday' on Saturday, Oct 17.");
    expect(text.body).toContain("3. Answer a request: 2 posts in the feed are still waiting for a reply.");
    expect(text.body).not.toContain("Second vote");
    expect(checkSageOutput(`${text.title}\n${text.body}`).ok).toBe(true);
  });

  it("falls back to mission goals, and points to a before-decision summary when one exists", () => {
    const text = prioritiesText({ proposals: [{ id: "p1", title: "Freezer", votingEndsAt, hasDecisionSummary: true }], events: [], openRequests: 0, goals: [{ label: "Food access" }] })!;
    expect(text.title).toBe("This week's priorities");
    expect(text.body).toContain("Read the discussion summary in the thread first.");
    expect(text.body).toContain("2. Take one step toward our goal: Food access.");
  });

  it("drops member-written titles that fail the output check, and posts nothing with nothing to say", () => {
    const text = prioritiesText({ ...input, proposals: [{ id: "p1", title: "see https://evil.example.com", votingEndsAt }] })!;
    expect(text.body).not.toContain("evil");
    expect(prioritiesText({ proposals: [], events: [], openRequests: 0, goals: [] })).toBeNull();
  });
});

describe("midweek open requests", () => {
  it("lists titles only, never who asked, and skips unsafe or duplicate titles", () => {
    const text = openWorkText({
      requests: [{ title: "Need a ride to the clinic" }, { title: "Need a ride to the clinic" }, { title: "visit www.spam.io" }],
      stalled: [{ title: "Planning the winter coat drive" }],
    })!;
    expect(text.body).toContain("• 'Need a ride to the clinic'");
    expect(text.body.match(/ride to the clinic/g)).toHaveLength(1);
    expect(text.body).not.toContain("spam");
    expect(text.body).toContain("These conversations are waiting on a next step:\n• 'Planning the winter coat drive'");
    expect(checkSageOutput(`${text.title}\n${text.body}`).ok).toBe(true);
    expect(openWorkText({ requests: [], stalled: [] })).toBeNull();
  });

  it("carries Monday's volunteers, unowned priorities, and unanswered feedback into the General update", () => {
    const text = openWorkText({ requests: [], stalled: [], monday: {
      postId: "monday-1", priorities: ["Call three members.", "Host the workday."],
      commitments: [{ priority: 1, text: "Priority 1: I'll call three members." }],
      unowned: [{ priority: 2, text: "Host the workday." }], feedbackCount: 1, tasksCreated: 1,
    } })!;
    expect(text.body).toContain("Priority 1 has a volunteer");
    expect(text.body).toContain("Priority 2 still needs an owner: Host the workday.");
    expect(text.body).toContain("1 question or concern needs a response.");
  });
});

describe("closing Monday's loop", () => {
  it("recognizes only explicit first-person offers and maps numbered priorities", () => {
    expect(explicitCommitment("Priority 2: I'll host the workday.")).toEqual({ text: "Priority 2: I'll host the workday.", priority: 2 });
    expect(explicitCommitment("We should host a workday.")).toBeNull();
    expect(explicitCommitment("I agree with priority 1.")).toBeNull();
    expect(explicitCommitment("I can see why this matters.")).toBeNull();
  });

  it("turns explicit offers into follow-up tasks and leaves the other priorities unowned", async () => {
    db.commonsAction.findUnique.mockResolvedValueOnce({
      id: "monday-action", sourcePostId: "monday-post",
      payload: { priorities: ["Call three members.", "Host the workday."] },
    });
    db.commonsComment.findMany.mockResolvedValueOnce([
      { id: "c1", authorId: "u1", content: "Priority 2: I can host the workday." },
      { id: "c2", authorId: "u2", content: "Who can bring the supplies?" },
    ]);
    const followUp = await gatherMondayFollowUp("coop-1", "2026-W42", FRIDAY);
    expect(followUp).toMatchObject({ tasksCreated: 1, feedbackCount: 1, unowned: [{ priority: 1, text: "Call three members." }] });
    expect(db.sageTask.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      ownerUserId: "u1", postId: "monday-post", sourceActionId: "monday-action", createdBy: "SYSTEM",
    }), select: { id: true } });
  });

  it("detects an active member discussion for the same ritual category", async () => {
    db.commonsPost.findFirst.mockResolvedValueOnce({ id: "active-post" });
    expect(await hasActiveRhythmDiscussion("coop-1", "weekly_priorities", FRIDAY)).toBe(true);
    expect(db.commonsPost.findFirst.mock.calls[0][0].where).toMatchObject({
      classification: "sage_rhythm_weekly_priorities", comments: { some: { author: { isBot: false } } },
    });
  });
});

describe("Friday appreciation", () => {
  const counts = { ...EMPTY_ACTIVITY, helpConfirmed: 2, eventsHosted: 1, commitmentsKept: 3 };

  it("shows only counts that happened, goal movement, and only the names it was given", () => {
    const text = appreciationText(counts, [{ label: "Food access", proposals: 1 }, { label: "Housing", proposals: 0 }], ["Ana", "Bo"])!;
    expect(text.body).toContain("• 2 times a member confirmed someone's help made a difference");
    expect(text.body).toContain("• 1 event hosted");
    expect(text.body).toContain("• 3 commitments kept");
    expect(text.body).not.toMatch(/requests? got an answer|resources? shared/);
    expect(text.body).toContain("• Food access: 1 proposal moved forward");
    expect(text.body).toContain("• Housing: nothing recorded this week");
    expect(text.body).toContain("Thank you, Ana and Bo, and everyone else who showed up.");
    expect(checkSageOutput(`${text.title}\n${text.body}`).ok).toBe(true);
  });

  it("thanks everyone without names when nobody opted in, and posts nothing in a quiet week", () => {
    expect(appreciationText(counts, [], [])!.body).toContain("Thank you to everyone who showed up.");
    expect(appreciationText(counts, [{ label: "Food access", proposals: 0 }, { label: "Housing", proposals: 0 }], [])!.body)
      .toContain("Toward our goals:\n• No proposals tied to our goals moved forward this week.");
    expect(appreciationText(EMPTY_ACTIVITY, [{ label: "Food access", proposals: 0 }], ["Ana"])).toBeNull();
  });
});

describe("the monthly review", () => {
  it("compares each count with the month before and lists what could stop", () => {
    const text = monthlyText("September", { ...EMPTY_ACTIVITY, eventsHosted: 4, requestsAnswered: 3 }, { ...EMPTY_ACTIVITY, eventsHosted: 2, requestsAnswered: 5 }, [{ text: "2 proposals have waited more than 30 days without reaching a vote. Revive or withdraw them." }])!;
    expect(text.title).toBe("How September went");
    expect(text.body).toContain("What improved:\n• Events hosted: 4 (up from 2)");
    expect(text.body).toContain("What stalled:\n• Requests answered: 3 (down from 5)");
    expect(text.body).toContain("What could stop:\n• 2 proposals have waited");
    expect(checkSageOutput(`${text.title}\n${text.body}`).ok).toBe(true);
    expect(monthlyText("September", EMPTY_ACTIVITY, EMPTY_ACTIVITY, [])).toBeNull();
  });

  it("carries a Monday question with no later reply into the monthly stop list", async () => {
    db.commonsAction.findMany.mockResolvedValueOnce([{
      sourcePostId: "monday-post", payload: { category: "weekly_priorities" },
    }]);
    db.commonsComment.findMany.mockResolvedValueOnce([
      { postId: "monday-post", content: "Who can bring the supplies?", createdAt: at("2026-09-20T12:00:00Z") },
    ]);
    const stops = await gatherStopCandidates("coop-1", at("2026-09-01T00:00:00Z"), at("2026-10-01T00:00:00Z"));
    expect(stops).toContainEqual({ text: "1 question or concern in a Monday priority thread has no later response. Carry them into next month." });
  });
});

describe("verified activity", () => {
  const from = at("2026-10-09T15:00:00Z");

  it("counts only records: confirmed help (crediting the helper), first replies, held events, kept commitments", async () => {
    db.commonsActionAudit.findMany.mockResolvedValue([{ actionId: "intro-1", action: { participants: [{ userId: "helper" }] } }]);
    db.commonsComment.findMany
      .mockResolvedValueOnce([
        { postId: "need-1", authorId: "asker", post: { authorId: "asker" } }, // the author's own reply doesn't count
        { postId: "need-1", authorId: "replier", post: { authorId: "asker" } },
        { postId: "need-2", authorId: "late", post: { authorId: "asker2" } },
      ])
      .mockResolvedValueOnce([{ postId: "need-2", authorId: "early", post: { authorId: "asker2" } }]); // need-2 was answered before the week
    db.event.findMany.mockResolvedValue([
      { hosts: [{ userId: "host" }], rsvps: [{ userId: "guest" }] },
      { hosts: [{ userId: "lonely-host" }], rsvps: [{ userId: "lonely-host" }] }, // nobody else came: not counted
    ]);
    db.sageTask.findMany.mockResolvedValue([{ ownerUserId: "keeper" }]);
    db.proposal.findMany.mockResolvedValue([{ id: "prop-1" }]);
    db.coopConfig.findFirst.mockResolvedValue({ missionGoals: [{ key: "food", label: "Food access", priorityWeight: 0.9 }] });
    db.proposalGoalScore.findMany.mockResolvedValue([{ proposalId: "prop-1", goalId: "food" }]);

    const activity = await gatherActivity("coop-1", from, FRIDAY);
    expect(activity.counts).toEqual({ helpConfirmed: 1, requestsAnswered: 1, resourcesShared: 0, eventsHosted: 1, proposalsAdvanced: 1, commitmentsKept: 1 });
    expect([...activity.contributorIds].sort()).toEqual(["helper", "host", "keeper", "replier"]);
    expect(activity.goals).toEqual([{ label: "Food access", proposals: 1 }]);
    expect(db.sageTask.findMany.mock.calls[0][0].where.outcome.in).toEqual(Object.values(FULFILLED_TASK_OUTCOMES));
    expect(db.commonsActionAudit.findMany.mock.calls[0][0].where.eventType).toBe("HELP_CONFIRMED");
  });

});

describe("publishing", () => {
  const text = { title: "This week's appreciation", body: "• 1 event hosted" };

  it("posts once in General as Sage and notifies active members through the Community category", async () => {
    db.userCoopMembership.findMany.mockResolvedValue([{ userId: "member-1" }]);
    const result = await publishRhythmPost("coop-1", "friday_appreciation", "2026-W42", text);
    expect(result).toMatchObject({ posted: true, postId: "post-1", notified: 1 });
    const action = db.commonsAction.create.mock.calls[0][0].data;
    expect(action).toMatchObject({ type: "COMMUNITY_RHYTHM", sourceType: "community_rhythm", sourceId: "coop-1:friday_appreciation:2026-W42", contentHash: "friday_appreciation" });
    expect(db.commonsPost.create.mock.calls[0][0].data).toMatchObject({ circleId: "general:coop-1", authorId: "sage-bot", classification: "sage_rhythm_friday_appreciation" });
    expect(db.userCoopMembership.findMany.mock.calls[0][0].where).toMatchObject({ coopId: "coop-1", status: "ACTIVE", user: { isBot: false } });
    expect(push.createNotificationAndPush.mock.calls[0][1]).toMatchObject({ userId: "member-1", type: "SAGE_RHYTHM", data: { postId: "post-1", coopId: "coop-1", category: "friday_appreciation" } });
    expect(db.commonsActionAudit.create).toHaveBeenCalledWith({ data: expect.objectContaining({ eventType: "RHYTHM_POSTED" }) });
  });

  it("is idempotent per Commons and period", async () => {
    db.commonsAction.create.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
    expect(await publishRhythmPost("coop-1", "friday_appreciation", "2026-W42", text)).toMatchObject({ posted: false, reason: "Already posted this period" });
    expect(db.commonsPost.create).not.toHaveBeenCalled();
  });

  it("records a skip instead of posting when there's nothing to say or the text fails the output check", async () => {
    expect(await publishRhythmPost("coop-1", "midweek_open_work", "2026-W42", null)).toMatchObject({ posted: false, reason: "Nothing to post for this period" });
    expect(db.commonsAction.create.mock.calls[0][0].data).toMatchObject({ status: "DISMISSED", auditEvents: { create: { eventType: "RHYTHM_SKIPPED" } } });
    expect(await publishRhythmPost("coop-1", "midweek_open_work", "2026-W43", { title: "x", body: "visit https://x.example.com" })).toMatchObject({ posted: false, reason: "The post failed Sage's output check" });
    expect(db.commonsPost.create).not.toHaveBeenCalled();
  });

  it("skips Commons with too few active members, demo Commons, and periods already handled", async () => {
    db.userCoopMembership.count.mockResolvedValue(RHYTHM_MIN_ACTIVE_MEMBERS - 1);
    expect(await runCommunityRhythm("coop-1", FRIDAY)).toEqual({ skipped: "Too few active members", results: [] });
    db.userCoopMembership.count.mockResolvedValue(12);
    db.coopConfig.findFirst.mockResolvedValue({ isDemo: true });
    expect((await runCommunityRhythm("coop-1", FRIDAY)).skipped).toBe("Not an active Commons");
    db.commonsAction.findUnique.mockResolvedValue({ id: "done" });
    expect(await runCommunityRhythm("coop-1", FRIDAY)).toEqual({ results: [] });
    expect(db.commonsAction.create).not.toHaveBeenCalled();
  });

  it("records a skip instead of replacing a same-category General discussion that is still active", async () => {
    db.commonsPost.findFirst.mockResolvedValueOnce({ id: "active-friday-thread" });
    const result = await runCommunityRhythm("coop-1", FRIDAY);
    expect(result.results).toEqual([expect.objectContaining({
      category: "friday_appreciation", posted: false, reason: "The existing General discussion is still active",
    })]);
    expect(db.commonsAction.create.mock.calls[0][0].data).toMatchObject({ status: "DISMISSED" });
    expect(db.commonsPost.create).not.toHaveBeenCalled();
  });

  it("builds and posts the due ritual in a qualifying Commons", async () => {
    db.event.findMany.mockResolvedValue([{ hosts: [{ userId: "host" }], rsvps: [{ userId: "guest" }] }]);
    const result = await runCommunityRhythm("coop-1", FRIDAY);
    expect(result.results).toEqual([expect.objectContaining({ category: "friday_appreciation", posted: true })]);
    expect(db.commonsPost.create.mock.calls[0][0].data.content).toContain("1 event hosted");
  });
});
