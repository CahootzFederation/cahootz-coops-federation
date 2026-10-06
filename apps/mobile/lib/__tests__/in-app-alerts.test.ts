import { describe, expect, it } from "@jest/globals";

import type { AccountNotification } from "@repo/validators/notification";

import {
  IN_APP_ALERT_QUEUE_LIMIT,
  alertFromPush,
  enqueueAlerts,
  inAppAlertKind,
  shouldShowInAppAlert,
  takeNewAlerts,
} from "../in-app-alerts";

function alert(id: string, overrides: Partial<AccountNotification> = {}): AccountNotification {
  return {
    id,
    coopId: "cahootz",
    type: "MENTION",
    title: id,
    body: "",
    data: null,
    read: false,
    createdAt: `2026-10-05T00:00:0${id.slice(-1)}Z`,
    ...overrides,
  };
}

describe("in-app alert popups", () => {
  it("records what's already there on the first check, then pops up only new unread alerts, oldest first", () => {
    const seen = new Set<string>();
    expect(takeNewAlerts([alert("a1"), alert("a2")], seen, true)).toEqual([]);
    const next = takeNewAlerts([alert("a4"), alert("a3"), alert("a2"), alert("a5", { read: true })], seen, false);
    expect(next.map((item) => item.id)).toEqual(["a3", "a4"]);
    expect(takeNewAlerts([alert("a4")], seen, false)).toEqual([]);
  });

  it("keeps the alert on screen and the newest arrivals when too many queue up", () => {
    const queue = enqueueAlerts([alert("a1")], [alert("a2"), alert("a3"), alert("a4"), alert("a1")]);
    expect(queue).toHaveLength(IN_APP_ALERT_QUEUE_LIMIT);
    expect(queue.map((item) => item.id)).toEqual(["a1", "a3", "a4"]);
  });

  it("builds an openable alert from a foreground push", () => {
    expect(
      alertFromPush({
        title: "Ana joined Book Club",
        body: "They can now see and post in the circle.",
        data: { notificationId: "n1", notificationType: "CIRCLE_MEMBER_JOINED", coopId: "c1", circleId: "g1" },
      }),
    ).toMatchObject({ id: "n1", type: "CIRCLE_MEMBER_JOINED", coopId: "c1", data: { circleId: "g1" } });
    expect(alertFromPush({ title: "Old push", body: null, data: {} })).toBeNull();
  });

  it("styles joins, Sage, mentions and messages differently", () => {
    expect(inAppAlertKind("COMMONS_MEMBER_JOINED")).toBe("joined");
    expect(inAppAlertKind("CIRCLE_MEMBER_JOINED")).toBe("joined");
    expect(inAppAlertKind("WELCOME_LOUNGE_JOIN")).toBe("joined");
    expect(inAppAlertKind("SAGE_SUGGESTION_NEEDS_YOU")).toBe("sage");
    expect(inAppAlertKind("MENTION")).toBe("mention");
    expect(inAppAlertKind("CIRCLE_POST")).toBe("message");
    expect(inAppAlertKind("PAYMENT_RECEIVED")).toBe("other");
  });

  it("stays quiet on the Alerts screen", () => {
    expect(shouldShowInAppAlert("/notifications")).toBe(false);
    expect(shouldShowInAppAlert("/")).toBe(true);
    expect(shouldShowInAppAlert("/cahootz/posts")).toBe(true);
    expect(shouldShowInAppAlert("/notification-settings")).toBe(true);
  });
});
