import { describe, expect, it } from "@jest/globals";

import type { AccountNotification } from "@repo/validators/notification";

import {
  EMPTY_ALERT_QUEUE,
  IN_APP_ALERT_QUEUE_LIMIT,
  alertCardText,
  alertFromPush,
  alertsWaiting,
  enqueueAlerts,
  nextAlertCard,
  waitingLabel,
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

  it("groups a burst of the same kind into one card instead of a run of identical popups", () => {
    const mentions = ["a1", "a2", "a3", "a4", "a5"].map((id) =>
      alert(id, { title: "You were mentioned", body: `Test User 2 mentioned you in post ${id}.` }),
    );
    const queue = enqueueAlerts(EMPTY_ALERT_QUEUE, mentions);
    expect(queue.cards).toHaveLength(1);
    expect(alertCardText(queue.cards[0])).toEqual({
      title: "You were mentioned 5 times",
      body: "Latest: Test User 2 mentioned you in post a5.",
    });
    expect(waitingLabel(queue)).toBeNull();

    // More of the same kind join the card on screen; repeats are ignored.
    const grown = enqueueAlerts(queue, [alert("a6"), alert("a1")]);
    expect(grown.cards).toHaveLength(1);
    expect(grown.cards[0].alerts).toHaveLength(6);
  });

  it("reads a single alert as itself", () => {
    const queue = enqueueAlerts(EMPTY_ALERT_QUEUE, [
      alert("a1", { title: "You were mentioned", body: "Test User 2 mentioned you in a post." }),
    ]);
    expect(alertCardText(queue.cards[0])).toEqual({
      title: "You were mentioned",
      body: "Test User 2 mentioned you in a post.",
    });
  });

  it("counts every waiting alert, including the ones that won't get their own card", () => {
    const queue = enqueueAlerts(EMPTY_ALERT_QUEUE, [
      alert("a1", { type: "MENTION" }),
      alert("a2", { type: "CIRCLE_MEMBER_JOINED" }),
      alert("a3", { type: "CIRCLE_MEMBER_JOINED" }),
      alert("a4", { type: "SAGE_SUGGESTION_READY" }),
      alert("a5", { type: "DIRECT_MESSAGE" }),
      alert("a6", { type: "DIRECT_MESSAGE" }),
    ]);
    // On screen: the mention. Waiting: Sage and messages. Dropped: the two joins.
    expect(queue.cards.map((card) => card.kind)).toEqual(["mention", "sage", "message"]);
    expect(queue.cards).toHaveLength(IN_APP_ALERT_QUEUE_LIMIT);
    expect(queue.overflow).toBe(2);
    expect(alertsWaiting(queue)).toBe(5);
    expect(waitingLabel(queue)).toBe("+5 more in Alerts");

    const next = nextAlertCard(queue);
    expect(next.cards[0].kind).toBe("sage");
    expect(waitingLabel(next)).toBe("+4 more in Alerts");
    // Once everything has shown, the count starts over.
    expect(nextAlertCard(nextAlertCard(next))).toEqual(EMPTY_ALERT_QUEUE);
  });

  it('says "+N more" with the real count when everything fits', () => {
    const queue = enqueueAlerts(EMPTY_ALERT_QUEUE, [
      alert("a1", { type: "MENTION" }),
      alert("a2", { type: "DIRECT_MESSAGE" }),
      alert("a3", { type: "DIRECT_MESSAGE" }),
    ]);
    expect(waitingLabel(queue)).toBe("+2 more");
    expect(alertCardText(queue.cards[1]).title).toBe("2 new messages");
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
