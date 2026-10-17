# Sage product roadmap

Last updated: 2026-10-16

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
- Circle trend detection.
- Member approval, decline, and admin-escalation review flows.
- Bounded tool execution with payload hashes, idempotency, and audit events.
- AI Working Memory through scoped `AIObservation` records.
- Token and estimated-cost accounting through `AICostEvent`.
- Sage tasks and the wake-and-wait loop (`SageTask`, `SageWakeCycle`), routed alerts (`SageAlert`), the daily steward review with read-only specialist tools, consent-first introductions, and consolidated memory (2026-10-04, see the P1 sections).
- Member-visible monthly AI spending.

P0 proactive-suggestion slice (branch `claude/sage-stewart-system-plan-5f647c`, 2026-10-03). Implemented:

- Direct, conclusion-first instructions for Commons replies (`commons-action-agent.ts`) and circle trend suggestions (`sage-trend-agent.ts`). A trend suggestion's title, recommendation and reason are all required, and the reason appears as "Why Sage suggests this" before and after review.
- Automatic Commons replies require confidence of at least `AUTO_REPLY_MIN_CONFIDENCE = 0.75`, on top of exact charter grounding, the 48-hour window, the per-Commons Auto-reply switch, and one reply per source.
- Two new trend capabilities. `comment_on_post` is a Sage-authored comment. Sage publishes it by itself when confidence is at least 0.75 and the Commons' Auto-reply switch is on; otherwise the circle leader approves it. A comment Sage publishes by itself is recorded with an `AUTO_PUBLISHED` audit event, holds a `replySourceKey` so Sage keeps one comment per post across all its paths, and can be removed by a platform admin. Code checks that the target is one of the window's own circle posts, then re-checks Commons and circle scope at execution, limits Sage to one comment per post, and marks refusals `FAILED` with an `ACTION_REFUSED` audit event. `draft_proposal` creates a `CommonsProposalDraft` owned by the approving leader; it stays editable and unsubmitted until the member submits it through the normal proposal flow.
- Bounded action memory (`sage-outcome-memory.ts`): Sage reads its last 8 suggestions from the past 90 days in the same circle only, including awaiting-review, declined and failed outcomes and reviewer corrections, capped at 1,500 characters. They are presented as member decisions, not facts.
- Monthly autonomy limit per Commons (`sage-autonomy.ts`): defaults of `$5` and `2,000` calls, stored per Commons on `CommonsAgentSetting` (migration `20261003010000_sage_autonomy_limits`) and editable by platform admins on the web Commons AI actions page. Usage is counted over `commons-action-agent`, `sage-trend-detect`, `sage-steward` and `sage-relevance-check` cost events. Unpriced calls count toward the call limit. The check runs before every autonomous model call and fails closed. Member-requested AI is neither counted nor paused.
- Circle posts and comments created through the current app (`commons.createPost` / `commons.createComment`) now advance a circle's 40-item analysis window, alongside legacy circle chat messages. Before this, the current app never triggered circle analysis. The trend reader includes comments on circle posts and no longer reads mirrored chat messages twice. Ride-match detection still reads only chat messages.
- Platform admins can **Analyze now** for any circle on the web Commons AI actions page. This closes the circle's open window early and runs detection. It counts toward the autonomy limit and is refused while Sage is paused or when nothing is new.
- Repeat suggestions are skipped in code. A new circle suggestion is not created if a recent suggestion in the same circle has the same target post, or the same capability with a near-identical title (`titlesNearlyIdentical`). Recent means still pending, or declined or done within 30 days. Each skip is recorded as a `DUPLICATE_SKIPPED` audit event on the earlier suggestion, shown in its timeline and in the admin page's **Skipped repeats** list.
- Each circle suggestion shows its circle, the exact post Sage is replying to, and the conversation window Sage read (up to 30 entries), but only to a viewer who is still a member of that circle.
- Sage Decision Trail (`sage-decision-trail.ts`, migration `20261004010000_sage_decision_trails`). Every Sage analysis records one trail: Commons feed posts and comments and circle windows, including when Sage does nothing, is paused by the monthly limit, or fails. A trail records Observed → Evidence gathered → Action considered → Policy check → Action taken as Sage decides. Result and Follow-up are derived when the trail is read, from the linked suggestions' status, reviews and audit events, so they stay current. Members see trails only with the personal **Sage settings → Show Sage decision trails** setting on (off by default), on posts and suggestions they can already see. Suggestion follow-ups, admin escalations, invitations of a named person and error details are admin-only, and deleted Commons content is redacted for members. Platform admins see every trail, with the exact content Sage read, on the web Commons AI actions page; **Analyze now** opens the new trail. Members can't start an analysis; trails only record decisions Sage already makes, with no extra model calls. `replayTrendWindow` runs the circle decision path with a supplied model output, for fixtures and replayable evaluations.
- Decision trails cover the proposal engine (create, resubmit and apply-alternative, including the rewrite), proposal comment evaluation, and Sage's @mention and DM replies, alongside the Commons feed and circle trend agents. Each trail has an `agent` and an optional `proposalId`.
  - Proposal-review trails record every goal and structural score, risk flags, missing information, alternatives, each scoring gate and compliance check, the auto-approve and council budget tiers, and the decision. The result is the proposal's live status.
  - Comment-evaluation trails flag a label that contradicts its own score; the engine trusts the model's label. They also note that only the first 2,000 characters of the charter are used.
  - Sage-reply trails record the thread, what the reply was grounded on, and whether the model fell back to its ready-made "I'm not sure" reply. @mentions in circles, which Sage doesn't answer, are recorded with the reason.
  - The proposal page and the direct message with Sage show these trails when the member's setting is on. A DM's trail is visible only to the two people in it. The admin page can filter trails by agent.
- Sage-comment alerts: whenever Sage comments on a post, the post's author and everyone else who commented get a `SAGE_COMMENT` alert. This covers Commons auto-replies, admin-approved replies, comments Sage posts by itself or with the leader's approval, and @mention replies. Bots are never alerted, circle posts alert only current circle members, and Commons posts alert only active members. The alert opens the post at Sage's comment. Welcome-lounge shout-outs keep their own alerts.
- Steering defenses (`untrusted-input.ts`). Every member-written text is cleansed before it reaches a model: Commons items, circle conversations, Sage @mention and DM messages and threads, proposals (create, resubmit, applied alternatives) and proposal comments. Cleansing removes hidden and zero-width characters and fake structure markers, normalizes lookalike Unicode, collapses padding and caps length. Instruction-like text aimed at the AI is flagged.
  - Flagged content can't get a Sage reply or comment without review.
  - A flagged @mention or DM gets a fixed reply with no model call.
  - A flagged proposal can't be auto-approved and goes to a council vote instead.
  - Anything Sage publishes is checked first: no links, @mentions, claimed real-world actions or echoed instructions, and at most 1,200 characters. Autonomous comments that fail go to review; member-requested replies are cleaned, or replaced with a safe standard reply.
  - Every check is recorded in the decision trail. Detection is pattern-based, so a determined attacker can still phrase around it. The structural limits (review, no auto-approval, output checks) are the real protection.
- Fixed a sign-in bounce in the web admin portal: the first sign-in always returned to the login page, because the layout redirected on its stale pre-login state.
- Reply voice and templates (`sage-reply-templates.ts`). All Sage replies and comments share one voice: a friendly, sharp member of the Commons who says "we", asks the member for something specific, uses plain words, and only offers what Sage can do (draft a proposal, ask a question, suggest connecting people). The tone itself lives in `SAGE_VOICE` (`sage-principles.ts`), which every Sage agent loads with the core principles.
  - Templates are suggestions, never a required format. The first is **Action plan**: a position, then "Here's what we can do:" with bullets of steps for the member, then "Once you've done that, I can …".
  - The feed and circle agents pick a template and fill its parts, and code renders the text, so the format is exact. The @mention and DM agent follows the shape in plain text.
  - To add a template, add an entry to `SAGE_REPLY_TEMPLATES`.
  - Live runs with gpt-5.6-luna sometimes choose a plain clarifying question over the template for the same post; that's allowed.
- Follow-through: when Sage analyzes a Commons comment, it sees the post and up to 10 earlier comments, Sage's own included. When a member provides what Sage asked for, Sage drafts the proposal instead of asking again (verified live: a reply with delivery days, stops and cost produced a draft built from those numbers).
  - Since 2026-10-07 code decides when that happens (`withFollowThrough`, `answersSageAsk`): Sage published a reply to this member in the thread that offered a proposal or asked about costs, the member's new comment has concrete details (a number), and Sage hasn't drafted a proposal for them from this thread yet. Then a reply that would ask again (`CLARIFY_NEED`, or any reply that sets a follow-up) is held and recorded in the trail, and if the model gives no charter-grounded `MAKE_PROPOSAL`, code drafts one from the post and the member's own words (`followThroughDraft`). That draft quotes no rules, so it needs no charter quote; it's private to the author and nothing is submitted until they submit it. No extra model call.
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
- Memory: see the P1 memory status below for what consolidation does and doesn't cover.

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

Status (2026-10-04): built and verified, except the items listed as remaining.

