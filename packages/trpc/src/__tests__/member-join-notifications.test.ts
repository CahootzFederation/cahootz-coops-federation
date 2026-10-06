import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/push-notification-service.js", () => ({
  createNotificationAndPush: vi.fn().mockResolvedValue({ id: "alert" }),
}));

import { createNotificationAndPush } from "../services/push-notification-service.js";
import {
  notifyCircleMemberJoined,
  notifyCommonsMemberJoined,
} from "../services/member-join-notifications";

const push = vi.mocked(createNotificationAndPush);

beforeEach(() => push.mockClear());

function commonsDb(stewardIds: string[]) {
  return {
    userCoopMembership: {
      findMany: vi.fn().mockResolvedValue(stewardIds.map((userId) => ({ userId }))),
    },
    user: { findUnique: vi.fn().mockResolvedValue({ name: "Ana", handle: "ana", email: "ana@x.test" }) },
    coopConfig: { findFirst: vi.fn().mockResolvedValue({ name: "Robinson Family" }) },
  };
}

describe("notifyCommonsMemberJoined", () => {
  it("alerts every steward except the joiner and anyone already told", async () => {
    const db = commonsDb(["steward-1", "steward-2", "inviter", "ana"]);
    await notifyCommonsMemberJoined(db, { coopId: "family", userId: "ana", exceptUserIds: ["inviter"] });

    expect(push.mock.calls.map(([, payload]) => payload.userId)).toEqual(["steward-1", "steward-2"]);
    expect(push.mock.calls[0][1]).toMatchObject({
      coopId: "family",
      type: "COMMONS_MEMBER_JOINED",
      title: "Ana joined Robinson Family",
      data: { coopId: "family", memberId: "ana", memberHandle: "ana" },
    });
  });

  it("never alerts for the platform-wide commons everyone joins on sign-up", async () => {
    const db = commonsDb(["steward-1"]);
    await notifyCommonsMemberJoined(db, { coopId: "cahootz", userId: "ana" });
    expect(db.userCoopMembership.findMany).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});

function circleDb(group: Record<string, unknown> | null, members: Array<{ userId: string; notificationLevel: string }>) {
  return {
    group: { findUnique: vi.fn().mockResolvedValue(group) },
    user: { findUnique: vi.fn().mockResolvedValue({ name: null, handle: "ana", email: "ana@x.test" }) },
    groupMember: { findMany: vi.fn().mockResolvedValue(members) },
  };
}

const circle = { coopId: "cahootz", name: "Book Club", leaderId: "leader", kind: "STANDARD" };

describe("notifyCircleMemberJoined", () => {
  it("alerts the leader and the inviter once each, linking to the circle", async () => {
    const db = circleDb(circle, [
      { userId: "leader", notificationLevel: "MENTIONS" },
      { userId: "inviter", notificationLevel: "ALL" },
    ]);
    await notifyCircleMemberJoined(db, { groupId: "g1", userId: "ana", inviterId: "inviter" });

    expect(push.mock.calls.map(([, payload]) => payload.userId)).toEqual(["leader", "inviter"]);
    expect(push.mock.calls[0][1]).toMatchObject({
      type: "CIRCLE_MEMBER_JOINED",
      title: "@ana joined Book Club",
      push: true,
      data: { coopId: "cahootz", circleId: "g1", memberId: "ana", memberHandle: "ana" },
    });
  });

  it("keeps the inbox row but skips the phone push when the leader muted the circle", async () => {
    const db = circleDb(circle, [{ userId: "leader", notificationLevel: "NONE" }]);
    await notifyCircleMemberJoined(db, { groupId: "g1", userId: "ana" });
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][1]).toMatchObject({ userId: "leader", push: false });
  });

  it("skips the leader joining their own circle, people who left, and non-standard circles", async () => {
    await notifyCircleMemberJoined(circleDb(circle, [{ userId: "leader", notificationLevel: "ALL" }]), {
      groupId: "g1",
      userId: "leader",
    });
    await notifyCircleMemberJoined(circleDb(circle, []), { groupId: "g1", userId: "ana" });
    await notifyCircleMemberJoined(circleDb({ ...circle, kind: "WELCOME_TABLE" }, []), { groupId: "g1", userId: "ana" });
    await notifyCircleMemberJoined(circleDb({ ...circle, kind: "DIRECT" }, []), { groupId: "g1", userId: "ana" });
    expect(push).not.toHaveBeenCalled();
  });
});
