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
  it("opens commons invitations and steward requests in their screens", () => {
    expect(
      notificationDestination({
        ...notification,
        type: "COMMONS_INVITATION",
        data: { invitationId: "inv_1" },
      }),
    ).toEqual({
      pathname: "/invitations/[invitationId]",
      params: { invitationId: "inv_1" },
    });
    expect(
      notificationDestination({
        ...notification,
        type: "COMMONS_ACCESS_REQUEST",
        coopId: "family-abc",
        data: { coopId: "family-abc", applicationId: "app_1" },
      }),
    ).toEqual({
      pathname: "/(authenticated)/commons-invites",
      params: { coopId: "family-abc" },
    });
    expect(
      notificationDestination({
        ...notification,
        type: "COMMONS_ACCESS_APPROVED",
        data: { coopId: "family-abc", postId: "post_1" },
      }),
    ).toEqual({
      pathname: "/[coopId]/posts/[postId]",
      params: { coopId: "family-abc", postId: "post_1" },
    });
    expect(
      notificationDestination({
        ...notification,
        type: "COMMONS_ACCESS_APPROVED",
        data: { coopId: "family-abc", postId: null },
      }),
    ).toEqual({ pathname: "/[coopId]/posts", params: { coopId: "family-abc" } });
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
  it("opens a routed Sage alert on its own page, not the post it's about", () => {
    expect(
      notificationDestination({
        ...notification,
        type: "SAGE_ALERT",
        data: { alertId: "alert_1", coopId: "cahootz", postId: "post_1" },
      }),
    ).toEqual({
      pathname: "/(authenticated)/sage/alert/[id]",
      params: { id: "alert_1" },
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
  it("keeps proposal drafts scoped to their commons", () => {
    expect(notificationDestination({ ...notification, type: "PROPOSAL_DRAFT_READY", data: null })).toEqual({
      pathname: "/(authenticated)/commons-proposal-drafts",
      params: { coopId: "cahootz" },
    });
  });
  it.each([
    ["orderId", "order-detail"],
    ["storeId", "store-detail"],
  ])("opens %s on its existing detail screen", (key, screen) => {
    expect(
      notificationDestination({ ...notification, data: { [key]: "item" } }),
    ).toEqual({
      pathname: `/(authenticated)/${screen}`,
      params: { id: "item" },
    });
  });
  it("opens a proposal in its commons context", () => {
    expect(notificationDestination({ ...notification, data: { proposalId: "item", coopId: "another" } })).toEqual({
      pathname: "/(authenticated)/proposal-detail",
      params: { id: "item", coopId: "another" },
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
  it("opens a new member's profile, or the circle they joined", () => {
    expect(
      notificationDestination({
        ...notification,
        type: "COMMONS_MEMBER_JOINED",
        data: { coopId: "family", memberHandle: "ana" },
      }),
    ).toEqual({ pathname: "/people/[handle]", params: { handle: "ana" } });
    expect(
      notificationDestination({
        ...notification,
        type: "COMMONS_MEMBER_JOINED",
        data: { coopId: "family", memberHandle: null },
      }),
    ).toEqual({ pathname: "/[coopId]/posts", params: { coopId: "family" } });
    expect(
      notificationDestination({
        ...notification,
        type: "CIRCLE_MEMBER_JOINED",
        data: { coopId: "cahootz", circleId: "g1", memberHandle: "ana" },
      }),
    ).toEqual({ pathname: "/[coopId]/posts", params: { coopId: "cahootz", circleId: "g1" } });
  });
});
