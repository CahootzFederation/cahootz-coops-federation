# Cahootz coding instructions

Follow the security and governance requirements in @AGENT.md and the release process in @TESTING.md.

When code changes a user-visible workflow, add or update its Playwright coverage under `apps/mobile/e2e/`. Test through the real UI. Use two isolated browser contexts for interactions between users, use unique test content, and clean up generated data. API calls may support fixture setup and cleanup but must not replace UI actions being tested.

For mobile workflow changes, run:

```bash
pnpm -F @cahootz/mobile type-check
pnpm test:e2e:mobile
```

Do not create E2E tests for behavior-neutral refactors. Add a UI regression test for reproducible user-facing bug fixes.
