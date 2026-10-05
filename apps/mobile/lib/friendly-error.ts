/**
 * Turns anything a screen catches into a sentence a member can act on.
 *
 * API calls in lib/api.ts throw `ApiError`s that carry the server's tRPC
 * error code and HTTP status. Servers often write good messages on purpose
 * ("Store not found or not accepting quick payments"), so those are shown
 * as-is. Raw validation dumps, database errors, stack traces, bare HTTP
 * statuses, and network failures are replaced with plain wording instead.
 * A raw validation dump means the app sent something the server rejected,
 * which the member can't fix by retyping, so it gets the screen's fallback
 * too (forms check what people typed before sending).
 *
 * Usage: `setError(friendlyError(err, "We couldn't load your orders."))`.
 * The fallback should say what didn't work; this helper adds the next step.
 */

export class ApiError extends Error {
  /** tRPC error code, e.g. "BAD_REQUEST", "UNAUTHORIZED". */
  code?: string;
  httpStatus?: number;

  constructor(message: string, options: { code?: string; httpStatus?: number } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = options.code;
    this.httpStatus = options.httpStatus;
  }
}

type TrpcErrorBody = {
  message?: string;
  data?: { code?: string; httpStatus?: number; message?: string };
  json?: { message?: string; data?: { code?: string; httpStatus?: number } };
};

/** Builds the error lib/api.ts throws when a tRPC response has `error`. */
export function apiError(error: TrpcErrorBody | undefined | null, fallback: string): ApiError {
  const message = error?.json?.message || error?.message || error?.data?.message || fallback;
  const data = error?.data ?? error?.json?.data;
  return new ApiError(message, { code: data?.code, httpStatus: data?.httpStatus });
}

/** Builds the error lib/api.ts throws for a non-OK response with no tRPC body. */
export function httpError(status: number): ApiError {
  return new ApiError(`HTTP error! status: ${status}`, { httpStatus: status });
}

export const CONNECTION_MESSAGE =
  "We couldn't reach Cahootz. Check your internet connection and try again.";
export const SIGN_IN_AGAIN_MESSAGE = 'Your session expired. Sign in again to continue.';
export const TOO_MANY_TRIES_MESSAGE = 'Too many tries in a row. Wait a minute, then try again.';

const DEFAULT_FALLBACK = 'Something went wrong.';
const TRY_AGAIN = 'Please try again.';
const MAX_SHOWN_LENGTH = 180;

const NETWORK_PATTERN =
  /network request failed|failed to fetch|load failed|networkerror|network error|internet connection|timed? ?out|aborted/i;

// Text that only makes sense to a developer. If a server or client message
// contains any of these, the member sees the screen's fallback instead.
const TECHNICAL_PATTERN = new RegExp(
  [
    'prisma',
    'invalid `',
    '\\bat \\S+ \\(',
    'econn',
    'cannot read propert',
    '\\bundefined\\b',
    '\\bnull\\b',
    'is not a function',
    'unexpected token',
    '\\bjson\\b',
    'http error',
    'status:? \\d{3}',
    '\\btrpc\\b',
    'stack',
    '0x[0-9a-f]{8,}',
    'not configured',
    '\\bsql\\b',
    'constraint',
    'unique',
    'foreign key',
    'internal server error',
    'typeerror',
    'referenceerror',
    'syntaxerror',
    '\\bnan\\b',
    'expected (string|number|boolean|object|array)',
    'received (string|number|boolean|object|array|undefined)',
    'zod',
  ].join('|'),
  'i',
);

function endSentence(text: string) {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function withNextStep(fallback: string) {
  const sentence = endSentence(fallback);
  return /try again|contact|sign in|check/i.test(sentence) ? sentence : `${sentence} ${TRY_AGAIN}`;
}

function looksLikeValidationDump(message: string) {
  const trimmed = message.trim();
  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

function messageOf(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'message' in err) {
    const message = (err as { message?: unknown }).message;
    return typeof message === 'string' ? message : '';
  }
  return '';
}

/** True when the message is safe and readable enough to show a member as-is. */
export function isReadableMessage(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > MAX_SHOWN_LENGTH) return false;
  if (trimmed.includes('\n')) return false;
  if (looksLikeValidationDump(trimmed)) return false;
  return !TECHNICAL_PATTERN.test(trimmed);
}

export function friendlyError(err: unknown, fallback: string = DEFAULT_FALLBACK): string {
  const message = messageOf(err);
  const code = err instanceof ApiError ? err.code : undefined;
  const status = err instanceof ApiError ? err.httpStatus : undefined;

  if (NETWORK_PATTERN.test(message) && !(err instanceof ApiError)) {
    return CONNECTION_MESSAGE;
  }

  if (code === 'TOO_MANY_REQUESTS' || status === 429) {
    return TOO_MANY_TRIES_MESSAGE;
  }

  if (/session expired/i.test(message)) {
    return SIGN_IN_AGAIN_MESSAGE;
  }

  if (isReadableMessage(message)) {
    return endSentence(message);
  }

  return withNextStep(fallback);
}
