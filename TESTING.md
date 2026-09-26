# Pre-release end-to-end UI testing plan

## What “end to end” means here

An end-to-end test starts from the screen a user sees and operates the app through clicks, typing, navigation, and reloads. It uses the running mobile web app, API, and the same development or staging database. Multi-user tests open separate browser contexts so each user has independent cookies and local storage.

API and unit tests are useful supporting checks, but they do not replace these UI journeys.

## Test environments and accounts

- Use the existing local database during development and a staging database before release.
- Keep two ordinary members in the same commons: User A and User B.
- Add separate fixtures for a commons admin, store owner, applicant, and non-member when those journeys are automated.
- Prefix generated content with `E2E` and a unique run ID.
- Never point destructive or payment tests at production.
- Use Stripe test mode and test payment methods for payment journeys.

The local two-user fixtures are:

- `releaseclick1@test.cahootz.local`
- `releaseclick2@test.cahootz.local`
- Login code in nonproduction: `000000`

Seed or refresh them with:

```bash
pnpm -F @repo/db seed:test-users -- --coopId=cahootz --count=2 --prefix=releaseclick
```

## Automated browser journeys

Start the API and mobile web app, then run:

```bash
pnpm -F @cahootz/api dev
pnpm -F @cahootz/mobile dev
pnpm test:e2e:mobile
```

Use `pnpm -F @cahootz/mobile test:e2e:headed` to watch Chrome perform the journey. Override the defaults with `E2E_BASE_URL`, `E2E_API_BASE_URL`, `E2E_USER_A_EMAIL`, `E2E_USER_B_EMAIL`, and `E2E_LOGIN_CODE`.

The current Playwright suite covers:

