import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/push-notification-service.js", () => ({
  createNotificationAndPush: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/admin-config.js", () => ({
  PLATFORM_ADMIN_EMAILS: ["root@example.test"],
  PLATFORM_ADMIN_WALLETS: [],
}));

import { createNotificationAndPush } from "../services/push-notification-service.js";
import {
  INTRO_ADMIN_ESCALATION_AFTER_MS,
  INTRO_GUIDE_ESCALATION_AFTER_MS,
  WELCOME_INTRO_REPLY_NOTIFICATION,
  WELCOME_INTRO_UNANSWERED_ADMIN_NOTIFICATION,
  WELCOME_INTRO_UNANSWERED_NOTIFICATION,
  commentPreview,
  escalateUnansweredIntros,
  getWelcomeIntroStatus,
  recordWelcomeIntroActivity,
  recordWelcomeIntroReaction,
  welcomeLoungesAdminPath,
} from "../services/welcome-intros.js";

const push = vi.mocked(createNotificationAndPush);

type IntroRow = {
  id: string;
  coopId: string;
  groupId: string;
  postId: string;
  commentId: string;
  newcomerId: string;
  createdAt: Date;
  respondedAt: Date | null;
  responderId?: string | null;
  responseCommentId?: string | null;
  guideEscalatedAt: Date | null;
  adminEscalatedAt: Date | null;
};

/**
 * A tiny in-memory stand-in for the Prisma calls the service makes, with
 * `updateMany` honouring its `null` guards - the idempotency the service
 * relies on.
 */
function makeDb(options: {
  roles?: Record<string, string>;
  levels?: Record<string, string>;
  intros?: IntroRow[];
  admins?: string[];
  groupKind?: string;
} = {}) {
  const intros: IntroRow[] = options.intros ?? [];
  const roles = options.roles ?? {};
  const matches = (row: any, where: any): boolean =>
    Object.entries(where).every(([key, condition]: [string, any]) => {
      if (condition === null) return row[key] === null || row[key] === undefined;
      if (condition && typeof condition === "object" && !(condition instanceof Date)) {
        if ("not" in condition) return row[key] !== condition.not;
        if ("lte" in condition) return row[key] <= condition.lte;
      }
      return row[key] === condition;
    });

  const db: any = {
    group: {
      findUnique: vi.fn().mockResolvedValue({
        id: "lounge_1",
        coopId: "coop_1",
        kind: options.groupKind ?? "WELCOME_TABLE",
        name: "Welcome Lounge 1",
      }),
    },
    commonsPost: {
      findFirst: vi.fn().mockResolvedValue({ id: "welcome_post" }),
    },
    groupMember: {
      findUnique: vi.fn().mockImplementation(({ where }: any) => {
        const userId = where.groupId_userId.userId;
        return roles[userId]
          ? { role: roles[userId], notificationLevel: options.levels?.[userId] ?? "MENTIONS" }
          : null;
      }),
      findMany: vi.fn().mockImplementation(({ where }: any) =>
        Object.entries(roles)
          .filter(([userId, role]) => role === where.role && userId !== where.userId?.not)
          .map(([userId]) => ({ userId, notificationLevel: options.levels?.[userId] ?? "MENTIONS" })),
      ),
    },
    // Platform admin accounts resolved from the (mocked) allowlist.
    user: {
      findMany: vi.fn().mockResolvedValue((options.admins ?? []).map((id) => ({ id }))),
    },
    userCoopMembership: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    welcomeIntro: {
      findUnique: vi.fn().mockImplementation(({ where }: any) => {
        if (where.commentId) {
          const row = intros.find((i) => i.commentId === where.commentId);
          return row ? { ...row, group: { name: "Welcome Lounge 1" } } : null;
        }
        const key = where.groupId_newcomerId;
        return intros.find((i) => i.groupId === key.groupId && i.newcomerId === key.newcomerId) ?? null;
      }),
      create: vi.fn().mockImplementation(({ data }: any) => {
        const row: IntroRow = {
          id: `intro_${intros.length + 1}`,
          respondedAt: null,
          guideEscalatedAt: null,
          adminEscalatedAt: null,
          ...data,
        };
        intros.push(row);
        return row;
      }),
      findMany: vi.fn().mockImplementation(({ where }: any) =>
        intros
          .filter((row) => matches(row, where))
          .map((row) => ({
            ...row,
            group: { name: "Welcome Lounge 1" },
            newcomer: { name: "Newcomer Nia", email: "nia@example.test" },
          })),
      ),
      updateMany: vi.fn().mockImplementation(({ where, data }: any) => {
        const hits = intros.filter((row) => matches(row, where));
        for (const row of hits) Object.assign(row, data);
        return { count: hits.length };
      }),
    },
  };
  return { db, intros };
}

