# Repository agent instructions

Read `AGENT.md` for the project's security, governance, and architecture rules. Read `TESTING.md` before changing a user-visible workflow.

## End-to-end UI coverage

- When a change adds, removes, or alters a user-visible workflow, add or update a Playwright test under `apps/mobile/e2e/` in the same change.
- A UI bug fix needs a regression test that fails without the fix and passes with it when the behavior can be reproduced in mobile web.
- Exercise the real UI with clicks, typing, navigation, reloads, and visible assertions. Do not replace a UI journey with direct API calls. Direct API calls are allowed for fixture setup and cleanup.
- Workflows involving two people must use two isolated browser contexts and two user accounts. Reuse the `releaseclick1` and `releaseclick2` fixtures unless the scenario needs different roles.
- Use unique `E2E` content and clean it up. Never run destructive E2E tests against production.
- Update `TESTING.md` when adding a new journey or changing its setup.
- Before finishing a relevant change, run `pnpm -F @cahootz/mobile type-check` and `pnpm test:e2e:mobile`. If the services are not running locally, follow the startup instructions in `TESTING.md`.
- Pure refactors, documentation, copy, or styling changes do not require a new journey unless they change behavior or fix a UI regression.
