# Sage product roadmap

Last updated: 2026-10-03

## North star

Sage is a constitutional operating agent for a Commons: proactive enough to notice needs and move useful work forward, direct enough to say what it thinks, and constrained enough that members retain authority over governance, money, privacy, and irreversible actions.

The target operating loop is:

1. Observe activity and scheduled health signals.
2. Compare them with the active charter, mission goals, open commitments, and relevant prior outcomes.
3. State a clear position and propose a concrete action.
4. Apply deterministic autonomy and authorization policy.
5. Act automatically when the action is low-risk and permitted, or route it to the right member for approval.
6. Follow up after the relevant deadline.
7. Verify the outcome and record what happened.
8. Use the outcome to improve future suggestions without treating generated memory as fact.

## Non-negotiable boundaries

- Sage never submits votes, spends funds, changes membership or roles, amends a charter, executes on-chain transactions, disciplines members, or makes irreversible external commitments without the required authorization.
- Model confidence alone never grants authority. Deterministic code evaluates permission, evidence, severity, reversibility, budget, and required approval.
- Private-circle and member-specific information remains scoped to authorized viewers.
- Every executed action is idempotent and auditable.
- AI-generated memory is an interpretation with sources and confidence, not a verified fact.
- Autonomous model usage stops at the configured per-Commons cost or call limit.

## Current foundation

Already present in the repository:

- Event-driven analysis of new General Commons posts and comments.
- Charter-grounded Sage replies and proposal drafts.
- Resource detection and verification invitations.
- Circle trend detection and ride-match suggestions.
- Member approval, decline, and admin-escalation review flows.
- Bounded tool execution with payload hashes, idempotency, and audit events.
- AI Working Memory through scoped `AIObservation` records.
- Token and estimated-cost accounting through `AICostEvent`.
- Member-visible monthly AI spending.

P0 proactive-suggestion slice (branch `claude/sage-stewart-system-plan-5f647c`, 2026-10-03). Implemented:

- Direct, conclusion-first instructions for Commons replies (`commons-action-agent.ts`) and circle trend suggestions (`sage-trend-agent.ts`). A trend suggestion's title, recommendation and reason are all required, and the reason appears as "Why Sage suggests this" before and after review.
- Automatic Commons replies require confidence of at least `AUTO_REPLY_MIN_CONFIDENCE = 0.75`, on top of exact charter grounding, the 48-hour window, the per-Commons Auto-reply switch, and one reply per source.
- Two new trend capabilities. `comment_on_post` is a Sage-authored comment. Sage publishes it by itself when confidence is at least 0.75 and the Commons' Auto-reply switch is on; otherwise the circle leader approves it. A comment Sage publishes by itself is recorded with an `AUTO_PUBLISHED` audit event, holds a `replySourceKey` so Sage keeps one comment per post across all its paths, and can be removed by a platform admin. Code checks that the target is one of the window's own circle posts, then re-checks Commons and circle scope at execution, limits Sage to one comment per post, and marks refusals `FAILED` with an `ACTION_REFUSED` audit event. `draft_proposal` creates a `CommonsProposalDraft` owned by the approving leader; it stays editable and unsubmitted until the member submits it through the normal proposal flow.
- Bounded action memory (`sage-outcome-memory.ts`): Sage reads its last 8 suggestions from the past 90 days in the same circle only, including awaiting-review, declined and failed outcomes and reviewer corrections, capped at 1,500 characters. They are presented as member decisions, not facts.
- Monthly autonomy limit per Commons (`sage-autonomy.ts`): defaults of `$5` and `2,000` calls, stored per Commons on `CommonsAgentSetting` (migration `20261003010000_sage_autonomy_limits`) and editable by platform admins on the web Commons AI actions page. Usage is counted over `commons-action-agent`, `sage-trend-detect` and `sage-ride-match-detect` cost events. Unpriced calls count toward the call limit. The check runs before every autonomous model call and fails closed. Member-requested AI is neither counted nor paused.
- Circle posts and comments created through the current app (`commons.createPost` / `commons.createComment`) now advance a circle's 40-item analysis window, alongside legacy circle chat messages. Before this, the current app never triggered circle analysis. The trend reader includes comments on circle posts and no longer reads mirrored chat messages twice. Ride-match detection still reads only chat messages.
- Platform admins can **Analyze now** for any circle on the web Commons AI actions page. This closes the circle's open window early and runs detection. It counts toward the autonomy limit and is refused while Sage is paused or when nothing is new.
- Repeat suggestions are skipped in code. A new circle suggestion is not created if a recent suggestion in the same circle has the same target post, or the same capability with a near-identical title (`titlesNearlyIdentical`). Recent means still pending, or declined or done within 30 days. Each skip is recorded as a `DUPLICATE_SKIPPED` audit event on the earlier suggestion, shown in its timeline and in the admin page's **Skipped repeats** list.
- Each circle suggestion shows its circle, the exact post Sage is replying to, and the conversation window Sage read (up to 30 entries), but only to a viewer who is still a member of that circle.
- Sage Decision Trail (`sage-decision-trail.ts`, migration `20261004010000_sage_decision_trails`). Every Sage analysis records one trail: Commons feed posts and comments, circle windows, and ride-match windows, including when Sage does nothing, is paused by the monthly limit, or fails. A trail records Observed → Evidence gathered → Action considered → Policy check → Action taken as Sage decides. Result and Follow-up are derived when the trail is read, from the linked suggestions' status, reviews and audit events, so they stay current. Members see trails only with the personal **Sage settings → Show Sage decision trails** setting on (off by default), on posts and suggestions they can already see. Ride-match trails, admin escalations, invitations of a named person and error details are admin-only, and deleted Commons content is redacted for members. Platform admins see every trail, with the exact content Sage read, on the web Commons AI actions page; **Analyze now** opens the new trail. Members can't start an analysis; trails only record decisions Sage already makes, with no extra model calls. `replayTrendWindow` runs the circle decision path with a supplied model output, for fixtures and replayable evaluations.
- Decision trails cover the proposal engine (create, resubmit and apply-alternative, including the rewrite), proposal comment evaluation, and Sage's @mention and DM replies, alongside the Commons feed, circle trend and ride-match agents. Each trail has an `agent` and an optional `proposalId`.
  - Proposal-review trails record every goal and structural score, risk flags, missing information, alternatives, each scoring gate and compliance check, the auto-approve and council budget tiers, and the decision. The result is the proposal's live status.
  - Comment-evaluation trails flag a label that contradicts its own score; the engine trusts the model's label. They also note that only the first 2,000 characters of the charter are used.
  - Sage-reply trails record the thread, what the reply was grounded on, and whether the model fell back to its standard "no grounded answer". @mentions in circles, which Sage doesn't answer, are recorded with the reason.
  - The proposal page and the direct message with Sage show these trails when the member's setting is on. A DM's trail is visible only to the two people in it. The admin page can filter trails by agent.
- Sage-comment alerts: whenever Sage comments on a post, the post's author and everyone else who commented get a `SAGE_COMMENT` alert. This covers Commons auto-replies, admin-approved replies, comments Sage posts by itself or with the leader's approval, and @mention replies. Bots are never alerted, circle posts alert only current circle members, and Commons posts alert only active members. The alert opens the post at Sage's comment. Welcome-lounge shout-outs keep their own alerts.
- Steering defenses (`untrusted-input.ts`). Every member-written text is cleansed before it reaches a model: Commons items, circle conversations, ride-match messages, Sage @mention and DM messages and threads, proposals (create, resubmit, applied alternatives) and proposal comments. Cleansing removes hidden and zero-width characters and fake structure markers, normalizes lookalike Unicode, collapses padding and caps length. Instruction-like text aimed at the AI is flagged.
  - Flagged content can't get a Sage reply or comment without review.
  - A flagged @mention or DM gets a fixed reply with no model call.
  - A flagged proposal can't be auto-approved and goes to a council vote instead.
  - Anything Sage publishes is checked first: no links, @mentions, claimed real-world actions or echoed instructions, and at most 1,200 characters. Autonomous comments that fail go to review; member-requested replies are cleaned, or replaced with a safe standard reply.
  - Every check is recorded in the decision trail. Detection is pattern-based, so a determined attacker can still phrase around it. The structural limits (review, no auto-approval, output checks) are the real protection.