const post = { id: "welcome_post", coopId: "coop_1", circleId: "lounge_1" };
const newcomer = { id: "newcomer_1", name: "Newcomer Nia", email: "nia@example.test" };
const member = { id: "member_1", name: "Member Max", email: "max@example.test" };

function comment(id: string, content: string, createdAt = new Date("2026-09-26T10:00:00Z")) {
  return { id, content, createdAt };
}

beforeEach(() => {
  push.mockClear();
});

describe("getWelcomeIntroStatus", () => {
  it("prompts a seated newcomer who hasn't introduced themselves", async () => {
    const { db } = makeDb({ roles: { newcomer_1: "NEWCOMER" } });
    const status = await getWelcomeIntroStatus(db, "lounge_1", "newcomer_1");
    expect(status).toMatchObject({ eligible: true, welcomePostId: "welcome_post", intro: null });
  });

  it("stops prompting once an intro exists, and never prompts outside a lounge", async () => {
    const { db } = makeDb({
      roles: { newcomer_1: "NEWCOMER" },
      intros: [
        {
          id: "intro_1", coopId: "coop_1", groupId: "lounge_1", postId: "welcome_post",
          commentId: "c_intro", newcomerId: "newcomer_1", createdAt: new Date(),
          respondedAt: null, guideEscalatedAt: null, adminEscalatedAt: null,
        },
      ],
    });
    expect(await getWelcomeIntroStatus(db, "lounge_1", "newcomer_1")).toMatchObject({
      eligible: false,
      intro: { commentId: "c_intro", respondedAt: null },
    });

    const standard = makeDb({ roles: { newcomer_1: "NEWCOMER" }, groupKind: "STANDARD" });
    expect(await getWelcomeIntroStatus(standard.db, "lounge_1", "newcomer_1")).toMatchObject({
      eligible: false,
      welcomePostId: null,
    });
  });
});