- `packages/trpc/src/services/sage-responsibility.ts` resolves a category (`CIRCLE_LEADER`, `COMMONS_ADMIN`, `GOVERNANCE`, `TREASURY`, `SUPPORT`) to people in code: the circle's `Group.leaderId`, or active members holding the matching `AdminRole` (plus `SUPER_ADMIN`). At most two recipients. Unresolved categories fall back to Commons admin, then the platform queue (an alert with no recipient).
- The Commons action agent's `ESCALATE_TO_ADMIN` and the steward's `ROUTE_ALERT` now deliver a `SAGE_ALERT` with an evidence packet (source, quote, why this person, recommendation, due date). Allegations about a named member go only to a Commons admin, privately. Sage takes no disciplinary step.
- Deduplication by subject and category, a 7-day expiry swept by the wake loop, 5 alerts per recipient per day (the rest are held as `QUEUED` with no push), and **Not for me**, which reroutes to the next category and skips that person for that category for 90 days.
- Every routing decision is a `guardian` decision trail visible to admins.
- Members open an alert at `/(authenticated)/sage/alert/[id]`; platform admins see all alerts, including the platform queue, on the Commons AI actions page.
- Tests: `sage-responsibility.test.ts` (10), the routing checks in `sage-steward.test.ts`, Playwright `sage-steward.spec.ts` (routed alert).
- Remaining: there's no designated safety-contact role (disciplinary work is out of scope by decision), no Commons-admin-facing queue screen (the platform queue is visible only to platform admins), and a "high-confidence, high-impact concern" reaching the right role depends on the model choosing to escalate; the routing after that is deterministic.

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

Status (2026-10-04): built and verified, except the items listed as remaining.

- `SageTask` records what Sage is waiting for, from whom, why, and when it will check back. Sage creates tasks itself: after a published reply that asks the member for something (the action-plan template's offer, or `followUpDays` > 0), after an autonomous circle comment, for proposal drafts left unsubmitted for 7 days, and from the steward's daily review. Code clamps the due date to 1–14 days, allows one open task per subject and owner, requires an active member, and won't recreate a task the member dismissed in the last 30 days.
- The wake loop (`sage-tasks.ts` `runSageWakeCycle`) runs every 15 minutes through Trigger.dev (`sage-wake-sweep`), or every 60 seconds inside the API when there's no Trigger key. It claims due tasks with a lease, checks the outcome from app data only (an owner reply, a draft created from the thread, a draft's `submittedAt`, a proposal's status or `votingEndsAt`, an event's `startAt`), and either closes the task, sends one `SAGE_REMINDER`, or stops following up after that one reminder. A reply from the owner wakes the task immediately.
- `Proposal.votingEndsAt` is set when a proposal becomes votable, so voting deadlines are real data. Vote counting is unchanged.
- Members see open and recently closed follow-ups in the Sage hub's **Following** tab and can dismiss any of them. Platform admins see tasks and recent wake runs, and can **Run wake now**.
- Tests: `sage-tasks.test.ts` (14), Playwright `sage-steward.spec.ts` (follow-up journey; in the local run Sage also started its own follow-up from a live reply).
- Remaining: reminders are notifications only (Sage never posts a public reminder comment); proposal and draft status changes are picked up by the 15-minute sweep, not an immediate event wake; accepted suggestions other than replies, comments and stale drafts don't yet create a task automatically.

