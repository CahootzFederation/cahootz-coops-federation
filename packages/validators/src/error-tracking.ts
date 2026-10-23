/**
 * Privacy scrubbing for PostHog error tracking, shared by the mobile app and
 * the API (tRPC procedures and Trigger.dev tasks).
 *
 * Exception messages can carry whatever the code that threw put in them:
 * request input, Prisma query arguments, upstream API responses. Before an
 * `$exception` event leaves the device or server, `scrubExceptionEvent`
 * redacts anything that looks like a password, code, token, wallet key,
 * email, phone number or message body, drops local variables captured on
 * stack frames, and drops custom properties whose names look personal.
 *
 * Errors are tied to a person only through the event's distinct id (the
 * internal user id the analytics already uses). Nothing here adds more.
 */

export const REDACTED = "[redacted]";

const MAX_MESSAGE_LENGTH = 1000;

// Keys whose values must never be sent. Matched against snake_case words.
const SENSITIVE_KEY_WORDS = [
  "password",
  "passcode",
  "pass",
  "pin",
  "code",
  "otp",
  "token",
  "secret",
  "key",
  "private_key",
  "mnemonic",
  "seed",
  "signature",
  "authorization",
  "auth",
  "cookie",
  "session",
  "email",
  "phone",
  "body",
  "text",
  "content",
  "message",
  "messages",
  "dm",
  "note",
  "bio",
  "prompt",
  "reply",
  "caption",
  "comment",
  "address",
  "wallet",
];
const SENSITIVE_KEY_PATTERN = new RegExp(`(^|_)(${SENSITIVE_KEY_WORDS.join("|")})(_|$)`, "i");

function toSnakeCase(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
}

const ERROR_CODE_KEYS = new Set(["code", "error_code", "status_code", "http_code", "trpc_code"]);

/** True when a property or field name looks like it holds a secret or personal content. */
export function isSensitiveKey(key: string): boolean {
  const snake = toSnakeCase(key);
  // A bare `code` is almost always an error code (P2002, ECONNRESET, NOT_FOUND).
  // `login_code`, `verification_code` and friends are still sensitive.
  if (ERROR_CODE_KEYS.has(snake)) return false;
  return SENSITIVE_KEY_PATTERN.test(snake);
}

// `key: "value"`, `key: 'value'`, `"key":"value"`, `key=value` and `key: value`
// where `key` is one of the sensitive words (camelCase or snake_case).
const KEY_VALUE_PATTERN =
  /(["']?)([A-Za-z][A-Za-z0-9_-]*)\1(\s*[:=]\s*)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`|[^\s,;&)}\]]+)/g;

const VALUE_PATTERNS: Array<[RegExp, string]> = [
  // Bearer / Basic credentials in headers.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, `$1 ${REDACTED}`],
  // JWTs.
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?/g, REDACTED],
  // Known secret key prefixes (Stripe, Resend, OpenAI, PostHog personal, Trigger, GitHub, Slack).
  [/\b(?:sk|rk|pk|whsec|re|phx|tr|ghp|gho|xox[abpr])_[A-Za-z0-9_-]{8,}/g, REDACTED],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, REDACTED],
  // Private keys / 32-byte hex secrets (with or without 0x), before wallet addresses.
  [/\b(?:0x)?[a-fA-F0-9]{64}\b/g, REDACTED],
  // Wallet addresses.
  [/\b0x[a-fA-F0-9]{40}\b/g, REDACTED],
  // Email addresses.
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, REDACTED],
  // Long opaque ids that are usually tokens (session tokens, invite tokens, base64 blobs).
  [/\b[A-Za-z0-9_-]{40,}={0,2}/g, REDACTED],
];

