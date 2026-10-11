import type { AccountNotification } from "@repo/validators/notification";

/** How often the open app checks for alerts that didn't arrive by push. */
export const IN_APP_ALERT_POLL_MS = 15_000;
/** How long a popup stays up before it slides away on its own. */
export const IN_APP_ALERT_VISIBLE_MS = 7_000;
/** Cards waiting their turn; past this, older ones are dropped (they are all in Alerts). */
export const IN_APP_ALERT_QUEUE_LIMIT = 3;

export type InAppAlertKind = "sage" | "joined" | "mention" | "message" | "other";

export function inAppAlertKind(type: string): InAppAlertKind {
  if (type.startsWith("SAGE_") || type === "PROPOSAL_DRAFT_READY") return "sage";
  if (
    type === "COMMONS_MEMBER_JOINED" ||
    type === "CIRCLE_MEMBER_JOINED" ||
    type === "WELCOME_LOUNGE_JOIN" ||
    type === "COMMONS_INVITATION_ACCEPTED" ||
    type === "NEW_FOLLOWER"
  )
    return "joined";
  if (type === "MENTION") return "mention";
  if (
    type === "CIRCLE_POST" ||
    type === "CIRCLE_COMMENT" ||
    type === "COMMONS_COMMENT" ||
    type === "PERSONAL_PAGE_COMMENT" ||
    type === "DIRECT_MESSAGE" ||
    type.startsWith("WELCOME_INTRO_")
  )
    return "message";
  return "other";
}

/** The Alerts screen already lists everything live, so no popup there. */
export function shouldShowInAppAlert(pathname: string) {
  return !/(^|\/)notifications$/.test(pathname);
}

/**
 * Turns a push that arrived while the app was open into the same shape the
 * inbox uses, so the popup can open it the same way. Pushes from before the
 * server attached `notificationId` have nothing to mark read, so they're skipped.
 */
export function alertFromPush(content: {
  title: string | null;
  body: string | null;
  data?: Record<string, unknown> | null;
}): AccountNotification | null {
  const data = content.data ?? {};
  const id = typeof data.notificationId === "string" ? data.notificationId : null;
  if (!id) return null;
  return {
    id,
    coopId: typeof data.coopId === "string" ? data.coopId : "",
    type: typeof data.notificationType === "string" ? data.notificationType : "",
    title: content.title ?? "",
    body: content.body ?? "",
    data,
    read: false,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Alerts in `latest` that haven't been shown or seen before, oldest first.
 * Everything in `latest` is added to `seen`. The first check after sign-in
 * only records what's already there, so opening the app doesn't replay
 * yesterday's alerts as popups.
 */
export function takeNewAlerts(
  latest: AccountNotification[],
  seen: Set<string>,
  firstCheck: boolean,
): AccountNotification[] {
  const fresh = latest.filter((alert) => !alert.read && !seen.has(alert.id));
  for (const alert of latest) seen.add(alert.id);
  if (firstCheck) return [];
  return [...fresh].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * One popup card. Alerts of the same kind that arrive close together share a
 * card ("You were mentioned 5 times") instead of a run of identical popups.
 */
export type InAppAlertCard = { kind: InAppAlertKind; alerts: AccountNotification[] };

/**
 * Cards waiting to show (the first is on screen), plus how many alerts didn't
 * fit in a card. Those are still unread in Alerts, and counted in "+N more".
 */
export type InAppAlertQueue = { cards: InAppAlertCard[]; overflow: number };

export const EMPTY_ALERT_QUEUE: InAppAlertQueue = { cards: [], overflow: 0 };

/**
 * Adds new alerts to the card of the same kind (including the one on screen),
 * or to a new card. Past the card limit, the oldest waiting cards are dropped
 * and their alerts counted in `overflow`.
 */
export function enqueueAlerts(queue: InAppAlertQueue, incoming: AccountNotification[]): InAppAlertQueue {
  const ids = new Set(queue.cards.flatMap((card) => card.alerts.map((alert) => alert.id)));
  const cards = queue.cards.map((card) => ({ ...card, alerts: [...card.alerts] }));
  for (const alert of incoming) {
    if (ids.has(alert.id)) continue;
    ids.add(alert.id);
    const kind = inAppAlertKind(alert.type);
    const card = cards.find((existing) => existing.kind === kind);
    if (card) card.alerts.push(alert);
    else cards.push({ kind, alerts: [alert] });
  }
  let overflow = queue.overflow;
  while (cards.length > IN_APP_ALERT_QUEUE_LIMIT) {
    // The first card is on screen; drop the oldest one waiting behind it.
    overflow += cards.splice(1, 1)[0].alerts.length;
  }
  return { cards, overflow };
}

/** Moves on to the next card. Once nothing is left to show, the count resets. */
export function nextAlertCard(queue: InAppAlertQueue): InAppAlertQueue {
  const cards = queue.cards.slice(1);
  return cards.length ? { cards, overflow: queue.overflow } : EMPTY_ALERT_QUEUE;
}

/** How many alerts are waiting behind the card on screen. */
export function alertsWaiting(queue: InAppAlertQueue) {
  return queue.cards.slice(1).reduce((total, card) => total + card.alerts.length, 0) + queue.overflow;
}

/** "+3 more", or "+12 more in Alerts" once some won't get their own popup. */
export function waitingLabel(queue: InAppAlertQueue) {
  const waiting = alertsWaiting(queue);
  if (!waiting) return null;
  return queue.overflow ? `+${waiting} more in Alerts` : `+${waiting} more`;
}

const GROUP_TITLES: Record<InAppAlertKind, (count: number) => string> = {
  mention: (count) => `You were mentioned ${count} times`,
  // Not "people": one person joining two circles is two joins.
  joined: (count) => `${count} new joins`,
  sage: (count) => `${count} updates from Sage`,
  message: (count) => `${count} new messages`,
  other: (count) => `${count} new alerts`,
};

/** What a card says. A single alert reads as itself; a group, as a summary of the newest. */
export function alertCardText(card: InAppAlertCard): { title: string; body: string } {
  const latest = card.alerts[card.alerts.length - 1];
  if (card.alerts.length === 1) return { title: latest.title, body: latest.body };
  return {
    title: GROUP_TITLES[card.kind](card.alerts.length),
    body: `Latest: ${latest.body || latest.title}`,
  };
}
