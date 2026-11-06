# Mobile product analytics and error tracking

The mobile app (native and web) sends product analytics to PostHog through `apps/mobile/lib/analytics.ts`. We use it to measure first-time engagement: do new people finish onboarding, join a welcome lounge, allow notifications, and come back?

The same client sends crashes to PostHog error tracking, and the API sends server errors there too. See [Error tracking](#error-tracking).

## Configuration

| Variable | Required | Notes |
| --- | --- | --- |
| `EXPO_PUBLIC_POSTHOG_KEY` | No | PostHog project API key (`phc_...`). The same project as web's `NEXT_PUBLIC_POSTHOG_KEY`. When it's unset, analytics does nothing at all. |
| `EXPO_PUBLIC_POSTHOG_HOST` | No | Ingestion host. Defaults to `https://stuff.cahootzcoops.com`, the same proxy web uses (`api_host` in `apps/web/components/posthog-provider.tsx`). Set it to `https://us.i.posthog.com` to skip the proxy. |

Expo inlines `EXPO_PUBLIC_*` values when it builds the bundle, so set them in the EAS build or update environment (and in `.env` for a local production-like build). A running dev server needs a restart to pick up a change.

Leave the key unset in local development, CI and the Playwright suite. With no key the SDK isn't even loaded, nothing is written to storage, and no request is made.

`posthog-react-native` brings in the native modules `expo-application`, `expo-device`, `expo-file-system` and `expo-localization`. The first release with analytics has to be a new native build. Don't ship it as an OTA update to an older binary.

## Privacy rules

- People are identified by their internal user id (`identify(user.id)`). Their signed-in email is attached only to the PostHog person profile so support can find the right person. Email is never attached to product events, and we never send phone, wallet address, names, handles, or post, comment, or message content.
- Every event and person gets `coop_id`, the id of the person's commons.
- `sanitizeProperties` is a backstop. It drops any property whose key looks like PII (`email`, `phone`, `wallet`, `address`, `name`, `handle`, `message`, `body`, `text`, `title`, `token`, ...), any string value that looks like an email, phone number or wallet address, and any value that isn't a primitive. In development it logs a warning when it drops something.
- Screens are recorded by route pattern (`/people/[handle]`), not by URL, so ids and handles never appear in screen names.
- Exception messages are scrubbed before they leave the device or server (see [Error tracking](#error-tracking)).
- Session replay, surveys, touch autocapture, SDK lifecycle events and GeoIP enrichment are all off. Person profiles are only created for signed-in people (`personProfiles: 'identified_only'`).
- There's no analytics consent or opt-out setting in the app yet (see Decisions).

## Events

| Event | Where | Properties |
| --- | --- | --- |
| `app_opened` | `components/analytics-tracker.tsx`: on launch, after the saved session loads, and when the app returns from the background | `source` (`cold_start` / `foreground`), `is_first_open`, `signed_in`, `days_since_signup` (signed in only) |
| `$screen` | same component, on every route change | route pattern |
| `onboarding_step_viewed` | `app/profile-onboarding.tsx` | `step` (`intro` / `profile` / `circles`), `signed_in` |
| `contact_invite_started` | Tapped the invite-from-contacts card | `source`, `picker` |
| `contact_invite_batch_started` | Started texting the contacts chosen in the invite checklist | `source`, `count` |
| `contact_invite_batch_finished` | Finished or stopped texting them | `source`, `sent`, `total` |
| `onboarding_deferred` | "Skip" on the profile form, "Skip for now" on the circles step | `step`, `signed_in` |
| `onboarding_completed` | the wizard finished, however the person left it | `exit` (`welcome_lounge` / `general` / `skip` / `invitation`), `profile_completed`, `signed_in` |
| `welcome_lounge_joined` | onboarding circles step, Circle View's "Join a welcome lounge" card | `source` (`onboarding` / `circle_view`), `auto_joined` |
| `push_permission_prompted` | `lib/push-notifications.ts`, right before the OS dialog | `source` (`after_onboarding` / `notification_settings` / ...) |
| `push_permission_result` | after the OS dialog. Only sent when the dialog was actually shown. | `source`, `granted`, `status` (`granted` / `provisional` / `denied` / `undetermined`) |
| `notification_opened` | tapping a push (`components/notification-response-handler.tsx`) or an alert in the inbox (`components/notification-screen.tsx`) | `channel` (`push` / `in_app`), `notification_type` |
| `signed_in` | `contexts/auth-context.tsx` `login()`, only when the account changes | none |
| `signed_out` | `contexts/auth-context.tsx` | `reason` (`user` / `session_expired`) |

Push payloads now include `notificationType` in their `data` (see `packages/trpc/src/services/push-notification-service.ts`). Pushes sent before this change report `unknown`.

`is_first_open` means the first open since analytics was enabled on this install. It's a device-local flag that isn't cleared by sign-out.

### Adding an event

1. Add the event and its property types to `AnalyticsEvents` in `apps/mobile/lib/analytics.ts`. Use `snake_case` names and primitive values.
2. Call `track('your_event', { ... })` from any file. TypeScript checks the properties.
3. Add a row to the table above.

To track a new push-permission entry point, such as a pre-permission primer, pass `source` to `registerForNativePushNotifications(..., { source: 'your_source' })`. The prompted and result events will carry it.

## Error tracking

Errors go to the same PostHog project as analytics, as `$exception` events. They show up under Error tracking.

### What gets captured

| Where | What | Code |
| --- | --- | --- |
| Mobile app | Uncaught JS errors (fatal and not) and unhandled promise rejections | `errorTracking.autocapture` in `apps/mobile/lib/analytics.ts` |
| Mobile app | Render errors caught by the root error boundary. It reports the error, then shows a "Something broke on our end" screen with a Try again button | `ErrorBoundary` in `apps/mobile/app/_layout.tsx`, which calls `captureError` |
| API | tRPC errors that map to HTTP 5xx (`INTERNAL_SERVER_ERROR`, `BAD_GATEWAY`, `SERVICE_UNAVAILABLE`, ...). Expected 4xx errors (`UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `BAD_REQUEST`, `CONFLICT`, `TOO_MANY_REQUESTS`, ...) are skipped | `onError` in `packages/trpc/src/server/index.ts` → `reportTrpcError` in `packages/trpc/src/lib/error-tracking.ts` |
| API | Errors that reach the Express error handler, uncaught exceptions and unhandled rejections | `apps/api/src/index.ts` |
| Trigger.dev | Runs that failed for good (after their last retry) | `tasks.onFailure` in `apps/api/src/trigger/init.ts` |

Console errors aren't captured. They're noisy, and some log request details. When tRPC wraps a thrown error, we report the original error so the stack trace points at the real fault.

Sentry keeps running alongside PostHog. The error boundary reports to both.

### Privacy

- Every `$exception` event goes through `scrubExceptionEvent` (`packages/validators/src/error-tracking.ts`) in `before_send`. The mobile app and the server share it. It:
  - redacts the values of sensitive keys in messages (`password`, `token`, `loginCode`, `privateKey`, `body`, `text`, `message`, `email`, `phone`, `wallet`, ...),
  - redacts one-time codes ("code 482913"), emails, phone numbers, wallet addresses, private keys, JWTs, bearer tokens, known secret-key prefixes and long opaque tokens,
  - cuts Prisma "Invalid `prisma.x.y()` invocation" messages down to the call and the reason, dropping the argument dump,
  - drops local variables captured on stack frames and `$exception_steps` breadcrumbs,
  - drops custom properties whose names look personal, and caps messages at 1,000 characters.
- The server never sends request input, bodies or headers. tRPC errors carry only `trpc_path`, `trpc_type` and `trpc_code`. Trigger.dev failures carry only the task id, run id, attempt number and environment, never the payload.
- Errors are tied to a person only by internal user id, the same distinct id `identify()` uses. On the server, the auth middlewares put the signed-in user's id on `ctx.errorTracking`. Errors without a signed-in user are sent without creating a person (`$process_person_profile: false`).

### Configuration

| Where | Variable | Notes |
| --- | --- | --- |
| Mobile | `EXPO_PUBLIC_POSTHOG_KEY` | Same key as analytics. No key, no capture. |
| API (Railway) and Trigger.dev | `POSTHOG_KEY` | The Cahootz project's API key (`phc_...`). No key, no capture. |
| API (Railway) and Trigger.dev | `POSTHOG_HOST` | Optional. Defaults to `https://us.i.posthog.com`. |

PostHog can turn exception autocapture off remotely. If the project's **Exception autocapture** setting is off, the mobile SDK stops autocapturing crashes, though the error boundary and the server still send errors. Make sure it's on in the project's Error tracking settings.

### Readable stack traces (not set up yet)

Mobile stack traces point into the minified Hermes bundle until source maps are uploaded to PostHog. Sentry already gets source maps through `@sentry/react-native/expo` and `SENTRY_AUTH_TOKEN`. Doing the same for PostHog needs secrets and a store build to verify, so it isn't wired in yet. The steps:

1. Create a PostHog personal API key with error tracking write access. Add `POSTHOG_CLI_API_KEY`, `POSTHOG_CLI_PROJECT_ID` (and `POSTHOG_CLI_HOST` if not US cloud) to the EAS `production` environment as secrets.
2. Add `"posthog-react-native/expo"` to `plugins` in `apps/mobile/app.json`. It adds the Hermes source map upload to the iOS and Android build steps.
3. Make Metro inject chunk ids with `getPostHogExpoConfig` from `posthog-react-native/metro`. `metro.config.js` already uses `getSentryExpoConfig`, and both replace Metro's serializer, so check that Sentry still gets its debug ids before shipping. If they clash, keep Sentry's and upload to PostHog with `posthog-cli hermes upload` after the build instead.
4. Ship a new native build, trigger a test error, and check that the frames are readable in PostHog.

Native (Swift/Kotlin) crash capture needs `@posthog/react-native-plugin` and dSYM uploads. It isn't installed. Sentry covers native crashes today.

The API's stack traces are already readable: `tsup` builds with source maps, and Trigger.dev bundles from source.

## Suggested insights

**First-time engagement funnel** (Funnel insight, conversion window 7 days, aggregated by unique users):

1. `app_opened` where `is_first_open = true`
2. `onboarding_completed`
3. `welcome_lounge_joined`
4. `push_permission_result` where `granted = true`

Break it down by `coop_id` to compare commons, or by `$os_name` to compare iOS, Android and web. Step 1 happens before sign-in for most new people, but `identify()` on sign-in links those anonymous events to the account, so the funnel still counts one person.

**Return within 24 hours and 7 days** (Retention insight). Build this in PostHog instead of computing it on the device:

- Cohortizing event: `onboarding_completed` (or `signed_in`) as the first-time event.
- Returning event: `app_opened`.
- Period: Day, for 7 periods. Day 1 is "came back the next day" and the Day 7 cell is the 7-day return rate. For "within 7 days" as one number, use a Week period and read Week 1.
- Break down by `coop_id`, or filter to `welcome_lounge_joined` people via a cohort, to see whether joining a lounge improves retention.

## Decisions

- **Host.** Mobile uses the same proxy as web. `stuff.cahootzcoops.com` is a PostHog managed reverse proxy (a CNAME to `proxyhog.com`), not the Next.js `/ingest` rewrite in `apps/web/next.config.js`, which the web client doesn't use. It serves PostHog's API at the root path, so there's no path prefix. Its CORS preflight echoes back the requesting origin with POST allowed (checked 2026-09-26 for `https://app.cahootz.coop` and `http://localhost:8081`), so mobile web works too. Native apps aren't subject to CORS.
- **Consent.** None for now. A consent setting will be added later, via PostHog's `optOut()` / `optIn()` through a new wrapper function.
- **IP addresses.** Sending the request IP is fine. `disableGeoip` still turns off location enrichment.
- **Sentry** stays on `sendDefaultPii: true` (`apps/mobile/app/_layout.tsx`).
- **Error tracking** has no on/off switch beyond the key. It's on wherever analytics is on.

## Open questions

- **App Store and Play privacy labels** need an update to list product analytics tied to a user id and email address.