// A run of phone-number characters holding at least 10 digits (ISO dates have 8).
const PHONE_RUN_PATTERN = /\+?\(?\d[\d\s().-]{8,}\d/g;
// One-time codes: "code 123456", "OTP: 1234", "PIN 0000".
const CODE_PATTERN = /\b(code|otp|pin|passcode|verification)(\s*(?:is|was|[:#=])?\s*)\d{4,8}\b/gi;

function redactPhoneRuns(value: string) {
  return value.replace(PHONE_RUN_PATTERN, (run) =>
    (run.match(/\d/g)?.length ?? 0) >= 10 ? REDACTED : run,
  );
}

/**
 * Prisma "Invalid `prisma.x.y()` invocation" errors print the call's
 * arguments, which can include tokens and message text. Keep the first line
 * (which call failed) and the last line (why), drop the argument dump.
 */
function trimPrismaInvocation(value: string) {
  if (!/Invalid `[^`]*` invocation/.test(value)) return value;
  const lines = value.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length <= 2) return value;
  const first = lines.find((line) => line.includes("invocation")) ?? lines[0];
  const last = lines[lines.length - 1];
  return `${first} … ${last}`;
}

/** Redacts secrets and personal data from free text such as an error message. */
export function scrubText(value: string): string {
  let text = trimPrismaInvocation(value);

  text = text.replace(
    KEY_VALUE_PATTERN,
    (match, quote: string, key: string, separator: string, value: string) => {
      if (!isSensitiveKey(key)) return match;
      // Keep the value's own quotes so JSON-ish text stays readable.
      const valueQuote = /^["'`]/.test(value) ? value[0] : "";
      return `${quote}${key}${quote}${separator}${valueQuote}${REDACTED}${valueQuote}`;
    },
  );
  text = text.replace(CODE_PATTERN, (_match, word: string, separator: string) => `${word}${separator}${REDACTED}`);
  for (const [pattern, replacement] of VALUE_PATTERNS) {
    text = text.replace(pattern, replacement);
  }
  text = redactPhoneRuns(text);

  return text.length > MAX_MESSAGE_LENGTH ? `${text.slice(0, MAX_MESSAGE_LENGTH)}…` : text;
}

type JsonLike = string | number | boolean | null | undefined | JsonLike[] | { [key: string]: JsonLike };

type ExceptionFrame = Record<string, unknown> & { vars?: unknown };
type ExceptionEntry = Record<string, unknown> & {
  value?: unknown;
  stacktrace?: { frames?: ExceptionFrame[] } & Record<string, unknown>;
};

function scrubFrames(entry: ExceptionEntry): ExceptionEntry {
  const frames = entry.stacktrace?.frames;
  if (!Array.isArray(frames)) return entry;
  return {
    ...entry,
    stacktrace: {
      ...entry.stacktrace,
      // Local variables can hold request input or message text. Never send them.
      frames: frames.map(({ vars: _vars, ...frame }) => frame),
    },
  };
}

/** Scrubs one entry of `$exception_list`: its message and any captured frame variables. */
export function scrubExceptionEntry<T>(entry: T): T {
  if (!entry || typeof entry !== "object") return entry;
  const scrubbed = scrubFrames({ ...(entry as ExceptionEntry) });
  if (typeof scrubbed.value === "string") scrubbed.value = scrubText(scrubbed.value);
  return scrubbed as T;
}

// PostHog's own `$` properties are SDK metadata (device, app version, lib).
// These are the `$` properties that can carry exception text.
const EXCEPTION_TEXT_PROPERTIES = ["$exception_message", "$exception_values"] as const;

function scrubValue(value: JsonLike): JsonLike {
  if (typeof value === "string") return scrubText(value);
  if (Array.isArray(value)) return value.map(scrubValue);
  return value;
}

/**
 * Scrubs the properties of an `$exception` event:
 * - `$exception_list` messages are redacted and frame variables dropped;
 * - `$exception_message` / `$exception_values` are redacted;
 * - `$exception_steps` (breadcrumbs) are dropped;
 * - custom (non-`$`) properties with personal-looking names are dropped, and
 *   string values that survive are redacted.
 */
export function scrubExceptionProperties<T extends Record<string, unknown>>(properties: T): T {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(properties)) {
    if (key === "$exception_steps") continue;

    if (key === "$exception_list") {
      result[key] = Array.isArray(value) ? value.map((entry) => scrubExceptionEntry(entry)) : value;
      continue;
    }

    if ((EXCEPTION_TEXT_PROPERTIES as readonly string[]).includes(key)) {
      result[key] = scrubValue(value as JsonLike);
      continue;
    }

    if (key.startsWith("$")) {
      result[key] = value;
      continue;
    }

    if (isSensitiveKey(key)) continue;
    result[key] = typeof value === "string" ? scrubText(value) : value;
  }

  return result as T;
}

type CaptureEventLike = { event: string; properties?: Record<string, unknown> } & Record<string, unknown>;

/**
 * A PostHog `before_send` hook. Scrubs `$exception` events and leaves every
 * other event untouched (product events have their own filter on mobile).
 */
export function scrubExceptionEvent<T extends CaptureEventLike | null>(event: T): T {
  if (!event || event.event !== "$exception" || !event.properties) return event;
  return { ...event, properties: scrubExceptionProperties(event.properties) };
}
