import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  commonsComment: { findFirst: vi.fn() },
  commonsAction: { findFirst: vi.fn() },
  groupMember: { findFirst: vi.fn(), findMany: vi.fn() },
  eventRSVP: { findFirst: vi.fn() },
  commonsPost: { findFirst: vi.fn(), findMany: vi.fn() },
  coopConfig: { findFirst: vi.fn() },
  proposal: { count: vi.fn() },
  event: { findFirst: vi.fn() },
  group: { findMany: vi.fn() },
  commonsResource: { findMany: vi.fn() },
  sageTask: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  sageTaskEvent: { create: vi.fn(), findMany: vi.fn() },
  auditLog: { create: vi.fn() },
  notificationPreference: { findUnique: vi.fn() },
  groupComment: { findUnique: vi.fn(), findFirst: vi.fn() },
  userCoopMembership: { findMany: vi.fn(), findUnique: vi.fn() },
  onboardingDripSend: { findMany: vi.fn(), create: vi.fn() },
  pushDevice: { count: vi.fn() },
}));
const proactive = vi.hoisted(() => ({
  sendProactiveSageMessage: vi.fn(),
  proactiveCountThisWeek: vi.fn(),
  sageConversation: vi.fn(),
  PROACTIVE_WEEKLY_LIMIT: 7,
  LIMITED_RETRIES: 3,
}));
const specialists = vi.hoisted(() => ({ findMembersForNeed: vi.fn() }));
const memberActions = vi.hoisted(() => ({ proposeIntroduction: vi.fn() }));
const email = vi.hoisted(() => ({ isEmailConfigured: vi.fn(), sendOnboardingDripEmail: vi.fn() }));

vi.mock("@repo/db", () => ({ db }));
vi.mock("../services/sage-proactive.js", () => proactive);
vi.mock("../services/sage-member-actions.js", () => memberActions);
vi.mock("../lib/email.js", () => email);
vi.mock("../agents/tools/specialist-tools.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../agents/tools/specialist-tools.js")>()),
  findMembersForNeed: specialists.findMembersForNeed,
}));
vi.mock("../services/sage-decision-trail.js", () => {
  class DecisionTrail {
    step() { return this; }
    policy(_label: string, passed: boolean) { return passed; }
    taken() { return this; }
    result() { return this; }
    setOutcome() { return this; }
    async save() { return "trail"; }
  }
  return { DecisionTrail };
});

import {
  activationStats, blockerAskText, coinName, connectContent, contributeContent, findActivationSignal, planActivationStep,
  runActivationSweep, topGoals, wakeActivationTask, welcomeContent,
} from "../services/sage-activation.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const JOINED = new Date("2026-10-01T12:00:00Z");
const at = (hours: number) => new Date(JOINED.getTime() + hours * HOUR);

const newcomer = { id: "u1", name: "Ada Lovelace", email: "ada@example.com", skills: ["Carpentry"], interests: ["gardening"], resourcesOffered: [] as string[] };

const config = {
  name: "Harbor Commons",
  displayMission: "We keep money circulating among neighbors so every family can stay in the harbor.",
  tagline: null, description: null, charterText: "Article 1. Purpose.",
  missionGoals: [
    { key: "housing", label: "Keep families housed", priorityWeight: 0.2 },
    { key: "food", label: "Feed each other", priorityWeight: 0.5 },
    { key: "jobs", label: "Hire from within", priorityWeight: 0.3 },
    { key: "fun", label: "Throw a block party", priorityWeight: 0.1 },
  ],
  scTokenName: "HarborCoin",
};

function noSignals() {
  db.commonsComment.findFirst.mockResolvedValue(null);
  db.commonsAction.findFirst.mockResolvedValue(null);
  db.groupMember.findFirst.mockResolvedValue(null);
  db.eventRSVP.findFirst.mockResolvedValue(null);
  db.commonsPost.findFirst.mockResolvedValue(null);
}

