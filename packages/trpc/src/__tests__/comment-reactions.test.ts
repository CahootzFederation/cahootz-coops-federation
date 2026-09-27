import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/push-notification-service.js", () => ({
  createNotificationAndPush: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../services/welcome-intros.js", () => ({
  recordWelcomeIntroReaction: vi.fn().mockResolvedValue(false),
}));

import {
  COMMONS_COMMENT_LIKE_NOTIFICATION,
  notifyNewCommentReaction,
} from "../services/comment-reactions.js";
import { createNotificationAndPush } from "../services/push-notification-service.js";
import { recordWelcomeIntroReaction } from "../services/welcome-intros.js";
import { notificationCategory } from "@repo/validators/notification";

const push = vi.mocked(createNotificationAndPush);
const introReaction = vi.mocked(recordWelcomeIntroReaction);
const db = {} as any;

const comment = {
  id: "c_1",
  authorId: "author_1",
  author: { isBot: false },
  post: { id: "post_1", coopId: "coop_1" },
};
const reactor = { id: "reactor_1", name: "Rae", email: "rae@example.test" };

beforeEach(() => {
  push.mockClear();
  introReaction.mockReset();
  introReaction.mockResolvedValue(false);
});

describe("notifyNewCommentReaction", () => {
  it("tells the comment's author, deep-linking to the comment, in the community category", async () => {
    expect(await notifyNewCommentReaction(db, { comment, reactor })).toBe("like");
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith(db, {
      userId: "author_1",
      coopId: "coop_1",
      type: COMMONS_COMMENT_LIKE_NOTIFICATION,
      title: "Someone liked your comment",
      body: "A commons member liked what you said.",
      data: { postId: "post_1", commentId: "c_1", coopId: "coop_1" },
    });
    expect(notificationCategory(COMMONS_COMMENT_LIKE_NOTIFICATION)).toBe("community");
  });

  it("never notifies for your own like, a bot's comment, or a bot's like", async () => {
    expect(await notifyNewCommentReaction(db, { comment, reactor: { ...reactor, id: "author_1" } })).toBeNull();
    expect(await notifyNewCommentReaction(db, { comment: { ...comment, author: { isBot: true } }, reactor })).toBeNull();
    expect(await notifyNewCommentReaction(db, { comment, reactor: { ...reactor, isBot: true } })).toBeNull();
    expect(push).not.toHaveBeenCalled();
    expect(introReaction).not.toHaveBeenCalled();
  });

  it("sends only the intro alert when the like is an intro's first response", async () => {
    introReaction.mockResolvedValue(true);
    expect(await notifyNewCommentReaction(db, { comment, reactor })).toBe("intro");
    expect(introReaction).toHaveBeenCalledWith(db, { commentId: "c_1", reactor });
    expect(push).not.toHaveBeenCalled();
  });

  it("falls back to the ordinary like alert once the intro was already answered", async () => {
    introReaction.mockResolvedValue(false);
    expect(await notifyNewCommentReaction(db, { comment, reactor })).toBe("like");
    expect(push).toHaveBeenCalledTimes(1);
  });
});
