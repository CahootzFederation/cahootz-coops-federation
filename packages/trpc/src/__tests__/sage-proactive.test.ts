import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  group: { findUnique: vi.fn() },
  groupComment: { count: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
  auditLog: { create: vi.fn().mockResolvedValue({}) },
  sageTask: { update: vi.fn() },
}));
const dm = vi.hoisted(() => ({
  directKeyFor: vi.fn(() => "dk"),
  openDirectCircle: vi.fn().mockResolvedValue({ group: { id: "g1", coopId: "cahootz", directKey: "dk" } }),
  sendDirectCircleMessage: vi.fn().mockResolvedValue({}),
}));
const tasks = vi.hoisted(() => ({ createSageTask: vi.fn() }));
const memberActions = vi.hoisted(() => ({ askWhetherIntroductionHelped: vi.fn() }));

vi.mock("@repo/db", () => ({ db }));
vi.mock("../lib/bot.js", () => ({ ensureSageBotUser: vi.fn().mockResolvedValue({ id: "sage", name: "Sage", email: "s@x" }) }));
vi.mock("../services/direct-circles.js", () => dm);
vi.mock("../services/sage-tasks.js", () => tasks);
vi.mock("../services/sage-member-actions.js", () => memberActions);

import {
  PROACTIVE_WEEKLY_LIMIT, checkInTopic, proactiveCountThisWeek, promiseAlreadyKept, runProactiveTask, scheduleMemberCheckIn, sendProactiveSageMessage,
} from "../services/sage-proactive.js";

const now = new Date("2026-10-13T12:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  db.group.findUnique.mockResolvedValue({ id: "g1" });
  db.groupComment.findUnique.mockResolvedValue(null);
  db.groupComment.count.mockResolvedValue(0);
});

describe("the weekly outreach limit", () => {
  it("is 7 and counts only Sage's outreach messages, which carry a sage- system key", async () => {
    expect(PROACTIVE_WEEKLY_LIMIT).toBe(7);
    db.groupComment.count.mockResolvedValue(4);
    expect(await proactiveCountThisWeek("m1", now)).toBe(4);
    const where = db.groupComment.count.mock.calls[0]![0].where;
    // Replies, confirmations and relays are written without a systemKey, so a back-and-forth never matches this.
    expect(where).toMatchObject({ groupId: "g1", authorId: "sage", systemKey: { startsWith: "sage-" } });
    expect(where.createdAt.gte.toISOString()).toBe("2026-10-06T12:00:00.000Z");
  });

  it("counts nothing for a member Sage has never talked with", async () => {
    db.group.findUnique.mockResolvedValue(null);
    expect(await proactiveCountThisWeek("m1", now)).toBe(0);
    expect(db.groupComment.count).not.toHaveBeenCalled();
  });

  it("sends with the outreach key under the limit", async () => {
    db.groupComment.count.mockResolvedValue(6);
    const result = await sendProactiveSageMessage({ userId: "m1", kind: "promise", key: "t1", content: "Checking back", now });
    expect(result).toEqual({ status: "SENT", groupId: "g1" });
    expect(dm.sendDirectCircleMessage.mock.calls[0]![1]).toMatchObject({ content: "Checking back", systemKey: "sage-promise:t1" });
  });

  it("holds the message at the limit and records why", async () => {
    db.groupComment.count.mockResolvedValue(7);
    expect(await sendProactiveSageMessage({ userId: "m1", kind: "need", key: "p1:m1", content: "x", now })).toEqual({ status: "LIMITED" });
    expect(dm.sendDirectCircleMessage).not.toHaveBeenCalled();
    expect(db.auditLog.create.mock.calls[0]![0].data.action).toBe("SAGE_PROACTIVE_LIMITED");
  });

  it("never sends the same outreach twice", async () => {
    db.groupComment.findUnique.mockResolvedValue({ id: "already" });
    expect(await sendProactiveSageMessage({ userId: "m1", kind: "promise", key: "t1", content: "x", now })).toEqual({ status: "DUPLICATE" });
    expect(dm.sendDirectCircleMessage).not.toHaveBeenCalled();
  });
});

describe("promises Sage keeps", () => {
  it("cleans the topic and refuses links", () => {
    expect(checkInTopic("  How the interview went?  ")).toBe("How the interview went");
    expect(checkInTopic("see https://example.com")).toBeNull();
    expect(checkInTopic("hi")).toBeNull();
  });

  it("schedules one promise per member, replacing the earlier one", async () => {
    tasks.createSageTask.mockResolvedValueOnce({ created: true, taskId: "t1" });
    expect(await scheduleMemberCheckIn({ memberId: "m1", coopId: "cahootz", about: "how the interview went", days: 3, now }))
      .toEqual({ ok: true, taskId: "t1", days: 3 });
    expect(tasks.createSageTask.mock.calls[0]![0]).toMatchObject({ subjectType: "member_conversation", subjectId: "m1", ownerUserId: "m1", dueInDays: 3, expected: "how the interview went" });

    tasks.createSageTask.mockResolvedValueOnce({ created: false, taskId: "t1", reason: "Sage is already following this" });
    expect(await scheduleMemberCheckIn({ memberId: "m1", coopId: "cahootz", about: "the new apartment", days: 30, now }))
      .toEqual({ ok: true, taskId: "t1", days: 14 });
    expect(db.sageTask.update.mock.calls[0]![0].data).toMatchObject({ expected: "the new apartment", attempts: 0 });
  });

  it("counts a promise as kept only if the member talked with Sage after it and Sage answered", async () => {
    const task = { ownerUserId: "m1", createdAt: new Date("2026-10-10") };
    db.groupComment.findFirst.mockResolvedValueOnce(null);
    expect(await promiseAlreadyKept(task)).toBe(false);
    db.groupComment.findFirst.mockResolvedValueOnce({ createdAt: new Date("2026-10-11") }).mockResolvedValueOnce({ id: "reply" });
    expect(await promiseAlreadyKept(task)).toBe(true);
    // Sage's answer must be a reply (no systemKey), not more outreach.
    expect(db.groupComment.findFirst.mock.calls[2]![0].where).toMatchObject({ authorId: "sage", systemKey: null });
  });

  it("sends the promised check-back through the limit", async () => {
    const task = { id: "t1", ownerUserId: "m1", subjectType: "member_conversation", expected: "How the interview went" } as never;
    expect(await runProactiveTask(task, now)).toBe("SENT");
    expect(dm.sendDirectCircleMessage.mock.calls[0]![1]).toMatchObject({ content: "Checking back like I said: how the interview went?", systemKey: "sage-promise:t1" });
    db.groupComment.count.mockResolvedValue(7);
    expect(await runProactiveTask({ ...(task as object), id: "t2" } as never, now)).toBe("LIMITED");
  });

  it("hands an introduction outcome to the thanks flow", async () => {
    memberActions.askWhetherIntroductionHelped.mockResolvedValue("SENT");
    expect(await runProactiveTask({ id: "t3", ownerUserId: "m1", subjectType: "introduction_outcome", subjectId: "intro1" } as never, now)).toBe("SENT");
    expect(memberActions.askWhetherIntroductionHelped).toHaveBeenCalledWith("intro1", "m1", now);
  });
});