beforeEach(() => {
  vi.clearAllMocks();
  noSignals();
  db.coopConfig.findFirst.mockResolvedValue(config);
  db.proposal.count.mockResolvedValue(0);
  db.event.findFirst.mockResolvedValue(null);
  db.group.findMany.mockResolvedValue([]);
  db.groupMember.findMany.mockResolvedValue([]);
  db.commonsResource.findMany.mockResolvedValue([]);
  db.commonsPost.findMany.mockResolvedValue([]);
  db.sageTask.findFirst.mockResolvedValue(null);
  db.sageTask.findMany.mockResolvedValue([]);
  db.sageTask.create.mockResolvedValue({ id: "task1" });
  db.sageTask.update.mockResolvedValue({});
  db.sageTask.updateMany.mockResolvedValue({ count: 1 });
  db.sageTask.findUnique.mockResolvedValue({ id: "task1", coopId: "harbor", ownerUserId: "u1" });
  db.sageTaskEvent.findMany.mockResolvedValue([]);
  db.sageTaskEvent.create.mockResolvedValue({});
  db.auditLog.create.mockResolvedValue({});
  db.notificationPreference.findUnique.mockResolvedValue(null);
  db.groupComment.findUnique.mockResolvedValue(null);
  db.groupComment.findFirst.mockResolvedValue(null);
  db.onboardingDripSend.findMany.mockResolvedValue([]);
  db.onboardingDripSend.create.mockResolvedValue({});
  db.pushDevice.count.mockResolvedValue(1);
  specialists.findMembersForNeed.mockResolvedValue([]);
  proactive.sendProactiveSageMessage.mockResolvedValue({ status: "SENT", groupId: "dm" });
  proactive.proactiveCountThisWeek.mockResolvedValue(0);
  proactive.sageConversation.mockResolvedValue({ group: { id: "dm" } });
  email.isEmailConfigured.mockReturnValue(true);
  email.sendOnboardingDripEmail.mockResolvedValue(undefined);
});

describe("planActivationStep", () => {
  const plan = (hours: number, sent: number[] = []) => {
    const result = planActivationStep({ joinedAt: JOINED, sentSteps: new Set(sent) }, at(hours));
    return "step" in result ? result.step.key : result.skip;
  };

  it("welcomes about an hour after joining, then connects on day 3 and suggests a contribution on day 7", () => {
    expect(plan(0.5)).toBe("NOT_DUE");
    expect(plan(1)).toBe("welcome");
    expect(plan(73)).toBe("connect");
    expect(plan(170)).toBe("contribute");
  });

  it("never re-sends a step and drops one whose window passed", () => {
    expect(plan(2, [1])).toBe("ALREADY_SENT");
    expect(plan(14 * 24 + 1)).toBe("NOT_DUE");
  });
});

describe("verified outcomes", () => {
  it("returns the earliest connection or contribution on record", async () => {
    db.eventRSVP.findFirst.mockResolvedValue({ createdAt: at(80) });
    db.groupMember.findFirst.mockResolvedValue({ joinedAt: at(30) });
    const signal = await findActivationSignal("harbor", "u1", JOINED);
    expect(signal).toMatchObject({ kind: "CIRCLE_JOINED", detail: "Joined a circle" });
  });

  it("counts only real activity in this Commons since joining: no opening the app, no Sage's posts, no own needs", async () => {
    expect(await findActivationSignal("harbor", "u1", JOINED)).toBeNull();
    const reply = db.commonsComment.findFirst.mock.calls[0]![0].where;
    expect(reply).toMatchObject({ authorId: "u1", createdAt: { gte: JOINED }, post: { coopId: "harbor", authorId: { not: "u1" }, author: { isBot: false } } });
    expect(db.commonsAction.findFirst.mock.calls[0]![0].where).toMatchObject({ coopId: "harbor", type: "CONNECT_MEMBERS", status: "APPROVED" });
    expect(db.groupMember.findFirst.mock.calls[0]![0].where).toMatchObject({ group: { coopId: "harbor", kind: "STANDARD" } });
    expect(db.eventRSVP.findFirst.mock.calls[0]![0].where).toMatchObject({ status: { in: ["GOING", "MAYBE"] }, event: { coopId: "harbor" } });
  });
});

