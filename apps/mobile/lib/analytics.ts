/**
 * Product analytics (PostHog) for the mobile app, on native and web.
 *
 * - Completely inert unless EXPO_PUBLIC_POSTHOG_KEY is set: the SDK is never
 *   loaded, nothing is stored, and no request leaves the device. Dev, CI and
 *   E2E runs leave the key unset.
 * - Identifies people by their internal user id only. Never pass email,
 *   phone, wallet address, names, handles, or message/post content. As a
 *   backstop, `sanitizeProperties` drops keys and values that look like PII.
 * - Event names and their properties are a typed map. To add an event, add
 *   an entry to `AnalyticsEvents` and call `track('your_event', {...})`.
 *
 * Retention ("came back within 24h / 7d") is intentionally not computed on
 * the device. Build it in PostHog as a retention insight on `app_opened`;
 * see docs/mobile-analytics.md.
 */
import type { PostHog } from 'posthog-react-native';

export type OnboardingStep = 'intro' | 'profile' | 'circles';

export type AnalyticsEvents = {
  app_opened: {
    /** 'cold_start' when the JS app boots, 'foreground' when it returns from the background. */
    source: 'cold_start' | 'foreground';
    /** First time analytics has seen this install. */
    is_first_open: boolean;
    signed_in: boolean;
    /** Whole days since the account was created. Only set when signed in. */
    days_since_signup?: number;
  };
  onboarding_step_viewed: { step: OnboardingStep; signed_in: boolean };
  /** The person skipped a step ("Skip" on the profile form, "Skip for now" on circles). */
  onboarding_deferred: { step: OnboardingStep; signed_in: boolean };
  /** The wizard was finished. `profile_completed` is false if the profile form was skipped. */
  onboarding_completed: {
    exit: 'welcome_lounge' | 'explore' | 'skip';
    profile_completed: boolean;
    signed_in: boolean;
  };
  welcome_lounge_joined: {
    source: 'onboarding' | 'circle_view';
    /** True when the join was queued while signed out and completed after signup. */
    auto_joined?: boolean;
  };
  /** The OS push-permission dialog is about to be shown. */
  push_permission_prompted: { source: PushPromptSource };
  /** The answer to that dialog. Only sent when the dialog was actually shown. */
  push_permission_result: {
    source: PushPromptSource;
    granted: boolean;
    status: 'granted' | 'provisional' | 'denied' | 'undetermined';
  };
  notification_opened: {
    channel: 'push' | 'in_app';
    /** Notification type enum, e.g. POST_COMMENT. 'unknown' for older pushes without it. */
    notification_type: string;
  };
  proposal_navigation_opened: {
    source: 'drawer' | 'proposal_hub' | 'notification';
    destination: 'hub' | 'drafts' | 'detail';
    actionable_vote_count?: number;
    draft_count?: number;
  };
  commons_tools_drawer_viewed: { signed_in: boolean };
  proposal_hub_viewed: { signed_in: boolean };
  signed_in: Record<string, never>;
  signed_out: { reason: 'user' | 'session_expired' };
};

export type AnalyticsEvent = keyof AnalyticsEvents;

/** Where a push-permission prompt came from. Extend when adding new entry points (e.g. a primer). */
export type PushPromptSource =
  | 'after_onboarding'
  | 'notification_settings'
  | 'welcome_intro_primer'
  | (string & {});

type Properties = Record<string, string | number | boolean | null>;

// Key names that are PII in this app, matched per snake/camel-case word.
const PII_KEY_PATTERN =
  /(^|_)(e_?mail|phone|wallet|address|name|first_?name|last_?name|full_?name|handle|username|message|content|body|text|title|bio|token|password|secret|ip)(_|$)/i;
const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const WALLET_PATTERN = /0x[a-fA-F0-9]{40}/;
// A run of phone-number characters holding at least 10 digits (ISO dates have 8).
const PHONE_RUN_PATTERN = /\+?\(?\d[\d\s().-]{8,}\d/g;
const MAX_STRING_LENGTH = 200;

function looksLikePhone(value: string) {
  return (value.match(PHONE_RUN_PATTERN) ?? []).some((run) => (run.match(/\d/g)?.length ?? 0) >= 10);
}

function toSnakeCase(key: string) {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function isPiiKey(key: string) {
  return PII_KEY_PATTERN.test(toSnakeCase(key));
}

function isPiiValue(value: string) {
  return EMAIL_PATTERN.test(value) || WALLET_PATTERN.test(value) || looksLikePhone(value);
}

/**
 * Drops properties whose key or value looks like PII, drops non-primitive
 * values (so objects like a user record can't be passed through), and trims
 * long strings. Exported for tests.
 */
export function sanitizeProperties(properties: Record<string, unknown> | undefined): Properties {
  const safe: Properties = {};
  if (!properties) return safe;

  for (const [key, value] of Object.entries(properties)) {
    if (value === undefined) continue;
    if (isPiiKey(key)) {
      warnDropped(key);
      continue;
    }
    if (typeof value === 'string') {
      if (isPiiValue(value)) {
        warnDropped(key);
        continue;
      }
      safe[key] = value.slice(0, MAX_STRING_LENGTH);
    } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      safe[key] = value;
    } else {
      warnDropped(key);
    }
  }
  return safe;
}

function warnDropped(key: string) {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.warn(`[analytics] Dropped property "${key}": it looks like personal data or isn't a primitive.`);
  }
}

