/**
 * Shared helpers for new-member messages: email deliverability, the member
 * app link, and short quotes. The day 1/3/7 notification drip that used to
 * live here was replaced by Sage's activation journey (`sage-activation.ts`).
 *
 * Copy is tenant-generic: it names the member's own commons (from its
 * CoopConfig) and never a specific coin or co-op.
 */

/** Alerts the retired drip created; kept so old rows still open the right screen. */
export const ONBOARDING_DRIP_NOTIFICATION_TYPE = "ONBOARDING_DRIP";

/**
 * Non-routable addresses (Sage bots, seeded test fixtures) never get the
 * email fallback.
 */
export function isDeliverableEmail(email: string | null | undefined): email is string {
  if (!email || !email.includes("@")) return false;
  const domain = email.split("@").pop()!.toLowerCase();
  return !domain.endsWith(".internal") && !domain.endsWith(".local");
}

/** Platform name for "open the app" wording; each commons still names itself. */
export const MEMBER_APP_NAME = "Cahootz";
export const DRIP_EMAIL_CTA_LABEL = "Open the app";
/**
 * The Cahootz Commons App Store listing. The id is the app's App Store
 * Connect id, `ascAppId` in apps/mobile/eas.json; update both together.
 */
export const DEFAULT_MEMBER_APP_LINK_URL = "https://apps.apple.com/us/app/cahootz-commons/id6772781102";

/**
 * Where the drip email's "Open the app" button goes. The member app is
 * iOS-only (no web build), so emails can't deep-link to a post, event or
 * circle: they describe it in the text and link here instead. Defaults to
 * the App Store listing; `MEMBER_APP_LINK_URL` overrides it (e.g. a
 * different listing for another deployment). This is deliberately not
 * `APP_URL`, which other code uses as a backend/web URL.
 */
export function memberAppLinkUrl(): string {
  return process.env.MEMBER_APP_LINK_URL?.trim() || DEFAULT_MEMBER_APP_LINK_URL;
}

const SNIPPET_LENGTH = 70;

/** Strips stored `[@handle]` mention markup and trims to a short quote. */
export function snippet(text: string, length = SNIPPET_LENGTH): string {
  const plain = text
    .replace(/\[@([^\]]+)\]/g, "@$1")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > length ? `${plain.slice(0, length - 1).trimEnd()}…` : plain;
}

export function firstName(name: string | null | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first || null;
}

/** "tomorrow at 6:00 PM" / "on Sat, Oct 3 at 6:00 PM" (UTC; see open question on member time zones). */
export function eventStartsLabel(startAt: Date, now: Date): string {
  const time = startAt.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
  const dayKey = (value: Date) => value.toISOString().slice(0, 10);
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  if (dayKey(startAt) === dayKey(now)) return `today at ${time}`;
  if (dayKey(startAt) === dayKey(tomorrow)) return `tomorrow at ${time}`;
  const date = startAt.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return `on ${date} at ${time}`;
}