describe("the Commons' own language", () => {
  it("never shows the schema's placeholder coin name or an unsafe one", () => {
    expect(coinName("HarborCoin")).toBe("HarborCoin");
    expect(coinName("FakeCoin")).toBeNull();
    expect(coinName(null)).toBeNull();
    expect(coinName("visit harborcoin.com")).toBeNull();
  });

  it("orders goals by priority and keeps three", () => {
    expect(topGoals(config.missionGoals)).toEqual(["Feed each other", "Hire from within", "Keep families housed"]);
    expect(topGoals("not a list")).toEqual([]);
  });

  it("welcomes with the mission wording, the coin, goals and what's active, with no model call", async () => {
    db.proposal.count.mockResolvedValue(2);
    db.event.findFirst.mockResolvedValue({ id: "e1", startAt: new Date("2026-10-04T18:00:00Z"), post: { title: "Seed swap" }, _count: { rsvps: 3 } });
    db.group.findMany.mockResolvedValue([{ name: "Gardeners" }, { name: "Rides" }]);
    const { content } = await welcomeContent(newcomer, "harbor", at(1));
    expect(content).toContain("Welcome to Harbor Commons!");
    expect(content).toContain("not a person");
    expect(content).toContain("“We keep money circulating among neighbors so every family can stay in the harbor.”");
    expect(content).toContain("through HarborCoin, our own coin");
    expect(content).toContain("Feed each other; Hire from within; Keep families housed");
    expect(content).toContain("2 proposals open for a vote");
    expect(content).toContain("“Seed swap” on Sun, Oct 4");
    expect(content).toContain("active circles: Gardeners, Rides");
    expect(content).toContain("Getting started tips");
  });

  it("leaves out a coin the Commons never named and any part that fails the output check", async () => {
    db.coopConfig.findFirst.mockResolvedValue({ ...config, scTokenName: "FakeCoin", displayMission: "Read more at harbor.org" , charterText: "" });
    const { content } = await welcomeContent(newcomer, "harbor", at(1));
    expect(content).not.toMatch(/coin/i);
    expect(content).not.toContain("harbor.org");
    expect(content).toContain("Welcome to Harbor Commons!");
  });
});