Suggestion follow-through (2026-10-07, `sage-suggestion-follow-up.ts`). A suggestion that waits on someone's answer no longer sits forever.
- Who is notified: everyone Sage asks already got a `SAGE_SUGGESTION_NEEDS_YOU` alert when the suggestion was made (circle leader approvals, both sides of an introduction). Those alerts, the new reminder and the closed alert now follow the member's **Community** push setting, like Sage's other alerts, instead of "Other".
- Each wake cycle (every 15 minutes) gives every unanswered review one `REVIEW_SUGGESTION` task. Three days after Sage asked, it sends one `SAGE_SUGGESTION_REMINDER` that opens the suggestion. Four days later, if there's still no answer, Sage closes it: the action becomes `DISMISSED`, the unanswered reviews `EXPIRED`, and the timeline says "Sage closed this: nobody answered after Sage's reminder". If the member dismissed the follow-up, or the review predates this change and is already a week old, it closes at 7 days with no reminder.
- Each cycle also closes a waiting suggestion right away when it no longer applies, judged from app data only (no model call): someone it involves left the Commons; the circle was deleted, or has a new leader (for a leader approval); the person asked left the circle; the post Sage would comment on was deleted; Sage already commented on that post; a suggested event time has passed; the leader already has a near-identical proposal draft.
- People who already said yes (for example the first side of an introduction) get an inbox-only `SAGE_SUGGESTION_CLOSED` alert. The follow-up appears under **Following** with an Open button.
- Answering and closing can't both win: `respondToReview` claims the review with a conditional update, and an answer to a closed suggestion is refused with "Sage closed this suggestion, so it can't be answered anymore".
- Privacy: these tasks' trails are admin-only, and they aren't consolidated into memory (the suggestion's own outcome already is, with introductions excluded).
- Closing only dismisses. Nothing is published, decided or spent, and no reviewer changes.
- The "Meet Sage" card's "What Sage can do on its own" now adds "close its own suggestions when nobody answers or they no longer apply".
- Tests: `sage-suggestion-follow-up.test.ts` (19), new cases in `sage-tasks.test.ts` and `sage-trend.test.ts`; Playwright `sage-suggestion-follow-up.spec.ts` (2 journeys, TESTING.md journey 57).
- Remaining: "no longer applies" covers only the deterministic cases above; Sage doesn't notice when a conversation moved on or someone did the thing another way. A closed suggestion isn't re-offered to a new circle leader. Admin-queued Commons reply suggestions (no member review) are unchanged and still wait for a platform admin. The sweep reads at most 200 waiting reviews per Commons per cycle, oldest first.

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

Status (2026-10-04): built and verified, except the items listed as remaining.

- `sage-memory.ts` consolidates finished Sage actions (with reviewer feedback and corrections) and closed tasks from the last 30 days into `AIObservation` rows (`sage_outcome`, `sage_follow_up`) with sources, confidence, a 180-day expiry and a 90-day review date. Each source is remembered once. A newer memory about a near-identical subject (title overlap of at least 0.8) supersedes the older one. The wake loop runs consolidation and the expiry sweep.
- Introductions and escalations (and any ride matches left from before 2026-10-14) are never consolidated: they're about specific people.
- Retrieval (`retrieveSageMemory`) reads only the Commons' member-visible memory and, if given, that one circle's memory; never another circle's. It ranks by relevance and recency, stops at an item and character budget (the steward uses 8 items and 1,200 characters), and audits each read as `SAGE_MEMORY_READ`.
- Used by the Commons action agent, the circle trend agent and the steward. The steward's trail shows the memory it read.
- Tests: `sage-memory.test.ts` (7, including private-circle isolation and the budget), Playwright `sage-steward.spec.ts` (a dismissed follow-up appears in the next steward review's memory).
- Remaining: supersession is by near-identical title, not by detecting a genuine contradiction; "verified observations" from other agents aren't consolidated yet; members can't yet ask Sage directly what happened to a past suggestion.

One outcome list, and memory that follows its source (2026-10-14):

- Before, the circle trend agent read two overlapping lists: its circle's actions straight from `CommonsAction` (8 items, 1,500 characters) and consolidated memory (5 items, 800 characters). It removed duplicates by comparing the first 60 characters. Consolidation remembered each action once and never updated it, so an action approved and then published showed twice, as `[APPROVED]` and `[PUBLISHED]`. A reviewer's rating or correction added after consolidation never reached memory at all. The feed agent and the steward read only that memory.
- Consolidation (`consolidateSageMemory`) now rewrites a remembered outcome when the action's status or its feedback changes. It also looks at actions whose feedback changed in the last 30 days, not just the action itself. Only this memory's own rows count as already remembered, so another agent's observation citing the same action no longer blocks it.
- `loadOutcomeContext` (`sage-memory.ts`) gives the trend agent one list under one budget (8 items, 1,500 characters). The circle's own actions come first, read from `CommonsAction`, which is the authority for their status (at most 6 items and 1,100 characters, so there's room for memory). Consolidated memory fills the rest, and a memory whose source is one of those actions is dropped by id. The trail marks each line Current or Remembered. Scope is unchanged: this circle and the Commons' member-visible memory, never another circle.
- `PUBLISHED` now has its own label in outcome lines.
- No model calls. The trend prompt's outcome section drops from about 2,300 to at most 1,500 characters.
- Tests: new cases in `sage-memory.test.ts` (published after approval shows once; a later rating is picked up; another agent's row doesn't count; one budget with room for memory).
- Remaining: a rewritten memory keeps its original expiry and review dates. The feed agent and steward still call `retrieveSageMemory` directly; they now get corrected memory, but no live read.

Member memory from check-ins, saved without asking and read back (2026-10-14):

- Before, Sage asked "Would you like me to remember that for future check-ins?" and saved only a theme ("transportation access") after a yes. Nothing read it back, and a plain yes never counted toward Commons patterns, so both memory paths stayed nearly empty. The user reversed the consent step (see the decision log).
- **Saved automatically.** `handlePrivateCheckinSignal` (`sage-private-signals.ts`) saves every non-urgent, non-sensitive need in a reply within 14 days of a weekly check-in. The urgent safety reply and the sensitive exclusion run first and are unchanged. Questions about memory ("what do you remember", "forget …") are never saved, and the same theme and stance is saved once per check-in.
- **Short summary.** gpt-5-nano writes a one-line summary ("needs rides to work on weekdays") with structured output `{ isNeed, summary, sensitive }`, from `cleanseUntrustedText` input. The note is dropped if the model flags it sensitive or the summary matches `SENSITIVE_PATTERNS` or the urgent patterns (audited `SAGE_PRIVATE_SENSITIVE_EXCLUDED`), and skipped if the model says it isn't a need. A summary over 80 characters, one that looks identifying (contact details, links, addresses, exact times) or instruction-like, a model error, or no API key falls back to a theme sentence built in code ("a need around transportation access"). Cost is recorded per call (`sage-member-need-summary`).
- **Storage.** `AIObservation` only: `scopeType: "member"`, `PRIVATE_TO_AUTHOR_SCOPE`, 180-day expiry, the summary in `summary`, the theme and `summaryKind` in `details`. Saving is audited as `SAGE_PRIVATE_MEMORY_SAVED`.
- **Counts toward patterns.** New rows set `aggregationBasis: "automatic"` and `aggregationEligible` when the need belongs to exactly one Commons. `MemberSignalDetailsZ` no longer requires `aggregationConsent`. The 5-member and 20%-of-active-members threshold and the one-relevant-Commons rule are unchanged. Rows saved before this under remember-only consent keep `aggregationEligible: false` and stay out, because members were told they would.
- **Transparency instead of consent.** When Sage saves a need it adds one line to its reply: `I'll remember this for our check-ins: <summary>. Say "forget that" anytime and I will.` The Meet Sage card has a "What Sage remembers" section.
- **Read back.** `loadMemberMemory` (`sage-member-memory.ts`) reads only this member's active, unexpired rows from the member-signal writer, keeps one line per theme (the newest wins, so "no longer a need" replaces the need), skips Commons the member left, and stops at 5 items and 500 characters. Every read is audited as `SAGE_MEMBER_MEMORY_READ`. Summaries are cleansed again on the way out. With a focus Commons it returns only needs tied to that Commons. Used by the weekly check-in writer (at most 2 items, focus Commons only, none when the check-in names no Commons), the check-in follow-up and Sage DM replies (notes saved before the message being answered; `memberMemoryScopeForDm`: a DM in a specific Commons sees that Commons, Sage's platform-wide DM sees the Commons the current check-in is about or nothing when that is unclear, and outside a check-in any Commons the member still belongs to). @mentions and every Commons-facing agent never get it. The prompts may refer only to these notes, gently, and never add details. The DM decision trail lists what was given.
- **See and forget.** "What do you remember about me?" gets a numbered list. "forget 2", "forget about my rides", "forget everything" and "forget that" (after Sage's notice or list) mark those themes `DISMISSED`, including older rows about the same theme. Both are answered in code with no model call, scoped to the member, and audited as `SAGE_MEMBER_MEMORY_FORGOTTEN`. A dismissed need drops out of anonymous patterns at the next daily sweep.
- Cost: one nano call per saved need (about $0.00003), not per message. Prompts grow by at most about 500 characters in DMs and about 200 in the weekly message.
- Tests: `sage-private-signals.test.ts` (no consent prompt; sensitive, urgent and model-flagged notes never saved; fallback; untrusted input; dedupe; member scope), `sage-member-memory.test.ts` (member and Commons isolation, DM scope, the budget, summaries read back cleansed, forget), `sage-community-memory.test.ts` (auto-saved needs count, remember-only rows don't), `sage-checkin-followup.test.ts` (memory in the check-in and DM prompts, never an @mention). Playwright `sage-member-memory.spec.ts` (TESTING.md journey 65).
- Remaining: "forget" marks rows dismissed rather than deleting them; they stay until their 180-day expiry and no purge exists yet. Requests are recognized by patterns, so unusual wording goes to the model, which can't forget anything. A need from a multi-Commons member whose check-in names no Commons is saved but tied to none, so it is only shown when the member asks what Sage remembers and never counted in patterns. Only check-in replies are remembered, not ordinary DMs. Theme detection is still keyword-based, so the model's `isNeed` is the main guard against saving small talk; without an API key small talk with a theme word is saved as a theme sentence. Whether the model actually brings up a note is its choice; tests check what it is given.

### P1 — Steward and specialists (from `docs/sage-stewardship-system.md`)

Status (2026-10-04): built and verified.

- Once a day per Commons (at most every 20 hours), the wake loop runs the steward review (`sage-steward.ts`, `gpt-5.6-luna`, at most 8 turns, at most 3 actions, counted against the monthly autonomy limit as `sage-steward`).
- The steward calls read-only, Commons-bound specialist tools (`agents/tools/specialist-tools.ts`): Cadence (`list_open_tasks`, `list_upcoming_deadlines`), Guardian (`get_charter_and_rules`, `check_authority`, `check_message_policy`), Bridge (`find_members_for_need`, `list_published_resources`) and Ledger (`get_proposal_exposure`, proposal budgets only, no treasury data). Each call is an EVIDENCE step in the steward's trail.
- It can propose only `FOLLOW_UP`, `ROUTE_ALERT` and `SUGGEST_INTRODUCTION`; code checks each one (the subject is in this Commons, the category is valid, the circle is in this Commons, both members are active) before anything happens.
- Introductions are consent-first: the member with the need is asked first, the helper only after they accept, and a private **Introduction** circle is created only when both have accepted. 30-day cooldown per pair.
- Fixed scoping gaps: `get_user_profile` requires an active member of the same Commons; `query_event_log` is limited to members of the Commons; knowledge search requires membership for circle scopes.
- Tests: `sage-steward.test.ts` (8), `sage-introduction-execution.test.ts` (2), updated `agent-tools` and `knowledge-tools` tests, Playwright `sage-steward.spec.ts` (introduction journey).
- Remaining: the live steward model's choices are not covered by an end-to-end test (the journey uses a fixed decision); its checks and tools are unit-tested.

### P1 — Core principles and decision-quality comments (2026-10-06)

Goal: Sage's comments help a group make better everyday decisions, from fixed cooperative values rather than the model's mainstream defaults.

Status (2026-10-06): built and unit-tested. Journey 56 passed against the live model; the full mobile suite could not complete locally (see Verification).

- **Core principles** (`services/sage-principles.ts`). Fixed platform rules, not Commons settings, written into the instructions of every Sage agent (Commons feed, circle trend, steward, @mention/DM reply). They put the group first, keep money inside the Commons when the cost is fair, build shared ownership, start from what members already have, don't assume access to cars, banks or credit, and never treat hardship as a personal failing. They also list mainstream advice Sage must not give: individual budgeting tips when a group option exists, credit-building or financial products, cheapest-is-best, and hardship as an individual problem. A Commons' charter adds to them and can't override them. `sage-principles.test.ts` fails if any Sage agent leaves them out.
- **Decision-moment templates** next to Action plan (`sage-reply-templates.ts`): Where we are (agreed / still open), Trade-off (options laid out evenly, with the fact that decides it), Missing piece (specific facts and who can supply them), Before we decide (who's affected and hasn't been heard; groups, never names). New voice rules: don't take sides between members, and comment only when Sage adds a fact, structure or a missing voice. Sage may now also offer to "summarize where we've landed" and "check back with you on a date you pick", both of which it can already do.
- **Wider grounding** (`services/sage-grounding.ts`). Every Commons feed action names `evidenceSource`: `charter`, `thread` (the member's own words), or `checked` (something a read-only tool returned in the same run). Code confirms the excerpt is really in that source. Replies about rules, votes, proposals, membership, discipline or the Commons' own money, plus charter corrections, mission-alignment replies and proposal drafts, still need a charter quote, enforced by a keyword check in code. The admin approval path follows the same rule; for other replies the approving admin is the human check.
- **Relevance check.** A small, independent model (`gpt-5-nano`, no Sage memory or instructions, feature `sage-relevance-check`, counted toward the autonomy limit) checks that the reply and its evidence are on topic before Sage publishes on its own. It runs only when every other check has passed, including for a quote from the post itself, because a real quote can still sit under a reply that answers something else. Each check costs about $0.0001. If the check fails or can't run, nothing is published: a Commons reply is queued for review, and a circle comment goes to the circle leader. The check is recorded in the decision trail.
- **Read-only tools for comment agents** (`agents/tools/comment-tools.ts`): `search_commons_documents` (this Commons, plus the circle for trend windows), `list_commons_resources` (published resources), and `count_members_offering` (counts only; under 2 is reported as "fewer than 2", and a skill or resource is named only when at least two members list it). They never return member names or ids, because results can end up in a public comment and introductions stay consent-first. Calls are capped by `maxTurns` (6 for the feed batch, 4 for a trend window) and recorded as trail evidence.
- Tests: `sage-principles.test.ts` (3), `sage-grounding.test.ts` (7), `comment-tools.test.ts` (4), new cases in `sage-reply-templates.test.ts` (4, including that only Action plan bullets become a follow-up) and `sage-stewardship.test.ts` (an off-topic comment goes to the leader). The e2e Sage-suggestion fixture passes a fixed relevance judge so it stays deterministic.

- Fixed while testing: a reply using any template turned its bullets into a follow-up task. For a Trade-off, that meant waiting for the member to "Library: free…". Only Action plan bullets are asks now (`followUpExpectation`). Also, the first version of the stay-quiet rule made Sage skip about 1 in 3 unanswered questions; it now says an unanswered question or choice is worth helping with. After the change, 5 of 5 live runs replied with an even trade-off. Then CI caught that the rules check also matched Sage's own offer ("I can draft a small proposal so members can vote"), which dropped every Action plan reply that quoted the thread (`sage-follow-through.spec.ts` failed). Sentences with "I can" are now left out of that check, and both posts were verified live again.
- Fixed after CI (2026-10-07): with `thread` evidence allowed, the model quoted the member's own details as the evidence for a follow-through `MAKE_PROPOSAL`, and the grounding check (proposals stay charter-only) discarded every draft, so `sage-follow-through.spec.ts` failed in CI and 3 of 3 times locally. The prompt now names the charter-only action types from `CHARTER_ONLY_ACTIONS` and says the member's details go in the draft, not the evidence, and the follow-through rule says the same. Two more failures in that journey came from the first post: Sage sometimes chose NO_ACTION for an unanswered question, or drafted an empty proposal before the member gave any details. The prompt now counts an unanswered question as worth helping with, and drafts a proposal only once the item gives some details (an amount, a number or a date); after Sage has offered, it drafts from what the member gave instead of holding out for more. The journey's results also drifted from run to run because `cleanup-post` left Sage's follow-up tasks and the Sage memory written from them, and the next identical post retrieved them ("[PUBLISHED] … request remaining cost details"); cleanup now removes the post's tasks and that memory too. Locally, before the fix the journey failed 3 of 3 and later 6 of 6 times; with the final code it passed 6 of 6 on 3 workers. A later batch of all the Sage journeys ran with load averages above 60 and failed mostly on page loads (`ERR_NETWORK_IO_SUSPENDED`, `ERR_ABORTED`), so it says nothing either way; CI is the check that matters. The proposal still needs a charter quote; that boundary didn't change. Separately, three E2E specs that flip the account-wide "Show Sage decision trails" setting now take turns through `e2e/support/exclusive.ts`; running in parallel, they turned the setting off under each other.

- Fixed after CI (2026-10-07, second time): `sage-follow-through.spec.ts` still failed its first attempt in every CI run and all three attempts twice on an unrelated PR. The traces showed why: Sage's first reply to the shared-drivers post offered to draft a proposal in only about half the attempts (others offered to "help compare" or "summarize the options", or just asked), and after the member replied with days, stops and cost, Sage asked again ("We can't compare a shared-driver arrangement yet…") in all six failed attempts. The follow-through decision is now made in code (see Follow-through above), so it no longer depends on two model choices lining up. Unit tests use Sage's real first replies from those runs. Locally (gpt-5.6-luna, 3 workers, no retries) the journey then passed 9 of 9 on the first attempt in about 28s each, and all nine drafts came from the model, now that the item is marked `answersSage`. With the model's draft switched off by a temporary local edit, it passed 2 of 2 on the code-built draft, and Sage posted no second ask. `pnpm -F @repo/trpc test` (692 passed) and `pnpm -F @cahootz/mobile type-check` passed. The full mobile suite wasn't run locally; CI runs it.

Verification (2026-10-06, local stack, `gpt-5.6-luna` + `gpt-5-nano`):

- `pnpm -F @repo/trpc test`: 71 files, 676 tests passed. `tsc` for `@repo/trpc` and `pnpm -F @cahootz/mobile type-check` passed.
- `sage-decision-comments.spec.ts` (journey 56) passed on the final code and on an earlier run; it failed in runs made before the stay-quiet wording fix, and in runs cut short by the machine.
- Live relevance check: a charter quote about proposals in reply to "Can I borrow a ladder?" was judged off topic; the same quote in reply to buying a $3,000 van was judged on topic. About $0.0001 per check. The feed reply itself cost about $0.001.
- The full `pnpm test:e2e:mobile` run did not complete. The machine's disk was 99% full (5.4 GB free) with load averages of 11-28; Metro took up to 120s per bundle and then crashed with "JavaScript heap out of memory" at 8 GB. Every failure was a page-load timeout, `ERR_ABORTED` or `ERR_CONNECTION_REFUSED` on :8081, not an assertion about Sage. Rerun the suite on a machine with free disk (or CI) before release.
- The local `soulaancoop` database was missing `CoopConfig.familySetup` (from main's family-setup work), so every Sage run failed locally until that one nullable column was added with `prisma db execute`.

Known limitations:

- Whether Sage uses a decision template, and which one, is the live model's choice; journey 56 checks grounding and relevance, not the template.
- The charter-required keyword check is deliberately broad. A false match only means the reply needs a charter quote, but an everyday reply that mentions "vote" or "proposal" will be discarded unless it has one.
- `checked` evidence isn't saved on the action, so an admin approving a queued reply can't re-verify a tool excerpt; they review the text themselves.
- The circle trend agent's comments still have no evidence field. The relevance check there compares the comment with its target post and the stated reason.
- The @mention/DM agent now helps with everyday decisions from the conversation, but has no structured evidence check (it is member-requested and already has the output safety check). Since 2026-10-16 both channels run on gpt-5.6-luna with the same tools.
- `search_commons_documents` reads `KnowledgeDocument`, but no mobile or web screen calls `knowledgeBase.uploadDocument` yet, so in practice it finds nothing until documents are added. It reads only COMMONS and PUBLIC documents (plus CIRCLE ones for a circle), never PRIVATE ones. The older `search_knowledge_base` agent tool still applies no visibility filter.
- Not yet built: learning from how leaders edit suggested comments before approving them (see Next).

### P1 — Personable, plain voice (2026-10-16)

Goal: everything Sage says sounds like a friendly, sharp neighbor, not a system, a consultant or a form (AGENT.md, "Voice: Personable and Plain"; suggestions in `docs/voice-audit.md` on the `claude/sage-relatable-tone-e3a226` branch).

Status (2026-10-16): built and verified locally (gpt-5.6-luna), except one steward journey blocked by local data (see Verification).

- **One shared voice block.** `SAGE_VOICE` sits next to the core principles in `sage-principles.ts` and is returned by `sageCorePrinciplesInstructions()`, so the reply agent, Commons Action, Trend, Steward, check-in follow-up and weekly check-in agents all get it. It asks for everyday words, short sentences, contractions and "we/you", allows a little warmth, rules out fake excitement and over-apologizing, gives one short example reply, and says a friendly tone never softens a fact, a risk, a cost or a "no". The per-agent "trusted community organizer" lines are gone. `SAGE_VOICE_RULES` no longer says "No greetings or sign-offs" or "Lead with your position"; it says to open with what Sage thinks and why, like talking to a neighbor, and to skip formal greetings. The reply agent is now framed as "a friendly organizer who helps out in {Commons}", and it still says it's an AI if asked. The trend agent's posts are "direct but friendly", and Community Observer summaries read like a quick catch-up.
- **Canned text rewritten** (no model calls): the reply fallback, input refusals, the safety reply and its two follow-ups, the memory list, footer, date format ("Oct 10") and "forget" reply, the promised check-back, introduction offers and the "did it help?" ask, the resource invitation, the proposal-draft-ready notifications, the thanks shout-out, suggestion reminders and closing reasons, the community-question goal line, weekly check-in and follow-up fallbacks, and the decision-trail steps members can read ("Checked our charter (version N) and our N goals", "Sent a ready-made reply", "Something went wrong, so Sage didn't act").
- **Meaning kept.** The safety reply still tells the member to call their local emergency number, says Sage can't send help itself, and shares nothing without their OK. A "yes" after the offer is still matched in code; the match now accepts the new wording and the old one (`SAFETY_OFFER_MARKERS`), so offers sent before this change still work. The memory footer still says notes are only used in private chats and counted, without a name, in Commons-wide totals once enough members share a need. Yes/no parsing, consent gates and approval paths are unchanged.

Verification (2026-10-16, local stack):

- `pnpm -F @repo/trpc test`: 89 files, 881 tests passed (new: the voice block in `sage-principles.test.ts`; the safety reply still names emergency services, and a "yes" after the new or the old offer wording routes a support contact, in `sage-private-signals.test.ts`). `tsc` for `@repo/trpc` and `pnpm -F @cahootz/mobile type-check` passed.
- Smoke tier: 18 of 18 passed.
- Changed specs and affected `@sage` journeys: `agent-decision-trails`, `sage-follow-through`, `sage-member-memory`, `sage-proactive`, `sage-suggestion-follow-up` (both journeys), `sage-weekly-outreach`, `sage-reply-parity`, `sage-decision-comments`, `sage-trend`, and the introduction journeys in `sage-steward` passed. `sage-reply-parity` failed once on a trail detail that this change doesn't touch and passed on the rerun.
- `sage-steward.spec.ts`'s follow-up journey couldn't run locally: the worktree's cloned database holds `CommonsAction` rows of type `COMMUNITY_RHYTHM` from another branch, which main's enum doesn't have, so `consolidateSageMemory` errors before Sage acts. CI's fresh database is the check for that journey.

Known limitations:

- The model-written need summaries are still third-person fragments ("needs rides to work on weekdays"); changing that would mix two styles in stored memory, so it waits for a migration of existing rows.
- The proposal engine and newsletter prompts don't load `SAGE_VOICE` yet, and their score/rubric language still reaches members. Deferred (2026-10-16): neither is heavily used yet.
- A few yes/no asks in `sage-member-actions.ts` (introduction from a profile match, the helper's shout-out consent) still end with "Reply yes or no."
- Tone is the live model's choice; tests check the instructions and the fixed text, not how warm each model reply reads.

### P1 — Thread facilitation and the pre-vote summary (2026-10-16)

Goal: Sage acts like an assistant community manager inside active threads, and code (not the model's template choice on one comment) decides when a thread needs it.

Status (2026-10-16): built and verified (unit tests, journey 68's original two scenarios, the smoke suite and the affected @sage journeys; see Verification). The social scenario is written and statically verified but still needs a live local run.

- **Deterministic trigger** (`services/sage-facilitation.ts`). On every new comment code reads the thread and decides, with no model call, whether it needs Sage. In priority order:
  - *deferral*: the newest comment puts it off ("let's revisit next week", "can we decide later?", "table this for now"). Sage doesn't comment. It creates a `SageTask` (subject `thread_revisit`, owned by the member who deferred, so it shows under their **Following**), due 1–14 days out from the words used (tomorrow 1, a weekday, next week 7, next month 14, otherwise 3). One open revisit per thread.
  - *unanswered_question*: a factual question ("what time…", "how much…", not "should we…") that a later comment shrugs at ("not sure", "no idea") or the asker repeats, with no answer after that. Missing piece template.
  - *ready_for_proposal*: three or more members back a shared purchase or project, with a number in the thread. MAKE_PROPOSAL, drafted for the member who raised the idea.
  - *disagreement*: two or more members push back ("I'd rather", "I don't think", "but what about") across three or more comments (the post doesn't count, so one pushback in reply isn't enough). Trade-off template.
  - *narrow_decision*: the newest comment settles it ("let's go with") with only one or two members in a thread of four or more turns. Before we decide template (groups, never individuals).
  - *busy_thread*: eight member turns, or four participants and five turns, since Sage last spoke, with no decision in the last two. Where we are template.
- **Limits.** Triggers count only turns since Sage's last comment in the thread. No trigger fires within 12 hours of a Sage comment (deferrals still schedule). Each trigger (kind plus the comment that tripped it) is claimed once in `CommonsContentScan` (`thread_facilitation`), and any claim blocks another for 12 hours whatever came of it, so a hot thread costs at most one facilitation call per 12 hours. Catch-up scans never facilitate.
- **What the model is told.** A flagged item carries `facilitate`: the help that fits and its template. The instruction says to use only what members said and what Sage can check, never take a side, name an affected group only when the thread or a checked source supports it, and never say how to vote. Templates stay suggestions; the decision trail records "Code flagged the thread: …" (or "Didn't step into the thread" with the cooldown reason).
- **Social facilitation.** Code, not the model, may add one brief opening to a helpful reply. A plan ready for a proposal gets a contribution-focused compliment; a harmless busy thread gets a deterministic compliment or mild process joke. Disagreements, narrow decisions and discussions that may involve safety, hardship, discrimination, grief, moderation or other high-stakes subjects stay neutral. The model is explicitly forbidden from adding another joke, compliment, greeting or flourish, and proposal drafts never get one. The choice or neutral-tone policy appears in the decision trail.
- **Everything that already applied still does.** Grounding and the charter-only rule (proposals and rules, votes and money need a charter quote), the 75% confidence gate, the Auto-reply switch, the output check, the relevance check, one reply per source comment, decision trails.
- **Commons feed.** No extra model call: the comment already goes to the Commons action agent, which now gets the facilitation hint. A deferral holds any reply.
- **Circles.** New: comments on ordinary circle posts (not the General feed, direct messages or welcome lounges) are checked too. Only a flagged thread costs a model call (the same agent, with that circle's memory and documents); a deferral costs none. A reply that passes every gate publishes as in the feed. Anything else becomes a `SUGGEST_ACTION` the circle leader approves: a `comment_on_post` tied to the triggering comment (`facilitationOf`, which lets Sage comment again in a thread it spoke in before, but not twice after the same comment), or a `draft_proposal` the leader owns. Circle trails are visible to the circle only. Resource logging and invitations aren't taken from circle threads.
- **Revisit.** When a `thread_revisit` task is due, the wake loop closes it if any member commented since. Otherwise Sage re-reads the thread and posts a Where we are summary (kind `revisit`, judged as current work), through the same gates, once. No push reminder.
- **Before the vote** (`services/sage-pre-vote.ts`, a wake-cycle step). For each votable proposal closing within 48 hours with at least two member comments: one gpt-5.6-luna call returns points under agreed, still debated, facts we don't have, and affected perspectives the discussion has not addressed. Every point, including an affected perspective, needs an exact supporting quote in a comment or the proposal; code also rejects voting advice, names of people in the discussion and statements of rules. Sage never infers anyone's identity or who a commenter represents. Code then renders a fixed frame ("Voting on … closes Saturday, Oct 17. … I'm not taking a side; how to vote is up to each of you."), at most two points per section, within 1,200 characters. It posts as a Sage `ProposalComment` (wallet `sage:bot`, shown with Sage's face and "AI helper") only with Auto-reply on, 75%+ confidence, a passing output check, no steering in the discussion and a passing relevance check; otherwise it's a `SUMMARIZE_DISCUSSION` action a platform admin can approve (refused once voting closes). One per proposal (`CommonsContentScan` claim plus a unique `replySourceKey`). Members receive the summary through the account-wide Sage notification category, and the trail (agent `sage-pre-vote`) shows on the proposal page for members with trails on.
- **Cost.** Commons feed facilitation: none added. Circle facilitation: at most one luna call (about $0.001) plus one nano relevance check (about $0.0001) per thread per 12 hours, only when flagged. Revisit: the same, once per deferral. Pre-vote: one luna call plus one nano check per proposal, once. All counted toward the per-Commons autonomy limit (`sage-pre-vote` added to `AUTONOMOUS_SAGE_FEATURES`); none runs when it's reached.
- Migration `20261016020000_sage_discussion_summary` adds `CommonsActionType.SUMMARIZE_DISCUSSION`.

Verification (2026-10-16, local stack: clone `soulaancoop_facilitation`, API :3014, web :8100, gpt-5.6-luna + gpt-5-nano):

- `pnpm -F @repo/trpc test`: 94 files, 956 tests passed (31 skipped). New coverage includes `sage-facilitation.test.ts`, `sage-facilitation-flow.test.ts`, `sage-pre-vote.test.ts`, `sage-community-rhythm.test.ts`, and the revisit cases in `sage-tasks.test.ts`. Thread fixtures (`__tests__/fixtures/facilitation-threads.ts`) are written in members' register and include Sage's real reply from the shared-drivers CI runs; no local database had real multi-member threads, and production data isn't used.
- `tsc` for `@repo/trpc` and `pnpm -F @cahootz/mobile type-check` are clean.
- Smoke suite (`--grep @smoke`, 1 worker): 18 passed. Two earlier attempts timed out (a 5-minute page load, then 30-minute tests) while other sessions' suites ran at the same time with load averages up to 300 and swap nearly full; with the machine to itself it passed in 3.8 minutes.
- Journey 68 (`sage-facilitation.spec.ts`, live model): the original two tests passed on the final core code. The social-facilitation journey was added afterward; Playwright discovers it successfully, but the local worktree could not run the API because its required environment variables were unavailable.
- `sage-follow-through.spec.ts` and `sage-decision-comments.spec.ts`: passed on the final code (and on the code before the threshold fix).
- Found and fixed by the journey:
  - The first version of journey 68 ran in the Commons feed. Sage's ordinary per-comment analysis answered the "library or homes" post at once with a trade-off, and the 12-hour cooldown then correctly blocked a second one, so the trigger never fired. The journey now runs in a circle, where only code's trigger starts Sage. It accepts either outcome of the gates: Sage posts by itself, or the circle leader approves the comment in the app.
  - The disagreement trigger fired on the post plus one pushback in reply. It now needs three comments (the post doesn't count), with a unit test for the one-reply case.
  - The fixture's seeded proposal lacked `missingData[].why_needed`, so the proposal page failed output validation.
- Seen during the runs: when a test's cleanup deleted the post while Sage was still analyzing it, publishing failed on the missing post (recorded as "Analysis failed") and left a pending action for a deleted post. This is pre-existing behavior of the shared publish path, not specific to facilitation.

Known limitations:

- Detection is pattern-based English. "Unanswered" needs a visible shrug or a repeated question; a question that's simply ignored isn't caught (the existing unanswered-needs sweep covers posts with no reply at all). Disagreement and agreement are keyword cues, so sarcasm or polite disagreement can be missed.
- Whether Sage actually comments once flagged is still the model's choice (it may return nothing), and the template is a suggestion.
- In the Commons feed, Sage may still reply to individual comments as before; the 12-hour cooldown applies only to facilitation.
- A circle leader who approves a facilitation comment late may post it after the thread moved on; the existing suggestion follow-up closes it if Sage commented in the thread since.
- A failed pre-vote run isn't retried for that proposal.

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
- 2026-10-04: Specialists (Cadence, Guardian, Bridge, Ledger) are read-only tools the one steward model calls, not separate agents.
- 2026-10-04: New autonomous actions (follow-ups, routed alerts, introduction offers) go live within the monthly limit and safety checks. No conduct review or disciplinary action. Ledger reads proposal budgets only.
- 2026-10-05: Members are told plainly who Sage is.
- 2026-10-16: Sage's voice is a platform rule loaded with the core principles: a friendly, sharp member of the Commons, plain words, never softening a fact or a "no". Tone changes never loosen consent, privacy, governance or money rules.
  - The Sage screen shows a "Meet Sage" card (`apps/mobile/components/sage-intro.tsx`) until it's dismissed. It says Sage is an AI helper and not a person, what it does on its own (replies, reminders and alerts, checking back), and what always waits for a person (proposals, money, membership, group decisions). It also says Sage can make mistakes.
  - Sage settings always shows the card, and the suggestion and alert pages carry a one-line version.
  - This is copy only; no autonomy changed. If the Autonomy Boundaries change, update this card in the same change. Verified by `onboarding-usability.spec.ts` (TESTING.md journey 42).
  - Sage's posts and comments in the feed, post page, and event comments carry an "AI helper" tag (`components/ai-badge.tsx`). The commons feed APIs now return `authorIsAi` from `User.isBot`. Verified in `sage-stewardship.spec.ts` (journey 33).

- 2026-10-06: Sage's core principles are platform-wide and fixed in every Sage prompt; no Commons can change them. Sage must not fall back on mainstream US individual-finance advice.
- 2026-10-06: Everyday decisions may be grounded on the thread or a checked source; rules, votes, membership, discipline and the Commons' money still require the charter. An independent relevance check gates autonomous publishing.
- 2026-10-11: `AIObservation` is the canonical store for Sage's generated narrative memory. Check-ins and conversations remain source interactions; only durable outcomes, confirmed preferences, corrections, and useful patterns become sourced, scoped observations. Do not add a parallel generic Notes or Sage-memory table unless `AIObservation` demonstrably cannot represent the required semantics.
- 2026-10-11: Weekly outreach and Commons hypotheses are implemented behind default-off flags. The daily outreach sweep assigns a stable weekday, rotates multi-Commons members through one named context, and uses the existing Sage DM/push path with weekly idempotency. The daily memory sweep dispatches an isolated run per Commons. Private signals require separate remember/anonymous-aggregation consent; sensitive and urgent material is excluded before extraction. Commons hypotheses start `CANDIDATE`/`SAGE_INTERNAL`, bind to config ID and version, resist repeated-member and correlated-burst inflation, and distinguish `UNSUPPORTED` from `DISMISSED`. Thirty-/ninety-day impact observations link reviewable actions through `CommonsAction.originObservationId`. (Superseded 2026-10-13: all three flags were removed; see below.)
- 2026-10-13: Sage reaches out on its own, within one weekly limit.
  - **Limit:** at most 7 outreach messages per member per 7 days (`PROACTIVE_WEEKLY_LIMIT`, `sage-proactive.ts`), the weekly check-in included.
    - Only messages Sage starts count. They all go through `sendProactiveSageMessage`, which stamps a `sage-<kind>:<key>` system key.
    - Replies in a back-and-forth, confirmations after a yes, and relays of replies to the member's own post have no system key, so they never count.
    - A held message is audited as `SAGE_PROACTIVE_LIMITED`. A check-in skipped by the limit makes no model call.
  - **Promises:** `schedule_check_in` is in the member toolkit, so every agent that has it can use it (check-in follow-ups, DMs). The steward review has `schedule_member_check_in`, at most 3 per review.
    - One open promise per member (`SageTask` subject `member_conversation`).
    - When due, it's closed if the member already talked with Sage since. Otherwise Sage sends "Checking back like I promised: …?" with no model call.
    - At the limit it waits a day, up to 3 times. Trails are admin-only.
  - **Unanswered needs:** a wake step (`sage-unanswered-needs.ts`). A Need/Ask feed post 48 hours to 14 days old with no reply from anyone but its author gets one likely helper (`findMembersForNeed`) asked privately to take a look.
    - Limits: at most 2 helpers per post, a week apart; at most 1 need per helper per week; at most 5 asks per Commons per day.
    - Deterministic, no model call.
  - **Thanks:** when both people accept a Sage introduction, a 5-day `introduction_outcome` task is scheduled. Then Sage asks the person who needed help "Did it help?".
    - Yes runs `thank_helper`: it records `HELP_CONFIRMED` plus a `member_help_outcome` observation, thanks the helper privately, and asks to share.
    - The helper's yes runs `share_win`: a Win post from Sage naming only the helper, never what the other member needed.
    - No answers end the chain (`HELP_NOT_CONFIRMED`).
  - Verified by unit tests (gate, promises, deferral, needs, thanks chain) and a live probe of all three flows against the local database through the real message path, cleaned up afterwards.
  - Not yet: a member opt-out for Sage's outreach (deferred), helper matching beyond profile keywords, and an E2E run (the spec is written and runs in CI).
- 2026-10-13: Sage can act for a member from a private conversation (a check-in or a DM) through a reusable toolkit, `buildMemberActionTools` (`agents/tools/member-action-tools.ts`). Any agent can be handed it. The check-in follow-up agent and the DM agent have it; @mentions in the feed don't. (Changed 2026-10-16: @mentions get most of it; see below.)
  - `list_my_commons` and `search_opportunities` are read-only. The search covers matching posts, approved stores, published resources and upcoming events in the member's own Commons, and returns no names.
  - `propose_post` and `suggest_introduction` only propose. Each saves a normal `CommonsAction` + review (hash-checked, audited, also visible in the member's Sage suggestions), and code appends the exact ask to Sage's reply after the reply's safety check.
  - A plain "yes"/"no" to Sage's latest ask is handled in code (`handleConversationConfirmation`) with no model call. Anything longer goes back to the model. Older unanswered asks are superseded, so a "yes" only ever answers the newest one, and only while that ask is Sage's latest message (3-day limit).
  - On yes, `post_for_member` publishes from Sage's account without the member's name. Code refuses a post that contains their name, handle or email, or a link or @mention. The limit is one post per member per day. Sage confirms in the conversation and schedules a follow-up (`SageTask` subject `member_post`, 3 days, changeable with `follow_up_later`). If nobody has answered by then, Sage nudges the member in the conversation, not with a push.
  - When someone comments on the post, `relayReplyToMember` quotes the reply to the member privately and offers the existing two-sided introduction. This happens once per commenter.
  - The memory offer ("Would you like me to remember that?") is now held back when Sage's reply already asks a question, so a "yes" can't mean two things.
  - Verified with a live gpt-5.6-luna run: search, then asking which Commons, then the anonymous proposal, then yes, then the post published as Sage, then a reply relayed, then yes, then the helper asked. Plus 11 unit tests.
  - Limits: posting with the member's name isn't supported yet (always anonymous). Tool steps aren't recorded in the decision trail. Search is keyword-based (ILIKE). The member-matching for introductions uses profile keywords only. No mutual-match system exists in the repo despite earlier notes.
- 2026-10-13: Platform admins can send a Sage check-in to any active member now from **Agent Playground → Sage Weekly Check-in** (`/portal/admin/agents`). It searches members by name or email, sends with its own `sage-weekly:<user>:manual-<ms>` key (so the scheduled weekly check-in is unaffected), and writes a `SAGE_OUTREACH_SENT_MANUALLY` audit entry with the admin as the actor. Replies get the normal check-in follow-ups. The same panel lists each member's latest check-in (time, scheduled vs manual, count, last message, whether they replied), read from the `sage-weekly:` system keys, so no new table. It is a playground entry, not a registered agent, because it sends a real message and needs the admin's identity for the audit. Costs one small luna call per send. Limits: history reads the latest 2,000 check-ins, and members never reached aren't listed. Ported from uncommitted work in the `sage-reach-admin-trigger` worktree, which only allowed sending to the admin themselves.
- 2026-10-13: The `sage_community_memory` and `sage_private_safety_response` flags were removed; both behaviors are always on. The daily community memory sweep now consolidates every active non-demo Commons. An urgent disclosure in a check-in reply always gets the fixed safety reply ("contact local emergency services; want help finding a trusted person?") instead of falling through to the DM agent. If the member says yes, Sage routes a private SUPPORT alert to the relevant Commons without the disclosure. Sensitive but non-urgent disclosures are still excluded from memory. Limitation: urgent detection is keyword-based (`URGENT_PATTERNS`), and the safety wording has not had a policy or legal review.
- 2026-10-12: Weekly check-ins run by default; the `sage_weekly_outreach` flag was removed. The daily sweep sends each active member one check-in on their assigned weekday, catching up for at most 48 hours, so a deploy never backfills older weeks. Members have no setting to opt out of check-ins yet.
- 2026-10-16: Runtime feature flags were removed from the application. Migration `20261016010000_remove_feature_flags` drops the obsolete `FeatureFlag` table; weekly outreach, community memory, the bounded private-safety response, hybrid order details, SC rewards, and the wealth-fund screen remain always on.
- 2026-10-12: Sage follows up on weekly check-in replies, plain DMs use a cheaper model, and a message guardrail runs before every Sage reply model call.
  - A reply within 14 days of a weekly check-in goes to `sage-checkin-followup.ts` (gpt-5.6-luna, `SAGE_CHECKIN_MODEL`) instead of the charter-only reply agent. It is short and conversational, with at most one question. Sage sends at most 5 replies per check-in (`MAX_CHECKIN_FOLLOWUPS`), and the 5th closes without a question. It still runs through `traceSageReply`, so steering, output checks and the decision trail apply. Safety and sensitive-topic handling in `sage-private-signals.ts` runs first and is unchanged. If the model fails or returns nothing, Sage sends a fixed follow-up, so a member who answered is never left without a reply.
  - After the cap, and for any DM to Sage that isn't a check-in reply, `sage-commons-reply` runs with `channel: "dm"`. (Superseded 2026-10-16: DMs and @mentions now share one model; see below.)
  - `checkSageInput` (`untrusted-input.ts`) refuses messages over 1,500 characters, code, math problems, encoded or mostly-symbol text, and steering, for DMs, check-in replies and @mentions alike. Sage sends a fixed reply with no model call, the trail records the reason, and `SAGE_INPUT_REFUSED` is audited with the reason and length only, not the content. Refused messages count toward the check-in cap.
  - Cost: at most 5 small luna calls per member per check-in week, plus nano for ordinary DMs (about 30× cheaper than gpt-5.2). These are member-initiated, so they are not counted against the Commons autonomy limit; the cap is the bound.
  - Limitations: the guardrail is pattern-based and biased toward letting messages through, so unusual phrasing of code or math can still reach the model, and some legitimate messages (e.g. three lines ending in `;`) may be refused. The cap counts Sage's messages since the check-in, not distinct topics. Nano may answer charter questions in DMs less well than gpt-5.2 did.
  - Verified: `pnpm -F @repo/trpc test` (751 passed), the trpc and mobile type-checks, and `sage-weekly-outreach.spec.ts` (member answers → follow-up visible after reload; code → guardrail reply). With a working key the E2E follow-up was a live gpt-5.6-luna reply (`AICostEvent` SUCCESS), and the code snippet produced no model call. With the earlier invalid key, the same journey passed on the fixed follow-up.
- 2026-10-14: Reverses the 2026-10-11 rule that private signals need separate "remember" and "anonymous aggregation" consent. Decided with the user: Sage saves non-sensitive needs from check-in replies without asking, as a short summary, and they count toward anonymous Commons patterns behind the existing thresholds. Transparency (a notice when Sage saves something, the Meet Sage card) and a forget path replace consent. Urgent and sensitive material is still never saved. Needs are read back only in the member's own private conversations and weekly check-in. Rows saved before this under remember-only consent stay out of patterns. `CommonsAction` is the authority for an action's current status; consolidated memory only adds what a live read can't show.
  - Needs are never dropped for lacking a theme (user, 2026-10-14). The summary model now picks the theme from a fixed list, with keywords only as its hint and the fallback.
    - Four themes were added: childcare and caregiving, jobs and work, learning and school, and internet and devices. Over-broad keywords ("time", "community", "share", "support", "resource") were removed, so everyday replies aren't misfiled.
    - A need that fits no theme is saved as `other_need` ("something else"). It's read back in the member's own conversations, one item per note, and is never deduplicated within a check-in.
    - It never counts toward Commons patterns and never triggers a Commons question, because unrelated needs filed together would look like a shared one.
    - The four new themes have their own group-option question templates in `sage-community-question.ts`.
  - The only replies not saved are urgent or sensitive ones and replies the model says aren't a need. If the model fails or there's no API key, the need is saved under its keyword theme, or as "other" with a sentence written in code.
  - Cost: the nano summary call now runs on every non-sensitive check-in reply, not only keyword matches. That's at most 5 per member per check-in week, about $0.00003 each.
  - Limitation: during a model outage, a reply that isn't a need (for example "thanks!") is saved as "other", because nothing can tell it apart. The member sees it and can forget it.
  - Verified: `pnpm -F @repo/trpc test` (872 passed) and the mobile type-check. New cases are in `sage-private-signals.test.ts` and `sage-member-memory.test.ts`.
- 2026-10-13: Agent operations are no longer allowed to fail or pause silently. The always-on weekly-outreach sweep sends a daily receipt through the existing Slack webhook with each due member and the actual outcome, including the shared proactive weekly limit. Its latest result is stored as platform operational health, so an independent hourly watchdog repeats a channel-level alert while the model configuration, outreach sweep, Commons auto-reply setting, autonomy budget, newsletter schedule, or Sage wake cycle is off, paused, stale, or failed.
- 2026-10-14: Community hypotheses go to the whole Commons as an open question, never to one person. Before this, the steward's prompt (added 2026-10-11 without a recorded decision) let it send a hypothesis to a Commons admin as a private alert, so one person could hold a pattern built from members' private check-ins. Nothing linked what Sage did back to the hypothesis either, so every 30- and 90-day impact review recorded `NO_ACTION`, which counted against the hypothesis.
  - Decision (user, 2026-10-14): no steward, admin or other single person checks or views a hypothesis. The steward agent no longer receives hypotheses at all (prompt, input and trail).
  - When a hypothesis is `ACTIVE`, the daily community memory sweep posts one question from Sage in the Commons feed (`sage-community-question.ts`). The text is a fixed template per theme that asks what the group could do together. It has no counts, no quotes, no model-written text, and nothing hinting at private check-ins. Code adds the matching mission goal only if it passes the output check. No model call.
  - Limits: at most one question per Commons every 14 days, and the same theme at most once in 90 days. Each hypothesis is asked about once (a unique key on the hypothesis id). Commons-wide feed only, never a circle. The existing thresholds still apply: at least 10 active members, and the greater of 5 people or 20%.
  - Housing, belonging and safety themes are included, but they're worded as group options (home-repair help, a standing meal, travelling together to evening events), never "who is struggling". This is easy to narrow if needed.
  - The question is an `ASK_COMMONS` `CommonsAction` (migration `20261014010000_sage_ask_commons`) linked to the hypothesis by the existing `originObservationId`, with `QUESTION_POSTED` in its timeline. It isn't folded into Sage's own outcome memory, so the steward doesn't see it there either.
  - Impact reviews judge the question by distinct members (not Sage) who replied, reacted or supported it. Two or more is `HELPFUL`, none or a removed question is `NOT_HELPFUL`, and one is `INCONCLUSIVE`. Only `NOT_HELPFUL` reviews discourage a hypothesis (two stop Sage acting on it); `NO_ACTION` no longer does.
  - A platform admin can remove the question from the web Commons AI actions page (**Remove Sage's question**). The action becomes `DISMISSED` with `QUESTION_REMOVED` in its timeline.
  - The "Meet Sage" card now says Sage may ask the whole commons an open question when a need keeps coming up.
  - Leaders and admins don't edit hypotheses (a product assumption), so "learn from leader edits" doesn't apply to them.
  - Verified:
    - `pnpm -F @repo/trpc test`: 833 passed, 30 skipped. The trpc and mobile type-checks are clean, and the changed web admin page has no type errors.
    - New unit tests: `sage-community-question.test.ts` (templates, cooldowns, idempotency, answer counting), plus new cases in `sage-community-memory.test.ts` (question outcomes) and `sage-steward.test.ts` (its input never contains hypotheses).
    - Journey 64 (`sage-community-question.spec.ts`) passed locally against a cloned database.
    - `onboarding-usability.spec.ts` (the Meet Sage card) and the introduction journey in `sage-steward.spec.ts` also passed.
    - The steward follow-up journey failed only where it opens the web admin portal on `:3000`, which wasn't running. The full mobile suite wasn't run locally; CI runs it.
  - Limitations: Commons admins (not platform admins) still can't remove any Sage post from the app; `deletePost` is author-only. A hypothesis's version key includes its exact source signals, so one that gains a new signal before the next daily sweep starts over as a new `CANDIDATE` and needs two unchanged sweeps to become `ACTIVE`; a need growing every day may never be asked about. Two sweeps running at once for different themes could each post, since the 14-day check isn't locked. Answers aren't read for agreement or disagreement, only counted.
- 2026-10-14: Three unused agents were removed outright rather than hidden (no feature flags).
  - **Ride-match agent** (`sage-ride-match-agent.ts`, `sage-ride-matcher.ts`, the `sage-ride-match-detect` Trigger task and its dispatch from closed circle windows). The planned mutual-match design (`MUTUAL_MATCH`) replaces it. Closed circle windows now run only trend detection; the sweep moved to `apps/api/src/trigger/sage-circle-windows.ts` with the same task ids.
  - Historical data stays readable: the `RIDE_MATCH_PROPOSAL` enum value, old actions, reviews, audit events, `sage-ride-match` trails and `sage-ride-match-detect` cost events are kept, with no migration. Trails and spending show their raw keys. Memory consolidation still excludes `RIDE_MATCH_PROPOSAL`.
  - A ride-match suggestion still waiting is closed through the existing follow-up path with "Sage no longer suggests ride matches", either on the next wake cycle or when the member answers it. People who already said yes get the usual closed-suggestion notice. The details form for a ride (`PROVIDE_CONTEXT`) was removed from the suggestion screen.
  - **Commons Assistant** (`commons.ask`, an unauthenticated `publicProcedure` running gpt-5.2, and its registry entry) and **Commons Recommender** (only reachable from the admin Agent Playground) were removed. Old `commons-assistant`/`commons-recommender` cost events are still labeled "Assistant" in spending.
- 2026-10-15: Sage has a face: a peach blob with round glasses and big round eyes, drawn in code by `SageAvatar` (`apps/mobile/components/sage-avatar.tsx`; source art `apps/mobile/assets/images/sage/sage.svg`), the same in every Commons. It follows common practice for AI helpers: an illustrated, non-human character, so nobody mistakes Sage for a person. Earlier grandma/grandpa and egg drafts were dropped.
  - It replaces initials or the sparkle icon on feed and post authors, search, @mention suggestions, Messages, Sage alert popups, the Alerts banner, the Sage suggestions header and Meet Sage. The API now returns `isSage` on DM people, search people, direct members and personal pages; posts already had `authorIsAi`.
  - Small animations, kept rare and cheap: it blinks every 5–9 seconds only where Sage is the focus (an open Sage chat, Sage's page, the Sage screens, a Sage alert) and stays still in lists. In Messages, while a message to Sage is sending (Sage writes its reply inside that request), the member's note shows faded and Sage shows "Sage is thinking…" with a gentle pulse and three dots. The animations are Reanimated keyframes on transform and opacity only, and the phone's Reduce Motion setting turns them off.
  - Cosmetic only: no change to what Sage may do, approvals, memory or model cost.
  - Verified: the full `@repo/trpc` suite, the mobile type-check, and journey 66 (`sage-avatar.spec.ts`), including the thinking state.
  - Limitations: comment rows and message bubbles have no avatars for anyone, so Sage's comments still show only the AI badge. Blinking isn't asserted in E2E. A blinking avatar on a screen that stays mounted in the background keeps its animation scheduled until the screen unmounts.
- 2026-10-16: Sage posts a predictable weekly rhythm in each Commons feed (`sage-community-rhythm.ts`), as the Commons' assistant community manager.
  - **Rituals**, each its own category:
    - Monday, "This week's three priorities": one from each source first (the soonest `VOTABLE` proposal closing within 7 days, the next Commons-wide event, the count of unanswered requests, the highest-weighted mission goal), then the rest.
    - Midweek, "Still waiting for a hand": revisits Monday first, then lists unanswered Need/Ask posts (the same query as `sage-unanswered-needs.ts`) and public threads whose Sage follow-up went past due after a reminder or was abandoned in the last 14 days. An explicit first-person offer such as "Priority 2: I'll host" becomes one `SageTask`; agreement and "we should" do not. The digest says which numbered priorities have a volunteer, which still need an owner, and how many other comments need a response, without naming the member.
    - Friday, "This week's appreciation": counts from verified records only. Help is `HELP_CONFIRMED` (the helper is credited). Requests answered is a Need/Ask post's first reply from someone else. Resources are `PUBLISHED` `CommonsResource`s. Events hosted are events that ended with at least one non-host `GOING`. Proposals advanced are `VOTABLE`/`APPROVED`/`FUNDED` ones updated that week. Commitments kept are `SageTask`s closed with a fulfilled outcome (`FULFILLED_TASK_OUTCOMES`: the owner replied, drafted or submitted). It adds movement toward the top three mission goals and carries forward Monday's volunteer, unowned-priority and unanswered-comment counts.
    - Monthly, days 1–3, "How <month> went": the same six counts against the month before (up is improved, flat or down is stalled). "What could stop" comes from deterministic rules: a rhythm category whose posts all got no replies or reactions that month, Monday questions or concerns with no later response, still-open Monday commitments, proposals stuck `SUBMITTED` for over 30 days, and recurring event series with no RSVPs.
    - Before decisions, the proposal summary described above: agreement, disagreement, missing facts, and groups not yet heard, without voting advice.
  - **Social participation:** each scheduled post ends with a voluntary, concrete invitation: choose a priority and invite a partner, answer or—with permission—connect someone to an open request, offer a specific thank-you or a contribution the records missed, and name one thing to keep, change or stop. This is goal-directed participation, not a raw-engagement target.
  - **Naming (decided here):** Friday appreciation reports verified contributions as Commons-level counts and does not name individual members. This avoids another privacy preference and never exposes who asked for help.
  - **Notifications (simplified):** there are no per-ritual subscriptions, mutes, or feed filters. General-feed rhythm posts use the existing **Community** notification category (`SAGE_RHYTHM`). Sage activity outside General, including before-decision summaries, uses one account-wide **Sage** notification category (`SAGE_PRE_VOTE` and the other `SAGE_*` types). Notification categories control push delivery; the public General post or proposal discussion remains visible to every member who can open it.
  - **Bounds:** no model call, so it doesn't spend the autonomy budget. Every post goes through `checkSageOutput`, and member-written titles and commitment excerpts are cleaned and checked (failing ones are dropped). Each ritual posts at most once per Commons per period: the unique `CommonsAction` key `community_rhythm` / `<coop>:<category>:<ISO week or month>`, claimed before posting. A period with nothing to say is recorded as a `DISMISSED` action with `RHYTHM_SKIPPED`, so it isn't retried. If the prior General post for that same category has a member reply in the last 48 hours, the new period is also recorded as skipped so Sage does not split an active discussion. Commons with fewer than 5 active members (`RHYTHM_MIN_ACTIVE_MEMBERS`) and demo Commons are skipped.
  - **Schedule:** a wake-cycle step (`sage-wake-work.ts`, every 15 minutes through `sage-wake-sweep`, or in the API without Trigger). Times are UTC, with a two-day window per ritual (Mon–Tue, Wed–Thu, Fri–Sat; the month's days 1–3). The first day waits until 13:00 UTC.
  - **Removal:** a platform admin can remove a rhythm post from the web Commons AI actions page (**Remove Sage's post**, the same `remove-question` command). The action becomes `DISMISSED` with `RHYTHM_POST_REMOVED`.
  - **Discussion link:** `hasDecisionSummary(proposalId)` detects a published `SUMMARIZE_DISCUSSION` action, and Monday's line adds "Read the discussion summary in the thread first."
  - The Meet Sage card's "What Sage can do on its own" now mentions the rhythm and that each one can be muted in Sage settings.
  - Verified so far:
    - `pnpm -F @repo/trpc test`: 938 passed, 30 skipped. New: `sage-community-rhythm.test.ts` and a feed-filter case in `commons.test.ts`; the focused rhythm and pre-vote run passed 30 tests.
    - The database, validators and tRPC packages build, and the mobile type-check is clean.
    - A live run on a cloned database: the API's wake loop posted exactly one real Friday appreciation for `cahootz` (`2026-W42`) across repeated cycles, and skipped smaller Commons. The fixture's midweek and Friday posts read as intended.
    - Journeys 68–69 cover Sage's single notification category, Community-category General posts, before-decision alerts, verified counts and the two-member view. A local rerun was blocked before the changed specs by the existing development database's failed `20260827000000_add_commons_social_tables` migration; CI's migrated E2E database remains the browser gate.
  - Limitations:
    - Times are UTC, because Commons have no time zone.
    - A proposal's "advanced" date is its last update, because status changes aren't timestamped.
    - Goal movement relies on proposal goal scores, which are model-scored (an expert can override them). It's shown as a count, never as recognition.
    - "Events hosted" uses a `GOING` RSVP as the proof it happened; there's no attendance record.
    - Monthly "could stop" rules are few and deterministic.
    - The skip record for an empty period shows on the admin actions page.
- 2026-10-16: Sage's DM and @mention replies feel the same. Before, a DM ran on gpt-5-nano with action tools and an @mention ran on gpt-5.2 with no tools, from the same prompt.
  - **One model.** `runSageCommonsReply` uses `gpt-5.6-luna` for both (`SAGE_REPLY_MODEL`, env `SAGE_REPLY_MODEL`), with low reasoning effort and low verbosity, the same model as the feed agent and the check-in follow-up. `SAGE_DM_MODEL` and the `COMMONS_AI_MODEL` fallback for replies are gone. The charter in the prompt is capped at 8,000 characters like the feed agent's, so a long charter can't raise every reply's cost.
  - **Personal.** `sagePersonalInstructions` (`sage-reply-templates.ts`) tells Sage to talk to the one member who wrote, by first name once when it fits, about their own situation, and never invent personal details. DMs, @mentions, check-in follow-ups and the feed agent (each item now carries `authorName`) all use it. `safeFirstName` keeps one word of letters from the member's name, since a name is member-written text that lands in instructions.
  - **Same tools.** `buildSageReplyTools` gives both channels the feed agent's read-only lookups (`search_commons_documents`, `list_commons_resources`, `count_members_offering`), `search_opportunities` and `schedule_check_in`, with up to 4 turns. Only a DM also gets `list_my_commons`, `propose_post`, `suggest_introduction` and `follow_up_later`: each needs a private yes in the conversation or would reveal the member's other Commons in public. In a thread, `search_opportunities` searches only that Commons, and the lookups return only Commons-wide documents, never names. A public reply tells the member to message Sage for an anonymous post or an introduction.
  - The reply trail records the model and every tool call (`Used a tool: ...`); it no longer says replies have no tools.
  - Approvals are unchanged: nothing is posted, shared or introduced without the member's yes in their DM, and @mentions still never see member memory.
  - Cost: luna is $0.20 / $1.20 per million input/output tokens. Measured locally on 2026-10-16: 6 `sage-reply` calls averaged $0.0006 (about 2,500 input and 50–90 output tokens, some with a tool call). An @mention was an estimated $0.010 on gpt-5.2; a DM was about $0.0004 on nano. Replies stay recorded under `sage-reply` and member-requested, so they keep working after the autonomy limit.
  - Verified (2026-10-16, local stack): the full `@repo/trpc` suite (with `sage-reply-tools.test.ts` and new cases in `sage-checkin-followup.test.ts`), the smoke set (18 passed), journey 67 (`sage-reply-parity.spec.ts`), `agent-decision-trails`, `sage-decision-comments` and `sage-member-memory`. `sage-member-memory` had failed at "1 need remembered" on main too: the DM trail list is newest-first, but the spec opened the last (oldest) trail; it now opens the first. `sage-member-post` failed because a leftover 2026-10-15 E2E introduction between the two fixture accounts put them in the 30-day cooldown, so no introduction was offered.
  - Limitations: whether a reply actually uses the name, or calls a tool, is the model's choice and isn't asserted in E2E. A `schedule_check_in` from a public @mention is delivered in the member's DM with Sage.

## Completed milestones

Move verified work here with the completion date, linked files, and passing test commands. Do not list the current proactive-suggestion slice here until its mobile end-to-end gate passes.

- 2026-10-03 — P0 proactive-suggestion slice: direct recommendations with visible reasons, the auto-reply confidence gate, approval-gated Sage comments and editable proposal drafts from circle trends, bounded circle-scoped outcome memory, and monthly autonomy limits with member-visible usage and paused status. Files: `packages/db/prisma/migrations/20261003010000_sage_autonomy_limits`, `apps/web/app/portal/admin/commons/[coopId]/ai/commons-ai-client.tsx`, `packages/trpc/src/services/{sage-autonomy,sage-outcome-memory,sage-trend-agent,commons-action-agent,commons-action-tools,circle-window}.ts`, `packages/trpc/src/routers/{sage,commons,commons-actions-admin}.ts`, `apps/mobile/app/(authenticated)/sage/[id].tsx`, `apps/mobile/app/commons/[coopId].tsx`. Tests: `pnpm -F @repo/trpc test` (501 passed), `pnpm -F @repo/trpc build`, `pnpm -F @cahootz/mobile type-check`, Playwright `sage-stewardship`, `sage-trend`, `sage-ride-match`, `commons-info-page`.

- 2026-10-04 — P1 tasks and the wake-and-wait loop, responsibility routing, memory consolidation and retrieval, and the steward with specialist tools (remaining gaps listed in each P1 status). Files: `packages/db/prisma/migrations/20261005010000_sage_tasks_alerts`, `packages/trpc/src/services/{sage-tasks,sage-wake,sage-wake-work,sage-responsibility,sage-memory,sage-steward,sage-introductions}.ts`, `packages/trpc/src/agents/tools/specialist-tools.ts`, `apps/api/src/trigger/sage-wake.ts`, `apps/mobile/components/sage-following.tsx`, `apps/mobile/app/(authenticated)/sage/alert/[id].tsx`, the Commons AI actions page. Tests: `pnpm -F @repo/trpc test:run` (563 passed), `pnpm -F @repo/trpc build`, `pnpm -F @cahootz/mobile type-check`, mobile unit test `notification-navigation`, Playwright `sage-steward.spec.ts` (3 journeys) plus the existing Sage journeys.

Next highest-priority incomplete item for comment quality: learn from leader edits (now also for circle facilitation comments the leader edits before approving). Store the before and after when a circle leader edits a suggested comment before approving it, and give Sage the last 2-3 edits from that Commons as bounded, scoped examples. Otherwise: P2 — Cost optimization and budget administration (Commons-admin control of limits, forecasts and pre-limit alerts), unless the remaining P1 gaps above are prioritized first.