- Fixed a sign-in bounce in the web admin portal: the first sign-in always returned to the login page, because the layout redirected on its stale pre-login state.
- Reply voice and templates (`sage-reply-templates.ts`). All Sage replies and comments share one voice: a trusted organizer who says "we", asks the member for something specific, uses plain words, and only offers what Sage can do (draft a proposal, ask a question, suggest connecting people).
  - Templates are suggestions, never a required format. The first is **Action plan**: a position, then "Here's what we can do:" with bullets of steps for the member, then "Once you've done that, I can …".
  - The feed and circle agents pick a template and fill its parts, and code renders the text, so the format is exact. The @mention and DM agent follows the shape in plain text.
  - To add a template, add an entry to `SAGE_REPLY_TEMPLATES`.
  - Live runs with gpt-5.6-luna sometimes choose a plain clarifying question over the template for the same post; that's allowed.
- Follow-through: when Sage analyzes a Commons comment, it sees the post and up to 10 earlier comments, Sage's own included. When a member provides what Sage asked for, Sage drafts the proposal instead of asking again (verified live: a reply with delivery days, stops and cost produced a draft built from those numbers).
- Members see autonomous usage against both limits, plus Active/Paused status and the reset date, on the Commons info page's AI spending card.

Verification:

- `pnpm -F @repo/trpc test`: 51 files / 501 tests passed, including the new `sage-stewardship.test.ts`.
- `pnpm -F @repo/trpc build` and `pnpm -F @cahootz/mobile type-check` passed.
- Fixed an existing race in `circle-window.ts` (found while validating the live trend journey): two messages arriving together created two OPEN windows, the 40-message count split between them, and Sage never analyzed the conversation. A per-circle advisory lock now serializes window updates. 39 concurrent touches against the local DB land in one window, and `circle-window.test.ts` covers it.
- Playwright, local stack (serial, `E2E_WORKERS=1`): the full suite ran 32 passed, 2 skipped, 2 failed. The failures were `circle-invite` (Chrome launch timeout) and `sage-trend` (the window race above). After the race fix, `sage-trend`, `sage-ride-match`, `sage-stewardship` and `circle-invite` passed together, all with the live model. `sage-stewardship` passed in 4 separate runs.

Known limitations:

- The autonomy check is not transactional; concurrent workers can each overshoot by at most one batch.
- Platform admins, not Commons administrators, set the limits; Commons-admin control, forecasts and pre-limit alerts remain P2.
- The web admin limit control is covered by router unit tests only; the repo's Playwright suite covers the mobile app, not the web admin portal.
- Comment and proposal capabilities are only reachable from circle trend windows. General Commons `MAKE_PROPOSAL` drafts still go to the source author without leader approval, as before.
- The live trend model, not code, picks which capability to use; `sage-stewardship.spec.ts` seeds suggestions through the real `createTrendSuggestion` path to test approval deterministically.
- Decision trails have no retention limit yet; add a purge (for example after 180 days) before high volume. A trail stores the model's stated reason, not its hidden reasoning.
- A trail showed a reply grounded on an exact but irrelevant charter quote (a ladder request answered with a line about proposals). Exact-quote grounding doesn't check relevance; an independent relevance check belongs with P2 oversight.
- Not yet traced: community observer, Commons assistant and recommender, proposal-engine playground and test runs, newsletter agents, knowledge base.
- Found while tracing proposals (not changed here): the proposal engine computes KPIs and then discards them; `proposal.testEngine` is a public procedure that runs the paid engine; proposal and comment-evaluation reads are public; `authenticatedProcedure` trusts the `x-wallet-address` header without a signature.
- Memory is per-circle outcome history only. Cross-circle consolidation, expiry and supersession remain P1.