describe("connect step", () => {
  it("prefers a consent-first introduction to someone who shares their interests", async () => {
    specialists.findMembersForNeed.mockResolvedValue([{ userId: "u2", name: "Grace", matched: ["Gardening"] }]);
    memberActions.proposeIntroduction.mockResolvedValue({ ok: true, actionId: "intro1", ask: "Someone in Harbor Commons lists Gardening on their profile. Want me to introduce you? Reply yes or no." });
    const step = await connectContent(newcomer, "harbor", at(73));
    expect(step?.target.type).toBe("INTRODUCTION");
    const content = await step!.prepare!();
    expect(content).toMatch(/^Here's someone to meet in Harbor Commons\. Someone in Harbor Commons lists Gardening/);
    expect(memberActions.proposeIntroduction).toHaveBeenCalledWith(expect.objectContaining({ memberId: "u1", helperUserId: "u2", coopId: "harbor", conversationGroupId: "dm" }));
    expect(step!.target.id).toBe("intro1");
  });

  it("falls back to a circle that fits their profile, then an event, then a popular circle", async () => {
    db.group.findMany.mockResolvedValue([
      { id: "c1", name: "Rides", purpose: null, _count: { members: 9 } },
      { id: "c2", name: "Community gardening", purpose: "Shared plots", _count: { members: 4 } },
    ]);
    let step = await connectContent(newcomer, "harbor", at(73));
    expect(step).toMatchObject({ target: { type: "CIRCLE", id: "c2" } });
    expect(step!.content).toContain("fits your interest in gardening");

    db.group.findMany.mockResolvedValue([{ id: "c1", name: "Rides", purpose: null, _count: { members: 9 } }]);
    db.event.findFirst.mockResolvedValue({ id: "e1", startAt: new Date("2026-10-05T18:00:00Z"), post: { title: "Seed swap" }, _count: { rsvps: 0 } });
    step = await connectContent(newcomer, "harbor", at(73));
    expect(step).toMatchObject({ target: { type: "EVENT", id: "e1" } });
    expect(step!.content).toContain("RSVP");

    db.event.findFirst.mockResolvedValue(null);
    step = await connectContent(newcomer, "harbor", at(73));
    expect(step).toMatchObject({ target: { type: "CIRCLE", id: "c1" } });
  });

  it("has nothing to say when nothing real fits", async () => {
    expect(await connectContent({ ...newcomer, skills: [], interests: [] }, "harbor", at(73))).toBeNull();
  });
});

describe("contribute step", () => {
  const need = { id: "p1", title: "Need help fixing a fence gate", content: "carpentry help please", authorId: "u3" };

  it("suggests an unanswered need that fits their skills", async () => {
    db.commonsPost.findMany.mockResolvedValue([need]);
    const step = await contributeContent(newcomer, "harbor", at(170));
    expect(step.target).toEqual({ type: "POST", id: "p1" });
    expect(step.content).toContain("“Need help fixing a fence gate”");
    expect(step.content).toContain("Your profile mentions Carpentry");
    const where = db.commonsPost.findMany.mock.calls[0]![0].where;
    expect(where).toMatchObject({ coopId: "harbor", authorId: { not: "u1" }, author: { isBot: false, deletedAt: null } });
  });

  it("skips a need someone already answered and invites an offer instead", async () => {
    db.commonsPost.findMany.mockResolvedValue([need]);
    db.commonsComment.findFirst.mockResolvedValue({ id: "c" });
    const step = await contributeContent(newcomer, "harbor", at(170));
    expect(step.target.type).toBe("NONE");
    expect(step.content).toContain("share one thing you could offer Harbor Commons");
  });
});

describe("runActivationSweep", () => {
  const membership = (overrides: Partial<{ userId: string; coopId: string }> = {}) => ({
    id: `m_${overrides.userId ?? "u1"}_${overrides.coopId ?? "harbor"}`, userId: overrides.userId ?? "u1", coopId: overrides.coopId ?? "harbor",
    joinedAt: JOINED, createdAt: JOINED, user: { ...newcomer, id: overrides.userId ?? "u1" },
  });

  it("sends the welcome as a Sage message under the weekly limit, records the step and starts the journey task", async () => {
    db.userCoopMembership.findMany.mockResolvedValue([membership()]);
    const summary = await runActivationSweep({ now: at(2) });
    expect(summary.sent).toBe(1);
    const sent = proactive.sendProactiveSageMessage.mock.calls[0]![0];
    expect(sent).toMatchObject({ userId: "u1", kind: "activation", key: "harbor:u1:welcome" });
    expect(sent.content).toContain("Welcome to Harbor Commons!");
    expect(db.onboardingDripSend.create.mock.calls[0]![0].data).toMatchObject({ userId: "u1", coopId: "harbor", step: 1, status: "SENT", channel: "SAGE" });
    const task = db.sageTask.create.mock.calls[0]![0].data;
    expect(task).toMatchObject({ coopId: "harbor", ownerUserId: "u1", subjectType: "member_activation", subjectId: "harbor:u1", kind: "ACTIVATION_CHECK" });
    expect(task.dueAt).toEqual(new Date(JOINED.getTime() + 14 * DAY));
  });

  it("starts the journey task only once per membership", async () => {
    db.userCoopMembership.findMany.mockResolvedValue([membership()]);
    db.sageTask.findFirst.mockResolvedValue({ id: "task1" });
    await runActivationSweep({ now: at(2) });
    expect(db.sageTask.create).not.toHaveBeenCalled();
  });

  it("emails the welcome too when push can't reach the member", async () => {
    db.userCoopMembership.findMany.mockResolvedValue([membership()]);
    db.pushDevice.count.mockResolvedValue(0);
    await runActivationSweep({ now: at(2) });
    expect(email.sendOnboardingDripEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "ada@example.com", subject: "Welcome to Harbor Commons" }));
    expect(db.onboardingDripSend.create.mock.calls[0]![0].data.channel).toBe("SAGE+EMAIL");
  });

  it("respects the Getting started opt-out and a dismissed journey", async () => {
    db.userCoopMembership.findMany.mockResolvedValue([membership()]);
    db.notificationPreference.findUnique.mockResolvedValue({ onboarding: false, pushEnabled: true });
    expect((await runActivationSweep({ now: at(2) })).skipped.OPTED_OUT).toBe(1);
    db.notificationPreference.findUnique.mockResolvedValue(null);
    db.sageTask.findMany.mockResolvedValue([{ id: "task1", subjectId: "harbor:u1", status: "DISMISSED" }]);
    expect((await runActivationSweep({ now: at(2) })).skipped.STOPPED).toBe(1);
    expect(proactive.sendProactiveSageMessage).not.toHaveBeenCalled();
  });

  it("stops nudging once the member connected, and records it right away", async () => {
    db.userCoopMembership.findMany.mockResolvedValue([membership()]);
    db.sageTask.findMany.mockResolvedValue([{ id: "task1", subjectId: "harbor:u1", status: "OPEN" }]);
    db.eventRSVP.findFirst.mockResolvedValue({ createdAt: at(50) });
    const summary = await runActivationSweep({ now: at(73) });
    expect(summary.skipped.ACTIVATED).toBe(1);
    expect(proactive.sendProactiveSageMessage).not.toHaveBeenCalled();
    expect(db.sageTask.updateMany.mock.calls[0]![0]).toMatchObject({ where: { id: "task1", status: "OPEN" }, data: { status: "DONE", outcome: "[RSVP] RSVP'd to an event" } });
    expect(db.auditLog.create.mock.calls[0]![0].data).toMatchObject({ action: "SAGE_ACTIVATION_OUTCOME" });
    expect(db.auditLog.create.mock.calls[0]![0].data.metadata).toMatchObject({ outcome: "ACTIVATED", signal: "RSVP", daysToActivate: 2.1 });
  });

  it("waits, without creating anything, while the member is at the weekly limit", async () => {
    db.userCoopMembership.findMany.mockResolvedValue([membership()]);
    specialists.findMembersForNeed.mockResolvedValue([{ userId: "u2", name: "Grace", matched: ["Gardening"] }]);
    proactive.proactiveCountThisWeek.mockResolvedValue(7);
    const summary = await runActivationSweep({ now: at(73) });
    expect(summary.skipped.LIMITED).toBe(1);
    expect(memberActions.proposeIntroduction).not.toHaveBeenCalled();
    expect(db.onboardingDripSend.create).not.toHaveBeenCalled();
  });

  it("doesn't record a step the limit held back, so a later sweep can send it", async () => {
    db.userCoopMembership.findMany.mockResolvedValue([membership()]);
    proactive.sendProactiveSageMessage.mockResolvedValue({ status: "LIMITED" });
    expect((await runActivationSweep({ now: at(2) })).skipped.LIMITED).toBe(1);
    expect(db.onboardingDripSend.create).not.toHaveBeenCalled();
  });

  it("messages a member at most once per sweep across Commons", async () => {
    db.userCoopMembership.findMany.mockResolvedValue([membership(), membership({ coopId: "cahootz" })]);
    const summary = await runActivationSweep({ now: at(2) });
    expect(summary.sent).toBe(1);
    expect(summary.skipped.ONE_PER_RUN).toBe(1);
  });
});