describe("recordWelcomeIntroActivity", () => {
  it("records a newcomer's first comment on the welcome post as their intro", async () => {
    const { db, intros } = makeDb({ roles: { newcomer_1: "NEWCOMER" } });
    const result = await recordWelcomeIntroActivity(db, {
      post,
      comment: comment("c_intro", "Hi! I'm here to find a book club."),
      author: newcomer,
      mentionedUserIds: [],
    });
    expect(result.introRecorded).toBe(true);
    expect(intros).toHaveLength(1);
    expect(intros[0]).toMatchObject({ commentId: "c_intro", newcomerId: "newcomer_1", postId: "welcome_post" });
    expect(push).not.toHaveBeenCalled();
  });

  it("ignores comments on other posts in the lounge and in non-lounge circles", async () => {
    const { db, intros } = makeDb({ roles: { newcomer_1: "NEWCOMER" } });
    await recordWelcomeIntroActivity(db, {
      post: { ...post, id: "other_post" },
      comment: comment("c1", "hello"),
      author: newcomer,
      mentionedUserIds: [],
    });
    const standard = makeDb({ roles: { newcomer_1: "NEWCOMER" }, groupKind: "STANDARD" });
    await recordWelcomeIntroActivity(standard.db, {
      post,
      comment: comment("c2", "hello"),
      author: newcomer,
      mentionedUserIds: [],
    });
    expect(intros).toHaveLength(0);
    expect(standard.intros).toHaveLength(0);
  });

  it("alerts the newcomer once, on the first reply, with a deep link to their intro", async () => {
    const { db, intros } = makeDb({ roles: { newcomer_1: "NEWCOMER", member_1: "NEWCOMER", guide_1: "GUIDE" } });
    await recordWelcomeIntroActivity(db, {
      post,
      comment: comment("c_intro", "Hi all", new Date("2026-09-26T10:00:00Z")),
      author: newcomer,
      mentionedUserIds: [],
    });
    // member_1 has no intro yet, so a plain comment would become theirs -
    // replying explicitly marks it as an answer instead.
    const first = await recordWelcomeIntroActivity(db, {
      post,
      comment: comment("c_reply", "Welcome [@newcomer]!", new Date("2026-09-26T10:05:00Z")),
      author: member,
      mentionedUserIds: [],
      replyToCommentId: "c_intro",
    });
    expect(first.notifiedNewcomerIds).toEqual(["newcomer_1"]);
    expect(intros[0]).toMatchObject({ responderId: "member_1", responseCommentId: "c_reply" });
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        userId: "newcomer_1",
        type: WELCOME_INTRO_REPLY_NOTIFICATION,
        title: "💬 Member Max replied to your intro",
        body: "Welcome @newcomer!",
        push: true,
        data: expect.objectContaining({ postId: "welcome_post", commentId: "c_intro", replyCommentId: "c_reply" }),
      }),
    );

    // A second reply (here: the guide @mentioning them) doesn't re-alert.
    const second = await recordWelcomeIntroActivity(db, {
      post,
      comment: comment("c_reply2", "Glad you're here", new Date("2026-09-26T10:06:00Z")),
      author: { id: "guide_1", name: "Guide Gil", email: "gil@example.test" },
      mentionedUserIds: ["newcomer_1"],
    });
    expect(second.notifiedNewcomerIds).toEqual([]);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("counts an @mention of the newcomer as a reply", async () => {
    const { db, intros } = makeDb({ roles: { newcomer_1: "NEWCOMER", guide_1: "GUIDE" } });
    await recordWelcomeIntroActivity(db, {
      post,
      comment: comment("c_intro", "Hi all"),
      author: newcomer,
      mentionedUserIds: [],
    });
    const result = await recordWelcomeIntroActivity(db, {
      post,
      comment: comment("c_guide", "Hey [@newcomer] welcome", new Date("2026-09-26T11:00:00Z")),
      author: { id: "guide_1", name: null, email: "gil@example.test" },
      mentionedUserIds: ["newcomer_1"],
    });
    expect(result.notifiedNewcomerIds).toEqual(["newcomer_1"]);
    expect(intros[0].respondedAt).toBeInstanceOf(Date);
  });

  it("does not treat the newcomer's own follow-ups, bots, or unrelated comments as replies", async () => {
    const { db, intros } = makeDb({ roles: { newcomer_1: "NEWCOMER", guide_1: "GUIDE" } });
    await recordWelcomeIntroActivity(db, {
      post,
      comment: comment("c_intro", "Hi all"),
      author: newcomer,
      mentionedUserIds: [],
    });
    await recordWelcomeIntroActivity(db, {
      post,
      comment: comment("c_self", "Also I like hiking", new Date("2026-09-26T10:01:00Z")),
      author: newcomer,
      mentionedUserIds: ["newcomer_1"],
    });
    await recordWelcomeIntroActivity(db, {
      post,
      comment: comment("c_bot", "[@newcomer] welcome", new Date("2026-09-26T10:02:00Z")),
      author: { id: "sage", name: "Sage", email: "sage@bot.test", isBot: true },
      mentionedUserIds: ["newcomer_1"],
    });
    await recordWelcomeIntroActivity(db, {
      post,
      comment: comment("c_other", "Morning everyone", new Date("2026-09-26T10:03:00Z")),
      author: { id: "guide_1", name: "Guide Gil", email: "gil@example.test" },
      mentionedUserIds: [],
    });
    expect(intros[0].respondedAt).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });

  it("writes the inbox row without a phone push when the newcomer muted the lounge", async () => {
    const { db } = makeDb({
      roles: { newcomer_1: "NEWCOMER", guide_1: "GUIDE" },
      levels: { newcomer_1: "NONE" },
    });
    await recordWelcomeIntroActivity(db, {
      post,
      comment: comment("c_intro", "Hi all"),
      author: newcomer,
      mentionedUserIds: [],
    });
    await recordWelcomeIntroActivity(db, {
      post,
      comment: comment("c_reply", "Welcome!", new Date("2026-09-26T10:05:00Z")),
      author: { id: "guide_1", name: "Guide Gil", email: "gil@example.test" },
      mentionedUserIds: [],
      replyToCommentId: "c_intro",
    });
    expect(push).toHaveBeenCalledWith(db, expect.objectContaining({ userId: "newcomer_1", push: false }));
  });
});

