# Alerts and notification settings

The Alerts tab and the existing authenticated notification route share one inbox. It reads actual `Notification` records, with category and unread filters, stable `(createdAt, id)` pagination, a global unread count, refresh, and persisted read actions. Members do not need a wallet. Signed-out members see a sign-in prompt in the Alerts tab.

Notification settings are linked from Alerts and the account profile. A `NotificationPreference` row stores one account-wide master push switch and switches for community, governance, payments/rewards, orders/stores, and other updates. Missing rows default to all enabled, preserving existing delivery behavior. Unknown event types remain visible under Other. Disabling push never removes inbox activity or changes existing business-event producers.

The existing push service checks preferences before selecting device tokens or contacting Expo. Device registration does not overwrite preferences. Registration checks the master preference before asking for device permission. Native permission status and registration failures are visible in settings. Notification delivery refreshes the inbox; tapping a native push opens Alerts. Web users can save preferences for their native devices; browser push is not introduced.

## API and compatibility

All `notification` endpoints and the legacy P2P notification aliases now require a valid `x-session-token`. Wallet headers alone are no longer accepted. Deploy the client and server as a coordinated update; old wallet-only clients must update/sign in again. Ownership always comes from the verified session, including legacy aliases; supplied user IDs cannot select another account.

- `notification.getNotifications`: accepts `limit` (1–50), optional `{ createdAt, id }` cursor, `unreadOnly`, and category. Returns notifications, next cursor, filtered total count, and global unread count. The cursor identifies the last returned item, not the discarded lookahead row.
- `notification.getUnreadCount`, `markAsRead`, and `markAllAsRead`: operate only on the current account. A foreign/missing notification produces NOT_FOUND without revealing ownership.
- `notification.getPreferences` and `updatePreferences`: return the complete preferences. Updates accept a strict partial boolean object; unknown keys are rejected.
- `notification.registerPushDevice`: keeps the existing session-based registration interface.

Existing events that only create inbox records continue doing so; this change does not introduce new push channels or invent governance/resource-match events. Unsupported notification destinations remain readable. Personal-page activity links to the personal page; valid order, store, proposal, commons-post, and transaction identifiers link to the existing screens.

## Deployment order

1. Back up and apply `20260913000000_notification_preferences` through the normal Prisma migration deployment process (`pnpm --filter @repo/db db:migrate-prod`). It adds the preference table and an inbox pagination index, without modifying or deleting existing alerts.
2. Generate/build the database client and validators before building the API and mobile app. The mobile app consumes the new `@repo/validators/notification` subpath.
3. Deploy the session-authenticated API and updated clients together. Verify session access, a settings save, and an existing push-producing event in staging before production rollout.

No migration was applied to the user's existing databases. Testing used a separate temporary PostgreSQL instance and the exact migration against a minimal fixture containing the existing account/session/notification/device tables.

## Automated checks

```sh
pnpm --filter @cahootz/mobile type-check
pnpm --filter @repo/trpc exec tsc --noEmit
pnpm --filter @cahootz/mobile exec jest lib/__tests__/push-notifications.test.ts lib/__tests__/notification-navigation.test.ts --runInBand
NOTIFICATION_TEST_DATABASE_URL=postgresql://USER@127.0.0.1:PORT/alerts_integration_test pnpm --filter @repo/trpc exec vitest run src/routers/__tests__/notification.integration.test.ts
```

The integration suite requires an explicitly selected, disposable local database with a name ending in `_test`. It initializes the fixture and migration when needed; without that environment variable it is skipped. It covers session and ownership enforcement (including legacy aliases), wallet-free accounts, same-timestamp/deleted-cursor pagination, filtering, persisted read actions, preference defaults and isolation, token re-registration, per-category/master suppression, and inbox survival after push failure.

## Browser verification

The app was exercised against the actual notification router and temporary PostgreSQL database. Synthetic activity existed only in that isolated test database. Unrelated payment/scanner/telemetry/platform requests were isolated in the test browser; notification reads and successful writes used the real API. Network failures were injected only for recovery tests.

Both notification routes and settings were captured at 320×568, 390×844, 430×932, 768×1024, 1440×900, and landscape 844×390. The checks found and fixed a shared toast overflow at 320px, compacted filters, corrected switch accessibility state, and increased tab-label space. Phone/tablet/desktop flows covered filtering, pagination, refresh, read state, settings persistence after reload, and the master switch. Failure checks covered inbox loading/read actions and settings loading/saving, including rollback and retry.

Local screenshots and browser scripts live under `output/playwright/` and are excluded from source control. Live APNs/Expo delivery to a native build was not verified; native permission behavior is covered by automated tests. A paired iPhone was detected, but no worktree build was installed or configured on it, and no test notification was sent to it.