## Prioritized plan

### P0 — Finish and validate the current proactive-suggestion slice

Goal: ship direct recommendations, approval-gated comments and proposal drafts, bounded memory, and visible cost limits safely.

Acceptance criteria:

- Sage leads with a recommendation and displays its reason.
- A circle leader can approve or decline a suggested comment or proposal draft.
- A proposal remains an editable draft until a member explicitly submits it.
- Sage cannot comment on a post outside the source Commons and circle.
- Low-confidence automatic replies are not published.
- Autonomous detection stops at either configured monthly limit.
- Member-requested Sage conversations remain available after the autonomy limit is reached.
- Unit, type, and mobile end-to-end checks pass.

### P1 — Proactive leadership and responsibility routing

Goal: make `ESCALATE_TO_ADMIN` and targeted alerts operational instead of passive database rows.

Work:

- Add a deterministic responsibility directory for circle leaders, Commons administrators, governors, treasury contacts, and designated safety contacts.
- Have the model select a responsibility category, never an arbitrary recipient.
- Resolve recipients in code and verify active membership and role status.
- Create an evidence packet containing the source, applicable charter passage, severity, recommendation, and deadline.
- Add deduplication, expiry, per-recipient rate limits, and “wrong person” feedback.
- Route unresolved responsibility to the Commons admin queue.

Acceptance criteria:

- A high-confidence, high-impact concern reaches the correct responsible role without the member asking Sage first.
- The alert exposes its evidence and why it was routed.
- Duplicate alerts are suppressed.
- Sensitive allegations require review before wider publication.
- Every delivery and response is audited.

### P1 — Durable commitments and follow-up

Goal: move Sage from one-shot detection to an accountable operating loop.

Work:

- Represent accepted actions as durable commitments with an owner, due date, expected outcome, and verification method.
- Wake Sage on deadlines, relevant new events, and action completion.
- Ask for updates when a commitment stalls.
- Verify outcomes from application state instead of trusting a conversational claim.
- Record completed, failed, superseded, and abandoned outcomes.

Acceptance criteria:

- Every accepted suggestion either reaches a verified terminal state or has an explicit owner and next review time.
- Sage does not repeatedly ask about completed or dismissed work.
- Members can see why Sage followed up and dismiss an incorrect commitment.

### P1 — Memory consolidation and retrieval

Goal: give Sage useful long-term continuity without unbounded prompts or privacy leakage.

Work:

- Consolidate action outcomes, corrections, commitments, and verified observations into scoped memory.
- Retrieve by Commons, circle, subject, recency, type, and relevance.
- Supersede contradictory or outdated observations rather than silently accumulating them.
- Add expiry and periodic review for unverified observations.
- Ensure background agents have an explicit, audited system-access path rather than bypassing visibility checks.

Acceptance criteria:

- Sage can explain what happened to a prior suggestion and avoid repeating a rejected one.
- Private-circle memory never appears in another circle or Commons.
- Retrieved memory has source references, confidence, status, and age.
- Prompt memory remains within a fixed token budget.

### P2 — Cost optimization and budget administration

Goal: measure value per useful outcome and prevent surprise spending.

Work:

- Add per-Commons administrator controls for the autonomy dollar and call limits.
- Use deterministic filters or a cheap classifier before higher-quality reasoning where it improves total cost.
- Batch compatible observations and cache stable charter/mission context.
- Add cost per accepted suggestion and cost per completed outcome.
- Alert administrators before a limit is exhausted and explain which capabilities will pause.
- Evaluate model quality and price quarterly using replayable Sage scenarios.

