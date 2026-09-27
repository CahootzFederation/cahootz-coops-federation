import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/push-notification-service.js", () => ({
  createNotificationAndPush: vi.fn().mockResolvedValue({ id: "notif_1" }),
}));
vi.mock("../lib/email.js", () => ({
  isEmailConfigured: vi.fn().mockReturnValue(true),
  sendOnboardingDripEmail: vi.fn().mockResolvedValue(undefined),
}));

import { sendOnboardingDripEmail } from "../lib/email.js";
import { ACTIVITY_TOUCH_INTERVAL_MS, shouldTouchActivity, touchMemberActivity } from "../lib/member-activity.js";
import { planDripStep, runOnboardingDrip } from "../services/onboarding-drip.js";
import { memberAppLinkUrl } from "../services/onboarding-drip-config.js";
import { createNotificationAndPush } from "../services/push-notification-service.js";

const HOUR = 60 * 60 * 1000;
const JOINED = new Date("2026-09-20T12:00:00Z");
const at = (hours: number) => new Date(JOINED.getTime() + hours * HOUR);

describe("planDripStep", () => {
  const plan = (hours: number, lastActiveHours: number | null, sent: number[] = []) =>
    planDripStep(
      {
        joinedAt: JOINED,
        lastActiveAt: lastActiveHours === null ? null : at(lastActiveHours),
        sentSteps: new Set(sent),
      },
      at(hours),
    );
  const day = (result: ReturnType<typeof plan>) => ("step" in result ? result.step.day : result.skip);

  it("sends nothing before day 1 is due", () => {
    expect(day(plan(23, 0.5))).toBe("NOT_DUE");
  });

  it("sends day 1 when the member hasn't been back since their signup session", () => {
    expect(day(plan(25, 1))).toBe(1);
    expect(day(plan(25, null))).toBe(1);
  });

  it("suppresses day 1 when the member came back after signup", () => {
    expect(day(plan(25, 3))).toBe("ACTIVE");
  });

  it("never re-sends a step that was already sent", () => {
    expect(day(plan(25, 1, [1]))).toBe("ALREADY_SENT");
  });

  it("drops a step whose window has passed instead of sending it late", () => {
    expect(day(plan(49, 1))).toBe("NOT_DUE");
    expect(day(plan(193, null))).toBe("NOT_DUE");
  });

  it("uses the previous step's due time as day 3's activity threshold", () => {
    expect(day(plan(73, 10))).toBe(3); // active on day 0, not since day 1 was due
    expect(day(plan(73, 30))).toBe("ACTIVE"); // came back after day 1
  });

  it("sends day 7 after a quiet week, even if day 1 and 3 were skipped", () => {
    expect(day(plan(170, 50))).toBe(7);
    expect(day(plan(170, 80))).toBe("ACTIVE");
  });
});

describe("member activity throttle", () => {
  const now = new Date("2026-09-26T12:00:00Z");

  it("writes at most once per 15 minutes", () => {
    expect(shouldTouchActivity(null, now)).toBe(true);
    expect(shouldTouchActivity(new Date(now.getTime() - 5 * 60 * 1000), now)).toBe(false);
    expect(shouldTouchActivity(new Date(now.getTime() - ACTIVITY_TOUCH_INTERVAL_MS), now)).toBe(true);
  });

  it("skips the write when fresh and never throws when the write fails", async () => {
    const db = { user: { updateMany: vi.fn().mockRejectedValue(new Error("db down")) } };
    await touchMemberActivity(db, { id: "u1", lastActiveAt: new Date(now.getTime() - 60_000) }, now);
    expect(db.user.updateMany).not.toHaveBeenCalled();
    await expect(touchMemberActivity(db, { id: "u1", lastActiveAt: null }, now)).resolves.toBeUndefined();
    expect(db.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "u1" }), data: { lastActiveAt: now } }),
    );
  });
});

