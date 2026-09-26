import { beforeEach, describe, expect, it, vi } from "vitest";

const createNotificationAndPush = vi.fn().mockResolvedValue(undefined);
vi.mock("../services/push-notification-service.js", () => ({
  createNotificationAndPush: (...args: unknown[]) =>
    createNotificationAndPush(...args),
}));

import { notifyCircleActivity } from "../services/circle-notifications.js";

function makeDb(
  members: Array<{ userId: string; notificationLevel: string; isBot?: boolean }>,
  chattingUserIds: string[] = [],
) {
  return {
    group: { findUnique: vi.fn().mockResolvedValue({ name: "Garden Club" }) },
    groupMember: {
      findMany: vi.fn().mockResolvedValue(
        members.map((member) => ({
          userId: member.userId,
          notificationLevel: member.notificationLevel,
          user: { isBot: !!member.isBot },
        })),
      ),
    },
    circleChatPresence: {
      findMany: vi
        .fn()
        .mockResolvedValue(chattingUserIds.map((userId) => ({ userId }))),
    },
  };
}

const base = {
  coopId: "coop",
  circleId: "circle-1",
  postId: "post-1",
  actorId: "author",
  actorName: "Ada",
};

function sent() {
  return createNotificationAndPush.mock.calls.map(([, payload]) => ({
    userId: payload.userId,
    type: payload.type,
    push: payload.push,
  }));
}

describe("notifyCircleActivity", () => {
  beforeEach(() => createNotificationAndPush.mockClear());

  it("notifies ALL members of new posts, and only mentioned MENTIONS members", async () => {
    const db = makeDb([
      { userId: "author", notificationLevel: "ALL" },
      { userId: "all", notificationLevel: "ALL" },
      { userId: "mentions", notificationLevel: "MENTIONS" },
      { userId: "mentioned", notificationLevel: "MENTIONS" },
      { userId: "sage", notificationLevel: "ALL", isBot: true },
    ]);

    await notifyCircleActivity(db, {
      ...base,
      kind: "post",
      mentionedUserIds: ["mentioned"],
    });

    expect(sent()).toEqual([
      { userId: "mentioned", type: "MENTION", push: true },
      { userId: "all", type: "CIRCLE_POST", push: true },
    ]);
    expect(createNotificationAndPush.mock.calls[1][1].body).toBe(
      "Ada posted in Garden Club.",
    );
  });

  it("keeps mentions in the inbox but skips the push for muted members", async () => {
    const db = makeDb([{ userId: "muted", notificationLevel: "NONE" }]);

    await notifyCircleActivity(db, {
      ...base,
      kind: "comment",
      mentionedUserIds: [],
      postAuthorId: "muted",
    });

    expect(sent()).toEqual([
      { userId: "muted", type: "COMMONS_COMMENT", push: false },
    ]);
  });

  it("sends one notification per person and skips members with the chat open", async () => {
    const db = makeDb(
      [
        { userId: "author-of-post", notificationLevel: "ALL" },
        { userId: "chatting", notificationLevel: "ALL" },
        { userId: "all", notificationLevel: "ALL" },
      ],
      ["chatting"],
    );

    await notifyCircleActivity(db, {
      ...base,
      kind: "comment",
      mentionedUserIds: ["author-of-post"],
      postAuthorId: "author-of-post",
    });

    expect(sent()).toEqual([
      { userId: "author-of-post", type: "MENTION", push: true },
      { userId: "all", type: "CIRCLE_COMMENT", push: true },
    ]);
  });
});