describe("the journey's day 14 and day 30 checks", () => {
  const task = {
    id: "task1", coopId: "harbor", ownerUserId: "u1", subjectType: "member_activation", subjectId: "harbor:u1", kind: "ACTIVATION_CHECK",
    title: "Getting started in Harbor Commons", reason: "r", expected: "e", attempts: 0,
  } as never;

  beforeEach(() => {
    db.userCoopMembership.findUnique.mockResolvedValue({ status: "ACTIVE", joinedAt: JOINED, createdAt: JOINED });
  });

  it("closes as activated from records and logs the outcome", async () => {
    db.commonsComment.findFirst.mockResolvedValue({ createdAt: at(100) });
    expect(await wakeActivationTask(task, at(14 * 24))).toBe("DONE");
    expect(db.sageTask.update.mock.calls[0]![0].data).toMatchObject({ status: "DONE", outcome: "[NEED_REPLY] Replied to another member's need" });
    expect(proactive.sendProactiveSageMessage).not.toHaveBeenCalled();
  });

  it("asks privately what got in the way, once, then waits until day 30", async () => {
    expect(await wakeActivationTask(task, at(14 * 24))).toBe("REMINDED");
    expect(proactive.sendProactiveSageMessage).toHaveBeenCalledWith(expect.objectContaining({
      userId: "u1", kind: "activation-ask", key: "harbor:u1", content: blockerAskText("Harbor Commons"),
    }));
    const update = db.sageTask.update.mock.calls[0]![0].data;
    expect(update.nextWakeAt).toEqual(new Date(JOINED.getTime() + 30 * DAY));
    expect(update.events.create.eventType).toBe("ASKED");
  });

  it("defers a day at the weekly limit, and skips the question when getting started tips are off", async () => {
    proactive.sendProactiveSageMessage.mockResolvedValue({ status: "LIMITED" });
    await wakeActivationTask(task, at(14 * 24));
    expect(db.sageTask.update.mock.calls[0]![0].data.events.create.eventType).toBe("DEFERRED");
    db.sageTask.update.mockClear();
    proactive.sendProactiveSageMessage.mockClear();
    db.notificationPreference.findUnique.mockResolvedValue({ onboarding: false });
    await wakeActivationTask(task, at(14 * 24));
    expect(proactive.sendProactiveSageMessage).not.toHaveBeenCalled();
    expect(db.sageTask.update.mock.calls[0]![0].data.events.create.eventType).toBe("ASK_SKIPPED");
  });

  it("closes as not activated at day 30 and records whether they answered", async () => {
    db.sageTaskEvent.findMany.mockResolvedValue([{ eventType: "ASKED" }]);
    db.groupComment.findUnique.mockResolvedValue({ groupId: "dm", createdAt: at(14 * 24) });
    db.groupComment.findFirst.mockResolvedValue({ id: "reply" });
    expect(await wakeActivationTask(task, at(30 * 24))).toBe("ABANDONED");
    expect(db.sageTask.update.mock.calls[0]![0].data).toMatchObject({ status: "ABANDONED", outcome: expect.stringMatching(/^\[NONE\]/) });
    expect(db.auditLog.create.mock.calls[0]![0].data.metadata).toMatchObject({ outcome: "NOT_ACTIVATED", answeredAsk: true });
    expect(db.groupComment.findUnique.mock.calls[0]![0].where).toEqual({ systemKey: "sage-activation-ask:harbor:u1" });
  });

  it("closes without counting it when the member left", async () => {
    db.userCoopMembership.findUnique.mockResolvedValue({ status: "LEFT", joinedAt: JOINED, createdAt: JOINED });
    expect(await wakeActivationTask(task, at(14 * 24))).toBe("ABANDONED");
    expect(db.sageTask.update.mock.calls[0]![0].data.outcome).toMatch(/^\[LEFT\]/);
  });
});

describe("activationStats", () => {
  it("computes a success rate per Commons from finished journeys only", async () => {
    db.sageTask.findMany.mockResolvedValue([
      { status: "DONE", outcome: "[RSVP] RSVP'd to an event" },
      { status: "DONE", outcome: "[NEED_REPLY] Replied to another member's need" },
      { status: "DONE", outcome: "[RSVP] RSVP'd to an event" },
      { status: "ABANDONED", outcome: "[NONE] No verified connection" },
      { status: "ABANDONED", outcome: "[LEFT] The member is no longer active" },
      { status: "DISMISSED", outcome: "Dismissed by the member" },
      { status: "OPEN", outcome: null },
    ]);
    const stats = await activationStats("harbor");
    expect(stats).toMatchObject({ started: 7, activated: 3, notActivated: 1, inProgress: 1, excluded: 2, successRate: 0.75, bySignal: { RSVP: 2, NEED_REPLY: 1 } });
    expect(db.sageTask.findMany.mock.calls[0]![0].where).toMatchObject({ coopId: "harbor", subjectType: "member_activation" });
  });
});
