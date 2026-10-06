import type { AccountNotification } from "@repo/validators/notification";

/** How often the open app checks for alerts that didn't arrive by push. */
export const IN_APP_ALERT_POLL_MS = 15_000;
/** How long a popup stays up before it slides away on its own. */
export const IN_APP_ALERT_VISIBLE_MS = 7_000;
/** Popups waiting their turn; older ones are dropped (they're all in Alerts). */
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
  data: Record<string, unknown> | null | undefined;
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

/** Adds new alerts behind the one on screen (the queue's first entry). */
export function enqueueAlerts(queue: AccountNotification[], incoming: AccountNotification[]) {
  const ids = new Set(queue.map((alert) => alert.id));
  const next = [...queue, ...incoming.filter((alert) => !ids.has(alert.id))];
  if (next.length <= IN_APP_ALERT_QUEUE_LIMIT) return next;
  // The first entry is on screen; keep it and the newest arrivals.
  return [next[0], ...next.slice(-(IN_APP_ALERT_QUEUE_LIMIT - 1))];
}