describe("recordWelcomeIntroReaction", () => {
  async function seedIntro() {
    const seeded = makeDb({ roles: { newcomer_1: "NEWCOMER", member_1: "NEWCOMER", guide_1: "GUIDE" } });
    await recordWelcomeIntroActivity(seeded.db, {
      post,
      comment: comment("c_intro", "Hi all"),
      author: newcomer,
      mentionedUserIds: [],
    });
    return seeded;
  }

  it("counts a first reaction from someone else as the intro's response", async () => {
    const { db, intros } = await seedIntro();
    expect(await recordWelcomeIntroReaction(db, { commentId: "c_intro", reactor: member })).toBe(true);
    expect(intros[0]).toMatchObject({ responderId: "member_1", responseCommentId: null });
    expect(intros[0].respondedAt).toBeInstanceOf(Date);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        userId: "newcomer_1",
        type: WELCOME_INTRO_REPLY_NOTIFICATION,
        title: "💬 Member Max reacted to your intro",
        data: expect.objectContaining({ postId: "welcome_post", commentId: "c_intro" }),
      }),
    );
    // Answered intros are no longer escalated.
    expect(await escalateUnansweredIntros(db, new Date("2026-09-27T12:00:00Z"))).toEqual({
      guideNotified: 0,
      adminNotified: 0,
    });
  });

  it("ignores the newcomer's own reaction, bots, and comments that aren't intros", async () => {
    const { db, intros } = await seedIntro();
    expect(await recordWelcomeIntroReaction(db, { commentId: "c_intro", reactor: newcomer })).toBe(false);
    expect(
      await recordWelcomeIntroReaction(db, {
        commentId: "c_intro",
        reactor: { id: "sage", name: "Sage", email: "sage@bot.test", isBot: true },
      }),
    ).toBe(false);
    expect(await recordWelcomeIntroReaction(db, { commentId: "not_an_intro", reactor: member })).toBe(false);
    expect(intros[0].respondedAt).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });

  it("alerts once across reactions and replies, whichever comes first", async () => {
    const reactFirst = await seedIntro();
    expect(await recordWelcomeIntroReaction(reactFirst.db, { commentId: "c_intro", reactor: member })).toBe(true);
    const guide = { id: "guide_1", name: "Guide Gil", email: "gil@example.test" };
    expect(await recordWelcomeIntroReaction(reactFirst.db, { commentId: "c_intro", reactor: guide })).toBe(false);
    const reply = await recordWelcomeIntroActivity(reactFirst.db, {
      post,
      comment: comment("c_reply", "Welcome!", new Date("2026-09-26T10:05:00Z")),
      author: guide,
      mentionedUserIds: [],
      replyToCommentId: "c_intro",
    });
    expect(reply.notifiedNewcomerIds).toEqual([]);
    expect(push).toHaveBeenCalledTimes(1);

    push.mockClear();
    const replyFirst = await seedIntro();
    await recordWelcomeIntroActivity(replyFirst.db, {
      post,
      comment: comment("c_reply", "Welcome!", new Date("2026-09-26T10:05:00Z")),
      author: guide,
      mentionedUserIds: [],
      replyToCommentId: "c_intro",
    });
    expect(await recordWelcomeIntroReaction(replyFirst.db, { commentId: "c_intro", reactor: member })).toBe(false);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][1].title).toBe("💬 Guide Gil replied to your intro");
  });
});

