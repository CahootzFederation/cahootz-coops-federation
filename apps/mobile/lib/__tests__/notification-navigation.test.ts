import { describe, expect, it } from "@jest/globals";

import type { AccountNotification } from "@repo/validators/notification";

import { notificationDestination } from "../notification-navigation";

const notification: AccountNotification = {
  id: "test",
  coopId: "cahootz",
  type: "MENTION",
  title: "Test",
  body: "Test",
  data: null,
  read: false,
  createdAt: "2026-09-13T00:00:00Z",
};
describe("notification destinations", () => {
  it("keeps unsupported activity readable without guessing a route", () => {
    expect(notificationDestination(notification)).toBeNull();
    expect(
      notificationDestination({
        ...notification,
        data: { postId: 123, url: "https://untrusted.test" },
      }),
    ).toBeNull();
  });
  it("opens a direct message on its private circle thread", () => {
    expect(
      notificationDestination({
        ...notification,
        type: "DIRECT_MESSAGE",
        data: { groupId: "dm_1", coopId: "cahootz" },
      }),
    ).toEqual({
      pathname: "/(tabs)/messages",
      params: { groupId: "dm_1" },
    });
  });
  it("uses structured parameters for commons posts", () => {
    expect(
      notificationDestination({
        ...notification,
        data: { postId: "post/with spaces" },
      }),
    ).toEqual({
      pathname: "/[coopId]/posts/[postId]",
      params: { coopId: "cahootz", postId: "post/with spaces" },
    });
  });
  it("opens a welcome intro alert on the intro comment itself", () => {
    expect(
      notificationDestination({
        ...notification,
        type: "WELCOME_INTRO_REPLY",
        data: { postId: "welcome-post", commentId: "intro-comment", coopId: "cahootz" },
      }),
    ).toEqual({
      pathname: "/[coopId]/posts/[postId]",
      params: { coopId: "cahootz", postId: "welcome-post", commentId: "intro-comment", focus: "intro" },
    });
    // A comment like opens on the liked comment.
    expect(
      notificationDestination({
        ...notification,
        type: "COMMONS_COMMENT_LIKE",
        data: { postId: "post-1", commentId: "liked-comment" },
      }),
    ).toEqual({
      pathname: "/[coopId]/posts/[postId]",
      params: { coopId: "cahootz", postId: "post-1", commentId: "liked-comment" },
    });
    // Other post alerts keep opening the post without a comment focus.
    expect(
      notificationDestination({
        ...notification,
        type: "WELCOME_LOUNGE_JOIN",
        data: { postId: "welcome-post", commentId: "shout-out" },
      }),
    ).toEqual({
      pathname: "/[coopId]/posts/[postId]",
      params: { coopId: "cahootz", postId: "welcome-post" },
    });
  });
  it("opens events on the event screen, even when the event post is attached", () => {
    expect(
      notificationDestination({
        ...notification,
        type: "ONBOARDING_DRIP",
        data: { eventId: "event-1", postId: "event-post", coopId: "other" },
      }),
    ).toEqual({
      pathname: "/[coopId]/events/[eventId]",
      params: { coopId: "other", eventId: "event-1" },
    });
  });
  it("opens a circle's feed when only a circle is given", () => {
    expect(
      notificationDestination({
        ...notification,
        type: "ONBOARDING_DRIP",
        data: { circleId: "circle-1" },
      }),
    ).toEqual({
      pathname: "/[coopId]/posts",
      params: { coopId: "cahootz", circleId: "circle-1" },
    });
    // A post inside a circle still opens the post itself.
    expect(
      notificationDestination({
        ...notification,
        data: { postId: "post-1", circleId: "circle-1" },
      }),
    ).toEqual({
      pathname: "/[coopId]/posts/[postId]",
      params: { coopId: "cahootz", postId: "post-1" },
    });
  });
  it("opens personal-page activity on the personal page", () => {
    expect(
      notificationDestination({
        ...notification,
        type: "PERSONAL_PAGE_COMMENT",
        data: { postId: "personal-post" },
      }),
    ).toBe("/(authenticated)/personal-page");
  });
  it.each([
    ["orderId", "order-detail"],
    ["storeId", "store-detail"],
    ["proposalId", "proposal-detail"],
  ])("opens %s on its existing detail screen", (key, screen) => {
    expect(
      notificationDestination({ ...notification, data: { [key]: "item" } }),
    ).toEqual({
      pathname: `/(authenticated)/${screen}`,
      params: { id: "item" },
    });
  });
  it.each(["transactionId", "transferId", "paymentId"])(
    "opens %s in history",
    (key) => {
      expect(
        notificationDestination({ ...notification, data: { [key]: "item" } }),
      ).toBe("/(authenticated)/history");
    },
  );
});
