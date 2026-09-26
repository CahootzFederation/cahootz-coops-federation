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

How the suite stays fast:

- **One sign-in per account per run.** A `setup` project (`e2e/auth.setup.ts`) signs both fixture accounts in through the real UI (journey 1) and saves each browser's storage to `apps/mobile/e2e/.auth/` (git-ignored). `newSignedInPage` starts every test's isolated context from that saved session instead of repeating the sign-in. Sign-out only clears the browser's own storage, so a test that signs out doesn't affect the saved session. If you run with `--no-deps`, delete `e2e/.auth/` first or the tests will reuse the last run's sessions.
- **Files run in parallel.** Three workers by default (`E2E_WORKERS=1` to run serially, e.g. on a slow machine). Tests inside one file still run in order. New specs must create uniquely named `E2E` content and must not depend on state another file changes.
- **`pnpm -F @cahootz/mobile test:e2e:fast`** skips the two `@sage` journeys (14-15), which call a live model and are the slowest journeys (40s to 90s each). CI always runs them.
- Video is recorded only when CI retries a failed test; traces and screenshots are still kept for every failure.

The current Playwright suite covers:

1. Two independent users sign in through the real UI and the menu shows the correct identity in each session (`auth.setup.ts`, which every other spec depends on).
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
16. A signed-in member opens the restored Shop tab, sees funding badges listed under Commons shops alongside other shops' products, starts the real shop-application route, returns to Shop, and exercises marketplace search (`store-marketplace.spec.ts`).
17. Signed-out visitors don't see the Shop tab or the drawer's stores entry, a direct `/store` link opens sign-in, and Circle View shows a Sign in card in place of the welcome lounge (`store-marketplace.spec.ts`, `circle-view.spec.ts`).
18. A signed-in member chooses a funding badge, opens the cart, and reaches checkout with the right item and total (`store-marketplace.spec.ts`).
19. A member of more than one commons switches the Shop to a second commons and sees that commons' shops and products, then opens the shop's detail page (`store-marketplace.spec.ts`). `pnpm -F @repo/db seed:e2e-marketplace` provisions the fixture: an `E2E Market Commons` (`e2e-market`) that User A belongs to, with one payment-ready member shop. Run it after seeding the test users. Without `E2E_STRIPE_CONNECTED_ACCOUNT_ID` (as in CI) the same seed points the shared funding settlement at a placeholder account so the Cahootz funding shop and its badges are still listed; it never replaces a settlement account that's already configured.
20. When Stripe test credentials and a payment-ready test Connect account are configured, the same journey buys the Seed Supporter badge through the real Stripe Payment Element and verifies payment confirmation. This journey is skipped when the dedicated Stripe secrets are absent; it must be enabled for staging release qualification.
21. A circle with an emoji icon renders on Circle View with the emoji's full glyph visible (its line box is at least as tall as its font size, so the top and bottom aren't clipped).
22. A circle leader invites a commons member directly (`circle-invite.spec.ts`): from circle settings, User A searches for User B by handle and sends an invitation, which stays listed under "Pending invitations" after reload. User B opens Circles from Circle View's "Manage circles" button, accepts the invitation, and lands in the circle's feed; User A reloads and sees two members and no pending invitation. Circles no longer show or accept invite codes in the app.

Journeys 11-13 require the `Event`/`EventHost`/`EventRSVP`/`EventReminder` tables and `CommonsPost.isPinned` columns from migration `20260922010000_add_circle_events` - run `pnpm --filter @repo/db exec prisma migrate deploy` (and regenerate the client with `pnpm --filter @repo/db run db:generate`) before running the suite locally. Journey 22 requires the `GroupInvite` table from migration `20260926000000_group_invites`. Journeys 14-15 additionally require the Sage tables from migrations `20260923010000_sage_ride_match` and `20260923020000_sage_suggest_action`, and a working `OPENAI_API_KEY` - both exercise Sage's real (unmocked) detection models, so they're slower and only as deterministic as the model's classification of clearly-worded seeded messages.

The post-signup wizard used by every sign-in helper now has three steps (intro, profile, and a "find your way in" step offering a welcome lounge) - `e2e/support/auth.ts` is the single place that clicks through all three, so a future wizard change only needs updating there.

### Stripe payment journey