describe("escalateUnansweredIntros", () => {
  const createdAt = new Date("2026-09-26T00:00:00Z");
  const baseIntro = (): IntroRow => ({
    id: "intro_1",
    coopId: "coop_1",
    groupId: "lounge_1",
    postId: "welcome_post",
    commentId: "c_intro",
    newcomerId: "newcomer_1",
    createdAt,
    respondedAt: null,
    guideEscalatedAt: null,
    adminEscalatedAt: null,
  });
  const at = (ms: number) => new Date(createdAt.getTime() + ms);

  it("does nothing before the guide threshold", async () => {
    const { db, intros } = makeDb({ roles: { guide_1: "GUIDE" }, intros: [baseIntro()], admins: ["admin_1"] });
    const result = await escalateUnansweredIntros(db, at(INTRO_GUIDE_ESCALATION_AFTER_MS - 1));
    expect(result).toEqual({ guideNotified: 0, adminNotified: 0 });
    expect(intros[0].guideEscalatedAt).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });

  it("notifies the guide once after ~2h, even across repeated sweeps", async () => {
    const { db, intros } = makeDb({ roles: { guide_1: "GUIDE", newcomer_1: "NEWCOMER" }, intros: [baseIntro()], admins: ["admin_1"] });
    const now = at(INTRO_GUIDE_ESCALATION_AFTER_MS + 60_000);
    expect(await escalateUnansweredIntros(db, now)).toEqual({ guideNotified: 1, adminNotified: 0 });
    expect(await escalateUnansweredIntros(db, now)).toEqual({ guideNotified: 0, adminNotified: 0 });
    expect(intros[0].guideEscalatedAt).toEqual(now);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        userId: "guide_1",
        type: WELCOME_INTRO_UNANSWERED_NOTIFICATION,
        data: expect.objectContaining({ postId: "welcome_post", commentId: "c_intro" }),
      }),
    );
  });

  it("notifies platform admins once after ~12h, linking to guide assignment, without re-alerting the guide", async () => {
    const intro = { ...baseIntro(), guideEscalatedAt: at(INTRO_GUIDE_ESCALATION_AFTER_MS) };
    const { db, intros } = makeDb({ roles: { guide_1: "GUIDE" }, intros: [intro], admins: ["admin_1", "admin_2"] });
    const now = at(INTRO_ADMIN_ESCALATION_AFTER_MS + 60_000);
    expect(await escalateUnansweredIntros(db, now)).toEqual({ guideNotified: 0, adminNotified: 2 });
    expect(await escalateUnansweredIntros(db, now)).toEqual({ guideNotified: 0, adminNotified: 0 });
    expect(intros[0].adminEscalatedAt).toEqual(now);
    expect(push.mock.calls.map(([, payload]) => payload.userId)).toEqual(["admin_1", "admin_2"]);

    // Recipients come from the platform admin allowlist, not commons roles.
    const adminLookup = db.user.findMany.mock.calls[0][0];
    expect(adminLookup.where.OR).toEqual(
      expect.arrayContaining([{ email: { in: ["root@example.test"], mode: "insensitive" } }]),
    );
    expect(db.userCoopMembership.findMany).not.toHaveBeenCalled();

    const payload = push.mock.calls[0][1];
    expect(payload).toMatchObject({
      type: WELCOME_INTRO_UNANSWERED_ADMIN_NOTIFICATION,
      data: {
        groupId: "lounge_1",
        coopId: "coop_1",
        introId: "intro_1",
        adminPath: welcomeLoungesAdminPath("coop_1"),
      },
    });
    expect(payload.body).toContain("/portal/admin/commons/coop_1/welcome-tables");
    // Private lounge: admins who aren't seated can't open the post.
    expect(payload.data).not.toHaveProperty("postId");
  });

  it("skips answered intros entirely", async () => {
    const intro = { ...baseIntro(), respondedAt: at(60_000) };
    const { db } = makeDb({ roles: { guide_1: "GUIDE" }, intros: [intro], admins: ["admin_1"] });
    expect(await escalateUnansweredIntros(db, at(INTRO_ADMIN_ESCALATION_AFTER_MS * 2))).toEqual({
      guideNotified: 0,
      adminNotified: 0,
    });
    expect(push).not.toHaveBeenCalled();
  });

  it("claims the guide stage even when no guide is seated, leaving it to the admin stage", async () => {
    const { db, intros } = makeDb({ roles: { newcomer_1: "NEWCOMER" }, intros: [baseIntro()], admins: [] });
    const result = await escalateUnansweredIntros(db, at(INTRO_GUIDE_ESCALATION_AFTER_MS + 1));
    expect(result).toEqual({ guideNotified: 0, adminNotified: 0 });
    expect(intros[0].guideEscalatedAt).not.toBeNull();
    expect(intros[0].adminEscalatedAt).toBeNull();
  });
});

describe("commentPreview", () => {
  it("decodes mention tokens and truncates long text", () => {
    expect(commentPreview("Hi [@nia], welcome!")).toBe("Hi @nia, welcome!");
    expect(commentPreview("x".repeat(200), 10)).toBe(`${"x".repeat(9)}…`);
  });
});
