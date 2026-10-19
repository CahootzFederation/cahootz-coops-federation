# Repository agent instructions

Read `AGENT.md` for the project's security, governance, and architecture rules. Read `TESTING.md` before changing a user-visible workflow.

## Voice for copy and prompts

Every member-facing string and every agent prompt must sound personable and plain, not robotic, corporate, or academic. Sage should feel like a friendly, sharp member of the community. Follow "Voice: Personable and Plain" in `AGENT.md`.

- Write like you talk: short sentences, everyday words, contractions, "you" and "we." Aim for a 6th–8th grade reading level.
- Errors say what happened and what to do next. Never ship "An error occurred," "Invalid input," or "Request failed" on their own.
- Buttons name the action ("Send," "Post," "Join"), not "Submit."
- Swap jargon for plain words. If a precise term has to stay, explain it briefly the first time.
- Write Sage prompts in the voice you want back, and keep the voice instruction in the shared prompt block instead of copying it.
- Warm never means vague or soft on facts. Money, dates, approvals, and risks stay exact and honest.
- When you add or change copy, fix stiff wording in the strings you touch, and update any test that asserts on the old text.

## End-to-end UI coverage

- When a change adds, removes, or alters a user-visible workflow, add or update a Playwright test under `apps/mobile/e2e/` in the same change.
- A UI bug fix needs a regression test that fails without the fix and passes with it when the behavior can be reproduced in mobile web.
- Exercise the real UI with clicks, typing, navigation, reloads, and visible assertions. Do not replace a UI journey with direct API calls. Direct API calls are allowed for fixture setup and cleanup.
- Workflows involving two people must use two isolated browser contexts and two user accounts. Reuse the `releaseclick1` and `releaseclick2` fixtures unless the scenario needs different roles.
- Use unique `E2E` content and clean it up. Never run destructive E2E tests against production.
- Journeys run in tiers (see "Test tiers" in `TESTING.md`). Leave a new journey untagged unless it fits a tier: tag it `@sage` if it calls a live model, and `@smoke` only if it is a core path with no smoke coverage yet. Keep the smoke set at about 15 to 20 journeys. A smoke journey must not take a `withExclusiveAccountSetting` lock or call a live model.
- Don't paper over a flaky journey with more retries or longer timeouts. Fix it, or quarantine it with `test.fixme()` and a comment naming the tracking issue.
- Update `TESTING.md` when adding a new journey or changing its setup.
- Before finishing a relevant change, run `pnpm -F @cahootz/mobile type-check`, `pnpm test:e2e:mobile:smoke`, and every spec file you added or changed (`pnpm -F @cahootz/mobile exec playwright test e2e/<name>.spec.ts`). For a change to Sage behavior, also run the affected `@sage` journeys. Run the whole suite (`pnpm test:e2e:mobile`) only when you change the E2E harness (`e2e/support/`, `e2e/auth.setup.ts`, `playwright.config.ts`, or the workflow). CI runs the full suite on `main` and nightly. If the services are not running locally, follow the startup instructions in `TESTING.md`.
- Pure refactors, documentation, copy, or styling changes do not require a new journey unless they change behavior or fix a UI regression.

## Sage and Commons AI work

When a task touches Sage, Commons agents, AI observations, proactive suggestions, agent memory, alerts, or AI spending:

1. Read the “Sage — Constitutional Operating Agent” section in `AGENT.md`.
2. Read `docs/sage-roadmap.md`.
3. Inspect the current implementation before proposing new architecture. Reuse existing action, review, audit, observation, notification, and cost systems.
4. Work on the highest-priority roadmap item that is within the user's request.
5. Make Sage direct, action-oriented, and personable, but preserve consent, governance, privacy, and financial authorization boundaries.
6. Prefer bounded deterministic tools over unrestricted agent access.
7. Add or update unit tests and the required Playwright journey for behavior changes.
8. Update `TESTING.md` and `docs/sage-roadmap.md` with the verified result.
9. Record remaining limitations honestly. Do not mark a roadmap item complete merely because the prompt changed; verify the behavior in code and tests.

Before finishing Sage work, report:

- what behavior changed;
- what Sage may now do automatically;
- what still requires approval;
- how memory is bounded and scoped;
- the cost limit and expected model usage;
- which tests passed;
- the next highest-priority incomplete roadmap item.