interface FakeState {
  memberships: Array<{
    id: string;
    userId: string;
    coopId: string;
    joinedAt: Date | null;
    createdAt: Date;
    user: { id: string; name: string | null; email: string; lastActiveAt: Date | null };
  }>;
  sends: Array<{ id: string; userId: string; coopId: string; step: number; status: string; channel?: string }>;
  prefs: Record<string, Record<string, boolean>>;
  deviceCount: number;
  circleIds: string[];
  posts: Array<Record<string, unknown>>;
  groups: Record<string, { name: string }>;
  events: Array<Record<string, unknown>>;
  popular: Record<string, unknown> | null;
  lounge: Record<string, unknown> | null;
  activeCircle: { id: string; name: string } | null;
}

function member(overrides: Partial<FakeState["memberships"][number]["user"]> = {}, coopId = "riverside") {
  const user = { id: "u1", name: "Ada Lovelace", email: "ada@example.com", lastActiveAt: at(1), ...overrides };
  return { id: `m_${user.id}_${coopId}`, userId: user.id, coopId, joinedAt: JOINED, createdAt: JOINED, user };
}

function post(id: string, authorName: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    title: `Post ${id} about the community garden`,
    circleId: "c1",
    createdAt: at(20),
    author: { name: authorName, handle: authorName.toLowerCase(), isBot: false },
    _count: { comments: 0, supports: 0 },
    ...extra,
  };
}

