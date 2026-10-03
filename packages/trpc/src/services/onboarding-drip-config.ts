/**
 * Every threshold and every line of copy for the new-member re-engagement
 * drip lives here, so product changes don't require touching the selection
 * or delivery logic in `onboarding-drip.ts`.
 *
 * Copy is tenant-generic: it names the member's own commons (from its
 * CoopConfig) and never a specific coin or co-op.
 */

export const ONBOARDING_DRIP_NOTIFICATION_TYPE = "ONBOARDING_DRIP";

export type DripStepDay = 1 | 3 | 7;

export interface DripStepConfig {
  day: DripStepDay;
  /** Hours after the member joined when this step becomes due. */
  dueAfterHours: number;
  /**
   * How long after it's due the step may still go out. A step that missed
   * its window (e.g. the task was down, or the drip shipped after the member
   * joined) is dropped rather than sent late and out of order.
   */
  windowHours: number;
  /**
   * Any activity at or after `joinedAt + quietSinceHours` suppresses the
   * step: the member came back on their own, so they don't need a nudge.
   * Day 1 uses a short grace period after signup so the signup session
   * itself doesn't count; later steps use the previous step's due time.
   */
  quietSinceHours: number;
}

export const DRIP_STEPS: readonly DripStepConfig[] = [
  { day: 1, dueAfterHours: 24, windowHours: 24, quietSinceHours: 2 },
  { day: 3, dueAfterHours: 72, windowHours: 24, quietSinceHours: 24 },
  { day: 7, dueAfterHours: 168, windowHours: 24, quietSinceHours: 72 },
];

/** Only memberships that started this recently are considered at all. */
export const DRIP_LOOKBACK_HOURS = Math.max(
  ...DRIP_STEPS.map((step) => step.dueAfterHours + step.windowHours),
);

/** Day 1 counts posts in the member's circles from this far back. */
export const DAY1_POST_LOOKBACK_HOURS = 24;
/** Day 3 suggests events starting within this many days. */
export const DAY3_EVENT_HORIZON_DAYS = 14;
/** A public circle needs at least this many members to be suggested. */
export const MIN_POPULAR_CIRCLE_MEMBERS = 2;
/** Memberships processed per sweep (the task runs hourly). */
export const DRIP_BATCH_SIZE = 500;

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

export interface DripMessage {
  title: string;
  body: string;
  /**
   * Email fallback. Emails can't deep-link into the app, so the body names
   * the post, event or circle and says where to find it.
   */
  emailSubject: string;
  emailBody: string;
}

const inTheApp = (what: string) => `Open the ${MEMBER_APP_NAME} app to find ${what}.`;

export const dripCopy = {
  day1(input: {
    newPostCount: number;
    circleName: string;
    circleCount: number;
    postTitle: string;
    authorName: string;
  }): DripMessage {
    const where = input.circleCount === 1 ? input.circleName : "your circles";
    const posts = `${input.newPostCount} new post${input.newPostCount === 1 ? "" : "s"}`;
    const body = `${posts} since yesterday. Start with ${input.authorName}'s “${snippet(input.postTitle)}”.`;
    return {
      title: `Today in ${where}`,
      body,
      emailSubject: `${posts} in ${where}`,
      emailBody: `${body} ${inTheApp(`it in ${where}`)}`,
    };
  },

  day3Event(input: {
    eventTitle: string;
    startsLabel: string;
    goingCount: number;
    where: string;
  }): DripMessage {
    const going =
      input.goingCount > 0
        ? ` ${input.goingCount} ${input.goingCount === 1 ? "person is" : "people are"} going.`
        : "";
    return {
      title: `Coming up in ${input.where}`,
      body: `“${snippet(input.eventTitle)}” is ${input.startsLabel}.${going} Take a look and RSVP.`,
      emailSubject: `Coming up: ${snippet(input.eventTitle, 60)}`,
      emailBody: `“${snippet(input.eventTitle)}” is ${input.startsLabel} in ${input.where}.${going} ${inTheApp("it")} Then RSVP.`,
    };
  },

  day3Circle(input: {
    circleName: string;
    memberCount: number;
    purpose: string | null;
  }): DripMessage {
    const about = input.purpose ? ` ${snippet(input.purpose, 80)}` : "";
    const body = `${input.memberCount} member${input.memberCount === 1 ? "" : "s"} already talk there.${about}`;
    return {
      title: `A circle you might like: ${input.circleName}`,
      body,
      emailSubject: `A circle you might like: ${input.circleName}`,
      emailBody: `${body} ${inTheApp(`${input.circleName} and join`)}`,
    };
  },

  day7(input: {
    memberFirstName: string | null;
    /**
     * The member's welcome lounge guide, named as someone to reach out to,
     * or null. The note is always signed by the commons: the guide didn't
     * write it, so it must never read as if they did.
     */
    guideName: string | null;
    commonsName: string;
    targetName: string;
  }): DripMessage {
    const hello = input.memberFirstName ? `Hi ${input.memberFirstName}` : "Hi there";
    const nudge = input.guideName
      ? `Your welcome lounge guide, ${input.guideName}, is around if you have questions. Stop by ${input.targetName} and say hi.`
      : `${input.targetName} is a good place to say hi, and members there are happy to help if you have questions.`;
    const body = `${hello}, it's been a week since you joined ${input.commonsName}. ${nudge}`;
    return {
      title: `A note from ${input.commonsName}`,
      body,
      emailSubject: `A note from ${input.commonsName}`,
      emailBody: `${body} ${inTheApp(input.targetName)}`,
    };
  },
};

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