Acceptance criteria:

- Administrators can change limits without deployment.
- Members can see current spending while authorized administrators can see forecasts and feature-level usage.
- A cost cap cannot block ordinary posting, voting, proposal review, or member-requested support.
- Model changes require passing the replay evaluation at lower or justified cost.

### P2 — Independent oversight and red-team evaluation

Goal: detect unsafe, manipulative, privacy-violating, or unjustified Sage actions before they cause harm.

Work:

- Run an independent reviewer over high-impact proposed actions.
- Check evidence, authority, privacy, proportionality, prompt injection, and recipient selection.
- Create replayable evaluations from real corrected or rejected suggestions.
- Add adversarial cases for false leadership claims, fabricated consensus, financial pressure, and sensitive personal information.
- Add a Commons-level pause control for autonomous Sage actions.

Acceptance criteria:

- High-impact actions cannot execute when oversight rejects them.
- Oversight does not share the proposing agent's mutable memory or instructions.
- Safety failures are visible to authorized reviewers and become regression cases.

## Product metrics

Track these per Commons and capability:

- suggestion acceptance rate;
- decline and correction reasons;
- unnecessary-alert rate;
- duplicate-suggestion rate;
- median time from suggestion to decision;
- verified completion rate;
- charter-grounding failures;
- privacy or authorization failures;
- estimated cost per accepted suggestion;
- estimated cost per verified completed outcome.

Raw activity volume is not a success metric. Sage producing more messages is worse if members ignore or correct them.

## Roadmap update protocol

For every Sage behavior change:

1. Update the relevant milestone and acceptance criteria before implementation if scope changes.
2. Add or update unit tests and the required Playwright journey.
3. Record the commands actually run and their outcome.
4. Move an item to completed only after the behavior is verified, not merely prompted.
5. Record unresolved risks and the next highest-priority item.
6. Do not advance unrelated roadmap work unless the user requested it.

## Decision log

- 2026-10-03: Sage is defined as a constitutional operating agent, not an autonomous owner or executive.
- 2026-10-03: Organization proposals remain editable drafts until a member submits them.
- 2026-10-03: Financial, governance, membership, disciplinary, on-chain, and irreversible actions remain approval-gated.
- 2026-10-03: Memory is bounded and source-linked; generated observations are not treated as truth.
- 2026-10-03: Cost control uses both a dollar limit and a call-count limit.

## Completed milestones

Move verified work here with the completion date, linked files, and passing test commands. Do not list the current proactive-suggestion slice here until its mobile end-to-end gate passes.

- 2026-10-03 — P0 proactive-suggestion slice: direct recommendations with visible reasons, the auto-reply confidence gate, approval-gated Sage comments and editable proposal drafts from circle trends, bounded circle-scoped outcome memory, and monthly autonomy limits with member-visible usage and paused status. Files: `packages/db/prisma/migrations/20261003010000_sage_autonomy_limits`, `apps/web/app/portal/admin/commons/[coopId]/ai/commons-ai-client.tsx`, `packages/trpc/src/services/{sage-autonomy,sage-outcome-memory,sage-trend-agent,commons-action-agent,commons-action-tools,circle-window}.ts`, `packages/trpc/src/routers/{sage,commons,commons-actions-admin}.ts`, `apps/mobile/app/(authenticated)/sage/[id].tsx`, `apps/mobile/app/commons/[coopId].tsx`. Tests: `pnpm -F @repo/trpc test` (501 passed), `pnpm -F @repo/trpc build`, `pnpm -F @cahootz/mobile type-check`, Playwright `sage-stewardship`, `sage-trend`, `sage-ride-match`, `commons-info-page`.

Next highest-priority incomplete item: P1 — Proactive leadership and responsibility routing.
