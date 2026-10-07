<!-- Generated from AGENTS.md by `pnpm agents:sync`. Do not edit; change AGENTS.md instead. -->

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

## Sage and Commons AI work

When a task touches Sage, Commons agents, AI observations, proactive suggestions, agent memory, alerts, or AI spending:

1. Read the “Sage — Constitutional Operating Agent” section in `AGENT.md`.
2. Read `docs/sage-roadmap.md`.
3. Inspect the current implementation before proposing new architecture. Reuse existing action, review, audit, observation, notification, and cost systems.
4. Work on the highest-priority roadmap item that is within the user's request.
5. Make Sage direct and action-oriented, but preserve consent, governance, privacy, and financial authorization boundaries.
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