/**
 * Converts expo-router segments into a route pattern with no ids or handles
 * in it, e.g. ['(tabs)', 'people', '[handle]'] -> '/people/[handle]'.
 */
export function routeNameFromSegments(segments: readonly string[]): string {
  const visible = segments.filter((segment) => !(segment.startsWith('(') && segment.endsWith(')')));
  return `/${visible.join('/')}`;
}

// --- Client state -----------------------------------------------------------

// Same PostHog managed reverse proxy as apps/web (posthog-provider.tsx api_host).
const DEFAULT_HOST = 'https://stuff.cahootzcoops.com';
const FIRST_OPEN_KEY = 'cahootz.analytics.firstOpenedAt';

let client: PostHog | null = null;
let initialized = false;
let identifiedUserId: string | null = null;
let lastScreen: string | null = null;

export type AnalyticsConfig = { apiKey?: string; host?: string };

// Must be static `process.env.EXPO_PUBLIC_*` reads: Expo inlines them at build time.
function configFromEnv(): AnalyticsConfig {
  return {
    apiKey: process.env.EXPO_PUBLIC_POSTHOG_KEY,
    host: process.env.EXPO_PUBLIC_POSTHOG_HOST,
  };
}

/** True once initAnalytics() has started a client (i.e. a key was configured). */
export function isAnalyticsEnabled(): boolean {
  return client !== null;
}

/**
 * Idempotent. Does nothing when no key is configured. `config` defaults to
 * the EXPO_PUBLIC_POSTHOG_* env vars and is only overridden in tests.
 */
export function initAnalytics(config: AnalyticsConfig = configFromEnv()): void {
  if (initialized) return;
  initialized = true;

  const apiKey = config.apiKey?.trim();
  if (!apiKey) return;

  try {
    // Loaded lazily so the SDK (and its optional native modules) are never
    // touched when analytics is off.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PostHog: PostHogClient } = require('posthog-react-native') as typeof import('posthog-react-native');
    client = new PostHogClient(apiKey, {
      host: config.host?.trim() || DEFAULT_HOST,
      // We send our own app_opened; the SDK's lifecycle events would duplicate it.
      captureAppLifecycleEvents: false,
      // No person profiles for signed-out visitors.
      personProfiles: 'identified_only',
      // Don't enrich events with a location derived from the IP address.
      disableGeoip: true,
      disableSurveys: true,
      enableSessionReplay: false,
    });
  } catch (error) {
    client = null;
    console.warn('[analytics] PostHog failed to start; analytics disabled.', error);
  }
}

export function track<E extends AnalyticsEvent>(
  event: E,
  ...args: AnalyticsEvents[E] extends Record<string, never> ? [properties?: AnalyticsEvents[E]] : [properties: AnalyticsEvents[E]]
): void {
  if (!client) return;
  try {
    client.capture(event, sanitizeProperties(args[0] as Record<string, unknown> | undefined));
  } catch (error) {
    console.warn('[analytics] capture failed', error);
  }
}

/**
 * Links this device to an account by internal user id, and records the
 * person's commons as `coop_id` on the person and on every later event.
 * Repeat calls with the same id are ignored.
 */
export function identify(userId: string, options: { coopId?: string | null } = {}): void {
  if (!client || !userId) return;
  const coopId = options.coopId || null;
  try {
    if (identifiedUserId !== userId) {
      client.identify(userId, sanitizeProperties({ coop_id: coopId }));
      identifiedUserId = userId;
    }
    void client.register(sanitizeProperties({ coop_id: coopId }));
  } catch (error) {
    console.warn('[analytics] identify failed', error);
  }
}

/** Call on sign-out: forgets the identified user and starts a new anonymous id. */
export function reset(): void {
  identifiedUserId = null;
  if (!client) return;
  try {
    client.reset();
  } catch (error) {
    console.warn('[analytics] reset failed', error);
  }
}

/** Records a screen view. Pass a route pattern (see routeNameFromSegments), never a concrete URL. */
export function screen(routeName: string): void {
  if (!client || routeName === lastScreen) return;
  lastScreen = routeName;
  try {
    void client.screen(routeName);
  } catch (error) {
    console.warn('[analytics] screen failed', error);
  }
}

/**
 * True the first time this is called on an install with analytics enabled.
 * Stored outside secureStorage.keys so sign-out doesn't clear it.
 */
export async function consumeFirstOpen(): Promise<boolean> {
  if (!client) return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const AsyncStorage = require('@react-native-async-storage/async-storage')
      .default as typeof import('@react-native-async-storage/async-storage').default;
    const existing = await AsyncStorage.getItem(FIRST_OPEN_KEY);
    if (existing) return false;
    await AsyncStorage.setItem(FIRST_OPEN_KEY, new Date().toISOString());
    return true;
  } catch {
    return false;
  }
}

export function daysSince(date: Date | string | null | undefined, now = Date.now()): number | undefined {
  if (!date) return undefined;
  const time = new Date(date).getTime();
  if (Number.isNaN(time)) return undefined;
  return Math.max(0, Math.floor((now - time) / 86_400_000));
}

/** Test-only: forget the client so each test starts from a clean module state. */
export function __resetAnalyticsForTests(): void {
  client = null;
  initialized = false;
  identifiedUserId = null;
  lastScreen = null;
}