1. Two independent users sign in through the real UI and the menu shows the correct identity in each session.
2. User A signs out while User B remains signed in after a reload.
3. User A creates a commons post.
4. User B reloads, sees the post, opens it, and submits a comment.
5. User A reloads, opens the post, and sees User B's comment.
6. The generated post is removed after the assertions so repeat runs do not fill the feed.
7. Signing in lands on Circle View (the Commons tab's landing screen), not the post feed directly; opening a circle and using its back button returns to Circle View without duplicating the bottom tab bar.
8. A signed-in member can join a welcome lounge from Circle View's dashed "Join a welcome lounge" card and lands in that lounge's real feed.
9. A signed-in member opens the commons info page from the drawer's info button (its only entry point) and switches between the Overview, Community, and Governance tabs, each showing real member-only data (mission priorities, this month's activity stats, people, circles, and governance thresholds/proposals).
10. Two separately signed-in members can join a welcome lounge from Circle View, land in its real feed, and see the same Sage-authored welcome thread prompting introductions.
11. A member creates an event from the feed composer's "+" affordance; it renders as an inline event card in the feed and in the "Upcoming" module, and opens a dedicated event detail screen (RSVP, add to calendar, discussion).
12. User A creates an event; User B RSVPs "Going" from the event detail screen; User A sees the updated going count after reload.
13. A circle leader (the circle's creator) pins a post from the feed; it renders above the "Upcoming" module with a "Pinned" badge for every member of that circle, including on reload.
14. Two members complete a Sage ride-match suggestion end to end (`sage-ride-match.spec.ts`): a circle window closes after 40 seeded messages, Sage detects a ride need, the subject provides context and consents to a limited match, the matched member accepts, and a new private circle with exactly those two members is created. Both land in Sage Suggestions' Done tab.
15. A circle leader receives and approves a Sage trend suggestion (`sage-trend.spec.ts`): after a circle window closes, Sage may propose an event, a circle post, or a Commons post based on the conversation; approving it publishes the corresponding `CommonsPost` in the right feed (circle vs Commons general), and it appears in Done. Declining or escalating ("Ask an admin") are also covered.
16. A member edits their Personal Page profile (`personal-page-profile.spec.ts`): from "Add a bio"/"Edit profile" they pick a photo (the sheet previews it), switch to an emoji avatar, write a bio, and save; the bio and emoji persist after reload and User B sees both on the member's public `/people/<handle>` page. The spec restores the member's original bio and avatar afterwards. The photo is previewed but not uploaded, so the journey needs no blob-storage secret.

Journeys 11-13 require the `Event`/`EventHost`/`EventRSVP`/`EventReminder` tables and `CommonsPost.isPinned` columns from migration `20260922010000_add_circle_events` - run `pnpm --filter @repo/db exec prisma migrate deploy` (and regenerate the client with `pnpm --filter @repo/db run db:generate`) before running the suite locally. Journeys 14-15 additionally require the Sage tables from migrations `20260923010000_sage_ride_match` and `20260923020000_sage_suggest_action`, and a working `OPENAI_API_KEY` - both exercise Sage's real (unmocked) detection models, so they're slower and only as deterministic as the model's classification of clearly-worded seeded messages. Journey 16 requires the `User.avatarUrl`/`avatarEmoji`/`avatarColor` columns from migration `20260926010000_user_avatar`.

The post-signup wizard used by every sign-in helper now has three steps (intro, profile, and a "find your way in" step offering a welcome lounge) - `e2e/support/auth.ts` is the single place that clicks through all three, so a future wizard change only needs updating there.

Failure artifacts are written under `output/playwright/`, including screenshots, video, and a Playwright trace.

## GitHub Actions

The `Mobile E2E` workflow runs for pull requests that change the mobile app, API, tRPC routes, database package, or dependency lockfile. It also runs on relevant pushes to `main` and can be started manually with **Run workflow**.

Each job creates an isolated PostgreSQL database service, applies migrations, seeds the `cahootz` `CoopConfig` (`scripts/seed-coop-config.ts` + `scripts/seed-coop-display-info.ts` - required for `commons.listDirectory` to recognize any membership, which gates every real circle feed, not just General), seeds the two users above, starts the API and Expo web app, installs Chromium, and runs `pnpm test:e2e:mobile`. It uploads the Playwright report, failure traces, screenshots, videos, and server logs as the `mobile-e2e-artifacts` artifact.

No repository secrets are required for journeys 1-13. Journeys 14-15 (Sage) exercise real detection models rather than a mock, so they need an `OPENAI_API_KEY` repository secret (Settings > Secrets and variables > Actions) - without it, those two journeys fail in CI with "Sage never surfaced a suggestion for this window" even though the rest of the suite passes. Payment, email, or other external-service journeys must use provider test modes and dedicated CI secrets.

After the workflow has run once on GitHub, add **Two-user mobile UI journeys** as a required status check in the `main` branch protection rules so a failing E2E suite blocks merging.

## Automated journeys to add before release

Implement these in priority order. Every multi-user scenario must use separate browser contexts or separate physical devices.

| Priority | Journey                   | Users                 | Required assertions                                                                                                          |
| -------- | ------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| P0       | New member onboarding     | One new user          | Application, code login, profile completion, membership, and first feed load all succeed                                     |
| P0       | Session security          | A and B               | Logout invalidates only that session; a revoked or expired session returns to sign-in; A never sees B's private account data |
| P0       | Commons access rules      | Member and non-member | Public content is readable; restricted content and member actions are blocked until membership is granted                    |
| P0       | Direct messages           | A and B               | A sends; B receives and replies; unread state changes only for the correct user; conversation persists after reload          |
| P0       | Notifications             | A and B               | B's comment creates an alert for A; opening it reaches the correct post; marking it read does not change B's alerts          |
| P0       | Proposal and vote         | Creator and voter     | Proposal appears, eligible member votes once, duplicate vote is blocked, and totals match on both sessions                   |
| P0       | Admin authorization       | Member and admin      | Member cannot open or invoke admin actions; admin can review and approve an application; approved user sees the result       |
| P0       | Payment happy path        | Buyer and seller      | Stripe test checkout succeeds once, receipt/status appears, and both sides see the same order state                          |
| P0       | Payment failure and retry | Buyer                 | Decline, cancellation, retry, refresh, and duplicate submission do not create a paid or duplicate order                      |
| P1       | Post permissions          | A and B               | B cannot edit/delete A's post or comment; each author can edit/delete their own content                                      |
| P1       | Circle membership         | Owner and member      | Create, join, leave, post, and permission changes update both sessions after reload                                          |
| P1       | Media upload              | One user              | Valid image displays after reload; invalid type, oversized file, interrupted upload, and retry behave clearly                |
| P1       | Search and deep links     | One user              | Search opens the correct person/post/commons; copied links work signed in and signed out                                     |
| P1       | Store workflow            | Buyer and owner       | Browse, purchase/request, owner update, buyer status, cancellation, and history remain consistent                            |
| P1       | Account recovery          | One user              | Wrong/expired code, resend timer, correct code, logout, and login on a second device all behave correctly                    |
| P2       | Poor network recovery     | One user              | Slow, offline, timeout, and server-error states preserve drafts and allow retry without duplicates                           |
| P2       | Accessibility smoke       | One user              | Keyboard navigation, focus order, labels, error announcements, zoom, and contrast work on critical paths                     |

## Manual two-device release run

Automation on mobile web does not prove the native iOS and Android builds work. Before release, run the following with an iPhone and an Android device, or two real devices of the platforms you support:

1. Install a clean release-candidate build on both devices.
2. Sign in as User A on device 1 and User B on device 2.
3. Complete or defer profile setup and confirm each menu shows the correct account.
4. Have A create a post with text and an image.
5. Have B open the post, like it, comment, and share its link.
6. Confirm A receives the notification, opens the correct post, and sees B's actions.
7. Have A reply; confirm B receives and reads the reply.
8. Send a direct message in both directions and verify unread/read state.
9. Create a proposal with A and vote with B; verify totals on both devices.
10. Background and reopen both apps, switch networks, and repeat a refresh.
11. Sign A out; confirm B stays signed in and continues working.
12. Force-close and reopen; confirm the expected session state and persisted content.

Repeat the critical path once on mobile web in Chrome and Safari. Test the smallest supported phone, a current large phone, and any tablet layout planned for release.

## Exploratory test checklist

For every critical screen, also try:

- Empty fields, whitespace, minimum and maximum lengths, emoji, pasted text, and duplicate taps.
- Back navigation during a save, refresh during a request, app backgrounding, and reopening from a deep link.
- Slow network, temporary offline mode, API error, timeout, retry, and server recovery.
- Two users changing the same object close together.
- Direct URL access while signed out, signed in as the wrong role, and after logout.
- Empty, loading, success, validation, permission-denied, and unexpected-error states.

## Release gates

Do not release until all of these are true:

- Every P0 journey passes on staging.
- The automated Playwright suite passes twice consecutively from clean browser contexts.
- The manual two-device run passes on the release-candidate iOS and Android builds.
- No open bug can expose another user's private data, bypass a role check, lose money, duplicate a payment, or corrupt user content.
- Crash reporting, API error reporting, payment webhooks, backups, support contact, privacy policy, and account deletion have each been exercised once in staging.
- Every failed test has an owner and a release decision recorded; flaky tests are treated as failures until explained and fixed.

Record the build number, commit, date, devices, operating systems, tester, result, and links to failure artifacts for each release candidate.
