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
