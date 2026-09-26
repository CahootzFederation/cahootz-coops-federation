# Mobile product analytics

The mobile app (native and web) sends product analytics to PostHog through `apps/mobile/lib/analytics.ts`. We use it to measure first-time engagement: do new people finish onboarding, join a welcome lounge, allow notifications, and come back?

## Configuration

| Variable | Required | Notes |
| --- | --- | --- |
| `EXPO_PUBLIC_POSTHOG_KEY` | No | PostHog project API key (`phc_...`). The same project as web's `NEXT_PUBLIC_POSTHOG_KEY`. When it's unset, analytics does nothing at all. |
| `EXPO_PUBLIC_POSTHOG_HOST` | No | Ingestion host. Defaults to `https://stuff.cahootzcoops.com`, the same proxy web uses (`api_host` in `apps/web/components/posthog-provider.tsx`). Set it to `https://us.i.posthog.com` to skip the proxy. |

Expo inlines `EXPO_PUBLIC_*` values when it builds the bundle, so set them in the EAS build or update environment (and in `.env` for a local production-like build). A running dev server needs a restart to pick up a change.

Leave the key unset in local development, CI and the Playwright suite. With no key the SDK isn't even loaded, nothing is written to storage, and no request is made.

`posthog-react-native` brings in the native modules `expo-application`, `expo-device`, `expo-file-system` and `expo-localization`. The first release with analytics has to be a new native build. Don't ship it as an OTA update to an older binary.

## Privacy rules

- People are identified by their internal user id (`identify(user.id)`) only. We never send email, phone, wallet address, names, handles, or post, comment or message content.
- Every event and person gets `coop_id`, the id of the person's commons.
- `sanitizeProperties` is a backstop. It drops any property whose key looks like PII (`email`, `phone`, `wallet`, `address`, `name`, `handle`, `message`, `body`, `text`, `title`, `token`, ...), any string value that looks like an email, phone number or wallet address, and any value that isn't a primitive. In development it logs a warning when it drops something.
- Screens are recorded by route pattern (`/people/[handle]`), not by URL, so ids and handles never appear in screen names.
- Session replay, surveys, touch autocapture, SDK lifecycle events and GeoIP enrichment are all off. Person profiles are only created for signed-in people (`personProfiles: 'identified_only'`).
- There's no analytics consent or opt-out setting in the app yet (see Decisions).

## Events

| Event | Where | Properties |
| --- | --- | --- |
| `app_opened` | `components/analytics-tracker.tsx`: on launch, after the saved session loads, and when the app returns from the background | `source` (`cold_start` / `foreground`), `is_first_open`, `signed_in`, `days_since_signup` (signed in only) |
| `$screen` | same component, on every route change | route pattern |
| `onboarding_step_viewed` | `app/profile-onboarding.tsx` | `step` (`intro` / `profile` / `circles`), `signed_in` |
| `onboarding_deferred` | "Skip" on the profile form, "Skip for now" on the circles step | `step`, `signed_in` |
| `onboarding_completed` | the wizard finished, however the person left it | `exit` (`welcome_lounge` / `explore` / `skip`), `profile_completed`, `signed_in` |
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

## Open questions

- **App Store and Play privacy labels** need an update to list product analytics tied to a user id.