Journey 20 is temporarily disabled: it's skipped unless `E2E_ENABLE_STRIPE_JOURNEY=1` is set, and it also needs `E2E_STRIPE_CONNECTED_ACCOUNT_ID`. It needs, from the same Stripe **test-mode** platform account:

- `STRIPE_SECRET_KEY` (`sk_test_...`) for the API.
- `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` (`pk_test_...`) for the mobile web app.
- `E2E_STRIPE_CONNECTED_ACCOUNT_ID` (`acct_...`), a Connect account on that platform with charges enabled. Re-run `pnpm -F @repo/db seed:e2e-marketplace` with it set so it becomes the shared funding settlement account.

Locally:

```bash
E2E_STRIPE_CONNECTED_ACCOUNT_ID=acct_... pnpm -F @repo/db seed:e2e-marketplace
E2E_ENABLE_STRIPE_JOURNEY=1 E2E_STRIPE_CONNECTED_ACCOUNT_ID=acct_... pnpm test:e2e:mobile
```

In GitHub Actions these come from the `E2E_STRIPE_SECRET_KEY`, `E2E_STRIPE_PUBLISHABLE_KEY`, and `E2E_STRIPE_CONNECTED_ACCOUNT_ID` repository secrets (`E2E_STRIPE_WEBHOOK_SECRET` is optional). The seed gives User A a fixed wallet address because checkout identifies buyers by wallet. The journey checks Stripe's client-side confirmation only. Orders stay `PROCESSING` until Stripe's webhook reaches the API, so completing them locally needs `stripe listen --forward-to localhost:3001/webhooks/stripe`.

Failure artifacts are written under `output/playwright/`, including screenshots, video, and a Playwright trace.

## GitHub Actions

The `Mobile E2E` workflow runs for pull requests that change the mobile app, API, tRPC routes, database package, or dependency lockfile. It also runs on relevant pushes to `main` and can be started manually with **Run workflow**.

Each job creates an isolated PostgreSQL database service, applies migrations, seeds the `cahootz` `CoopConfig` (`scripts/seed-coop-config.ts` + `scripts/seed-coop-display-info.ts` - required for `commons.listDirectory` to recognize any membership, which gates every real circle feed, not just General), seeds the two users above, starts the API and Expo web app, installs Chromium, and runs `pnpm test:e2e:mobile`. It uploads the Playwright report, failure traces, screenshots, videos, and server logs as the `mobile-e2e-artifacts` artifact.

No repository secrets are required for journeys 1-13 or journey 16. Journeys 14-15 (Sage) exercise real detection models rather than a mock, so they need an `OPENAI_API_KEY` repository secret (Settings > Secrets and variables > Actions) - without it, those two journeys fail in CI with "Sage never surfaced a suggestion for this window" even though the rest of the suite passes. Journey 17 uses `E2E_STRIPE_SECRET_KEY`, `E2E_STRIPE_PUBLISHABLE_KEY`, `E2E_STRIPE_WEBHOOK_SECRET`, and `E2E_STRIPE_CONNECTED_ACCOUNT_ID`. The connected account must be charges-enabled in Stripe test mode; never use a live account. Forward Stripe test webhooks to `/webhooks/stripe-new` when verifying badge issuance and refunds locally or in staging.

The restored marketplace requires migration `20260924010000_restore_commons_marketplace`. Existing environments should run `pnpm db:migrate-prod` followed by `pnpm db:backfill-funding-stores`; official funding shops become public after the platform's shared funding account is configured and payment-ready.

Official funding shops now inherit the platform's shared Stripe connected account. A platform administrator sets or replaces it from **Portal → Admin → Marketplace Settings** using an `acct_...` ID that belongs to this Connect platform. The **Individual badge-store accounts** section can assign a verified account to one official shop or return that shop to the shared default. Member-owned shops still complete their own Stripe onboarding. Changing either setting affects only future badge checkouts; each existing transaction retains its original Stripe destination for audit and refund reconciliation.

Each commons detail page in the platform admin has a **View all stores** link. The store directory includes the official badge store and every member-owned store, including pending or payment-incomplete shops that are not public yet. Each store detail page reports public/payment readiness, the effective Stripe account, order and sales totals, and its complete product catalog. In the mobile marketplace, the official badge store also appears in the normal **All shops** list and opens through the same store-detail experience as a member shop.

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