function makeDb(state: FakeState) {
  let claims = 0;
  return {
    userCoopMembership: {
      findMany: vi.fn(async ({ cursor }: { cursor?: unknown }) => (cursor ? [] : state.memberships)),
    },
    onboardingDripSend: {
      findMany: vi.fn(async () => state.sends),
      create: vi.fn(async ({ data }: { data: { userId: string; coopId: string; step: number } }) => {
        if (state.sends.some((s) => s.userId === data.userId && s.coopId === data.coopId && s.step === data.step)) {
          throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        }
        const row = { id: `claim_${++claims}`, status: "SENDING", ...data };
        state.sends.push(row);
        return { id: row.id };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = state.sends.find((s) => s.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
    },
    coopConfig: { findFirst: vi.fn(async () => ({ name: "Riverside Commons" })) },
    notificationPreference: {
      findUnique: vi.fn(async ({ where }: { where: { userId: string } }) =>
        state.prefs[where.userId]
          ? {
              pushEnabled: true,
              community: true,
              governance: true,
              payments: true,
              orders: true,
              onboarding: true,
              other: true,
              ...state.prefs[where.userId],
            }
          : null,
      ),
    },
    pushDevice: { count: vi.fn(async () => state.deviceCount) },
    groupMember: {
      findMany: vi.fn(async () => state.circleIds.map((groupId) => ({ groupId }))),
      findFirst: vi.fn(async () => state.lounge),
    },
    commonsPost: {
      count: vi.fn(async () => state.posts.length),
      findMany: vi.fn(async () => state.posts),
    },
    group: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => state.groups[where.id] ?? null),
      findMany: vi.fn(async () => (state.popular ? [state.popular] : [])),
      findFirst: vi.fn(async () => state.activeCircle),
    },
    event: { findMany: vi.fn(async () => state.events) },
  };
}

function baseState(overrides: Partial<FakeState> = {}): FakeState {
  return {
    memberships: [member()],
    sends: [],
    prefs: {},
    deviceCount: 1,
    circleIds: ["c1"],
    posts: [],
    groups: { c1: { name: "Welcome Lounge 4" } },
    events: [],
    popular: null,
    lounge: null,
    activeCircle: null,
    ...overrides,
  };
}

const run = (state: FakeState, hours: number) => runOnboardingDrip(makeDb(state) as any, { now: at(hours) });
const pushed = () => vi.mocked(createNotificationAndPush).mock.calls.map((call) => call[1]);

describe("runOnboardingDrip", () => {
  beforeEach(() => {
    delete process.env.MEMBER_APP_LINK_URL;
    vi.mocked(createNotificationAndPush).mockClear();
    vi.mocked(sendOnboardingDripEmail).mockClear();
  });

  describe("day 1", () => {
    it("points at a real post in the member's circles and records the send", async () => {
      const state = baseState({
        posts: [
          post("p_new", "Grace"),
          post("p_busy", "Linus", { _count: { comments: 4, supports: 2 }, createdAt: at(10) }),
          post("p_sage", "Sage", { author: { name: "Sage", handle: "sage", isBot: true }, _count: { comments: 9, supports: 9 } }),
        ],
      });
      const summary = await run(state, 25);

      expect(summary.sent).toBe(1);
      const [message] = pushed();
      expect(message).toMatchObject({
        userId: "u1",
        coopId: "riverside",
        type: "ONBOARDING_DRIP",
        title: "Today in Welcome Lounge 4",
        data: { postId: "p_busy", coopId: "riverside", circleId: "c1", dripStep: "1" },
      });
      expect(message!.body).toContain("3 new posts");
      expect(message!.body).toContain("Linus");
      expect(state.sends).toEqual([
        expect.objectContaining({ userId: "u1", step: 1, status: "SENT", channel: "PUSH", notificationId: "notif_1", targetId: "p_busy" }),
      ]);
    });

    it("skips when nothing new happened, without using up the step", async () => {
      const state = baseState({ posts: [] });
      const summary = await run(state, 25);
      expect(summary.skipped.NOTHING_TO_SHOW).toBe(1);
      expect(pushed()).toHaveLength(0);
      expect(state.sends).toHaveLength(0);
    });

    it("skips a member who isn't in any circle", async () => {
      const state = baseState({ circleIds: [], posts: [post("p1", "Grace")] });
      expect((await run(state, 25)).skipped.NOTHING_TO_SHOW).toBe(1);
    });
  });

  describe("idempotency and suppression", () => {
    it("never double-sends across sweeps", async () => {
      const state = baseState({ posts: [post("p1", "Grace")] });
      await run(state, 25);
      const second = await run(state, 26);
      expect(second.skipped.ALREADY_SENT).toBe(1);
      expect(pushed()).toHaveLength(1);
    });

    it("stands down when an overlapping sweep claimed the step first", async () => {
      const state = baseState({ posts: [post("p1", "Grace")] });
      const db = makeDb(state);
      // The other sweep's claim lands after this sweep loaded the send history.
      db.onboardingDripSend.findMany.mockResolvedValueOnce([]);
      state.sends.push({ id: "other", userId: "u1", coopId: "riverside", step: 1, status: "SENDING" });
      const summary = await runOnboardingDrip(db as any, { now: at(25) });
      expect(summary.skipped.ALREADY_SENT).toBe(1);
      expect(pushed()).toHaveLength(0);
    });

    it("sends nothing to a member who has been active since signup", async () => {
      const state = baseState({ memberships: [member({ lastActiveAt: at(20) })], posts: [post("p1", "Grace")] });
      const summary = await run(state, 25);
      expect(summary.skipped.ACTIVE).toBe(1);
      expect(pushed()).toHaveLength(0);
    });

    it("respects the Getting started opt-out entirely (no inbox, push or email)", async () => {
      const state = baseState({ prefs: { u1: { onboarding: false } }, posts: [post("p1", "Grace")] });
      const summary = await run(state, 25);
      expect(summary.skipped.OPTED_OUT).toBe(1);
      expect(pushed()).toHaveLength(0);
      expect(sendOnboardingDripEmail).not.toHaveBeenCalled();
      expect(state.sends).toHaveLength(0);
    });

    it("messages a member at most once per sweep across commons", async () => {
      const state = baseState({
        memberships: [member({}, "riverside"), member({}, "hillside")],
        posts: [post("p1", "Grace")],
      });
      const summary = await run(state, 25);
      expect(summary.sent).toBe(1);
      expect(summary.skipped.ONE_PER_RUN).toBe(1);
    });
  });

  describe("email fallback", () => {
    it("emails when the member has no push device", async () => {
      const state = baseState({ deviceCount: 0, posts: [post("p1", "Grace")] });
      await run(state, 25);
      expect(pushed()).toHaveLength(1); // the inbox alert is still written
      expect(sendOnboardingDripEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "ada@example.com",
          commonsName: "Riverside Commons",
          subject: "1 new post in Welcome Lounge 4",
          // The app is iOS-only: the email names the post and where to find
          // it, and its button opens the app link rather than a post URL.
          body:
            "1 new post since yesterday. Start with Grace's “Post p1 about the community garden”. " +
            "Open the Cahootz app to find it in Welcome Lounge 4.",
          ctaLabel: "Open the app",
          ctaUrl: "https://cahootzcoops.com",
        }),
      );
      expect(state.sends[0]).toMatchObject({ status: "SENT", channel: "EMAIL" });
    });

    it("emails when push is turned off", async () => {
      const state = baseState({ prefs: { u1: { pushEnabled: false } }, posts: [post("p1", "Grace")] });
      await run(state, 25);
      expect(sendOnboardingDripEmail).toHaveBeenCalledTimes(1);
    });

    it("keeps to the inbox for non-routable addresses", async () => {
      const state = baseState({
        deviceCount: 0,
        memberships: [member({ email: "releaseclick1@test.cahootz.local" })],
        posts: [post("p1", "Grace")],
      });
      await run(state, 25);
      expect(sendOnboardingDripEmail).not.toHaveBeenCalled();
      expect(state.sends[0]).toMatchObject({ status: "SENT", channel: "INBOX" });
    });

    it("doesn't email when push will reach the member", async () => {
      await run(baseState({ posts: [post("p1", "Grace")] }), 25);
      expect(sendOnboardingDripEmail).not.toHaveBeenCalled();
    });
  });

  describe("day 3", () => {
    const quietMember = () => [member({ lastActiveAt: at(5) })];

    it("prefers an upcoming event", async () => {
      const state = baseState({
        memberships: quietMember(),
        events: [
          {
            id: "e1",
            postId: "ep1",
            circleId: null,
            startAt: at(74),
            post: { title: "Saturday seed swap" },
            _count: { rsvps: 3 },
          },
        ],
        popular: { id: "c9", name: "Gardeners", purpose: null, _count: { members: 12 } },
      });
      await run(state, 73);
      expect(pushed()[0]).toMatchObject({
        title: "Coming up in Riverside Commons",
        data: { eventId: "e1", postId: "ep1", coopId: "riverside", dripStep: "3" },
      });
      expect(pushed()[0]!.body).toContain("3 people are going");
    });

    it("names the event, its time and where it is in the email", async () => {
      const state = baseState({
        memberships: quietMember(),
        deviceCount: 0,
        events: [
          { id: "e1", postId: "ep1", circleId: null, startAt: at(74), post: { title: "Saturday seed swap" }, _count: { rsvps: 0 } },
        ],
      });
      await run(state, 73);
      const [email] = vi.mocked(sendOnboardingDripEmail).mock.calls[0]!;
      expect(email.body).toBe(
        "“Saturday seed swap” is today at 2:00 PM UTC in Riverside Commons. Open the Cahootz app to find it. Then RSVP.",
      );
      expect(email.body).not.toMatch(/https?:/);
    });

    it("falls back to a popular circle the member hasn't joined", async () => {
      const state = baseState({
        memberships: quietMember(),
        popular: { id: "c9", name: "Gardeners", purpose: "Grow food together", _count: { members: 12 } },
      });
      await run(state, 73);
      expect(pushed()[0]).toMatchObject({
        title: "A circle you might like: Gardeners",
        data: { circleId: "c9", coopId: "riverside", dripStep: "3" },
      });
    });

    it("skips when there's no event and no circle worth suggesting", async () => {
      const state = baseState({
        memberships: quietMember(),
        popular: { id: "c9", name: "Tiny", purpose: null, _count: { members: 1 } },
      });
      expect((await run(state, 73)).skipped.NOTHING_TO_SHOW).toBe(1);
      expect(pushed()).toHaveLength(0);
    });
  });

  describe("day 7", () => {
    const quietMember = () => [member({ lastActiveAt: at(40) })];

    const loungeWithGuide = () => ({
      group: { id: "wl4", name: "Welcome Lounge 4", members: [{ user: { name: "Maya Guide", handle: "maya" } }] },
    });

    it("is signed by the commons and names the guide as someone to reach out to", async () => {
      const state = baseState({ memberships: quietMember(), lounge: loungeWithGuide() });
      await run(state, 170);
      expect(pushed()[0]).toMatchObject({
        title: "A note from Riverside Commons",
        body:
          "Hi Ada, it's been a week since you joined Riverside Commons. Your welcome lounge guide, " +
          "Maya Guide, is around if you have questions. Stop by Welcome Lounge 4 and say hi.",
        data: { circleId: "wl4", coopId: "riverside", dripStep: "7" },
      });
    });

    it("sends the same commons-signed note by email", async () => {
      const state = baseState({ memberships: quietMember(), lounge: loungeWithGuide(), deviceCount: 0 });
      await run(state, 170);
      expect(sendOnboardingDripEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: "A note from Riverside Commons",
          heading: "A note from Riverside Commons",
          body: `${pushed()[0]!.body} Open the Cahootz app to find Welcome Lounge 4.`,
          ctaLabel: "Open the app",
        }),
      );
    });

    it("never reads as written by the guide", async () => {
      const state = baseState({ memberships: quietMember(), lounge: loungeWithGuide(), deviceCount: 0 });
      await run(state, 170);
      const [email] = vi.mocked(sendOnboardingDripEmail).mock.calls[0]!;
      for (const text of [pushed()[0]!.title, email.subject, email.heading]) {
        expect(text).not.toContain("Maya");
      }
    });

    it("leaves the guide out when the lounge has none", async () => {
      const state = baseState({
        memberships: quietMember(),
        lounge: { group: { id: "wl4", name: "Welcome Lounge 4", members: [] } },
      });
      await run(state, 170);
      expect(pushed()[0]).toMatchObject({ title: "A note from Riverside Commons", data: { circleId: "wl4" } });
      expect(pushed()[0]!.body).not.toMatch(/guide/i);
      expect(pushed()[0]!.body).toContain("Welcome Lounge 4 is a good place to say hi");
    });

    it("points at the member's most active circle when they have no lounge", async () => {
      const state = baseState({ memberships: quietMember(), activeCircle: { id: "c3", name: "Book Club" } });
      await run(state, 170);
      expect(pushed()[0]).toMatchObject({ title: "A note from Riverside Commons", data: { circleId: "c3" } });
    });

    it("skips when there's nowhere concrete to send them", async () => {
      expect((await run(baseState({ memberships: quietMember() }), 170)).skipped.NOTHING_TO_SHOW).toBe(1);
    });
  });

  describe("email link", () => {
    afterEach(() => {
      delete process.env.MEMBER_APP_LINK_URL;
      delete process.env.APP_URL;
    });

    it("defaults to the Cahootz site and ignores APP_URL", () => {
      process.env.APP_URL = "http://localhost:3000";
      expect(memberAppLinkUrl()).toBe("https://cahootzcoops.com");
    });

    it("uses MEMBER_APP_LINK_URL when set (e.g. the App Store listing)", async () => {
      process.env.MEMBER_APP_LINK_URL = "https://apps.apple.com/app/id123";
      await run(baseState({ deviceCount: 0, posts: [post("p1", "Grace")] }), 25);
      expect(sendOnboardingDripEmail).toHaveBeenCalledWith(
        expect.objectContaining({ ctaUrl: "https://apps.apple.com/app/id123", ctaLabel: "Open the app" }),
      );
    });
  });
});
