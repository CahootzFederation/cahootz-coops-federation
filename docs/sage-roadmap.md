# Sage product roadmap

Last updated: 2026-10-07

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
- Sage tasks and the wake-and-wait loop (`SageTask`, `SageWakeCycle`), routed alerts (`SageAlert`), the daily steward review with read-only specialist tools, consent-first introductions, and consolidated memory (2026-10-04, see the P1 sections).
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
- Who is notified: everyone Sage asks already got a `SAGE_SUGGESTION_NEEDS_YOU` alert when the suggestion was made (circle leader approvals, ride-match details and consent, both sides of an introduction). Those alerts, the new reminder and the closed alert now follow the member's **Community** push setting, like Sage's other alerts, instead of "Other".
- Each wake cycle (every 15 minutes) gives every unanswered review one `REVIEW_SUGGESTION` task. Three days after Sage asked, it sends one `SAGE_SUGGESTION_REMINDER` that opens the suggestion. Four days later, if there's still no answer, Sage closes it: the action becomes `DISMISSED`, the unanswered reviews `EXPIRED`, and the timeline says "Sage closed this: nobody answered after Sage's reminder". If the member dismissed the follow-up, or the review predates this change and is already a week old, it closes at 7 days with no reminder.
- Each cycle also closes a waiting suggestion right away when it no longer applies, judged from app data only (no model call): someone it involves left the Commons; the circle was deleted, or has a new leader (for a leader approval); the person asked left the circle; the ride-match message, or the post Sage would comment on, was deleted; Sage already commented on that post; a suggested event time has passed; the leader already has a near-identical proposal draft.
- People who already said yes (for example the first side of an introduction) get an inbox-only `SAGE_SUGGESTION_CLOSED` alert. The follow-up appears under **Following** with an Open button.
- Answering and closing can't both win: `respondToReview` claims the review with a conditional update, and an answer to a closed suggestion is refused with "Sage closed this suggestion, so it can't be answered anymore".
- Privacy: these tasks' trails are admin-only, and they aren't consolidated into memory (the suggestion's own outcome already is, with ride matches and introductions excluded).
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
- Ride matches, introductions and escalations are never consolidated: they're about specific people.
- Retrieval (`retrieveSageMemory`) reads only the Commons' member-visible memory and, if given, that one circle's memory; never another circle's. It ranks by relevance and recency, stops at an item and character budget (the steward uses 8 items and 1,200 characters), and audits each read as `SAGE_MEMORY_READ`.
- Used by the Commons action agent, the circle trend agent and the steward. The steward's trail shows the memory it read.
- Tests: `sage-memory.test.ts` (7, including private-circle isolation and the budget), Playwright `sage-steward.spec.ts` (a dismissed follow-up appears in the next steward review's memory).
- Remaining: supersession is by near-identical title, not by detecting a genuine contradiction; "verified observations" from other agents aren't consolidated yet; members can't yet ask Sage directly what happened to a past suggestion.

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

- **Core principles** (`services/sage-principles.ts`). Fixed platform rules, not Commons settings, written into the instructions of every Sage agent (Commons feed, circle trend, steward, ride match, @mention/DM reply). They put the group first, keep money inside the Commons when the cost is fair, build shared ownership, start from what members already have, don't assume access to cars, banks or credit, and never treat hardship as a personal failing. They also list mainstream advice Sage must not give: individual budgeting tips when a group option exists, credit-building or financial products, cheapest-is-best, and hardship as an individual problem. A Commons' charter adds to them and can't override them. `sage-principles.test.ts` fails if any Sage agent leaves them out.
- **Decision-moment templates** next to Action plan (`sage-reply-templates.ts`): Where we are (agreed / still open), Trade-off (options laid out evenly, with the fact that decides it), Missing piece (specific facts and who can supply them), Before we decide (who's affected and hasn't been heard; groups, never names). New voice rules: don't take sides between members, and comment only when Sage adds a fact, structure or a missing voice. Sage may now also offer to "summarize where we've landed" and "check back with you on a date you pick", both of which it can already do.
- **Wider grounding** (`services/sage-grounding.ts`). Every Commons feed action names `evidenceSource`: `charter`, `thread` (the member's own words), or `checked` (something a read-only tool returned in the same run). Code confirms the excerpt is really in that source. Replies about rules, votes, proposals, membership, discipline or the Commons' own money, plus charter corrections, mission-alignment replies and proposal drafts, still need a charter quote, enforced by a keyword check in code. The admin approval path follows the same rule; for other replies the approving admin is the human check.
- **Relevance check.** A small, independent model (`gpt-5-nano`, no Sage memory or instructions, feature `sage-relevance-check`, counted toward the autonomy limit) checks that the reply and its evidence are on topic before Sage publishes on its own. It runs only when every other check has passed, including for a quote from the post itself, because a real quote can still sit under a reply that answers something else. Each check costs about $0.0001. If the check fails or can't run, nothing is published: a Commons reply is queued for review, and a circle comment goes to the circle leader. The check is recorded in the decision trail.
- **Read-only tools for comment agents** (`agents/tools/comment-tools.ts`): `search_commons_documents` (this Commons, plus the circle for trend windows), `list_commons_resources` (published resources), and `count_members_offering` (counts only; under 2 is reported as "fewer than 2", and a skill or resource is named only when at least two members list it). They never return member names or ids, because results can end up in a public comment and introductions stay consent-first. Calls are capped by `maxTurns` (6 for the feed batch, 4 for a trend window) and recorded as trail evidence.
- Tests: `sage-principles.test.ts` (3), `sage-grounding.test.ts` (7), `comment-tools.test.ts` (4), new cases in `sage-reply-templates.test.ts` (4, including that only Action plan bullets become a follow-up) and `sage-stewardship.test.ts` (an off-topic comment goes to the leader). The e2e Sage-suggestion fixture passes a fixed relevance judge so it stays deterministic.

- Fixed while testing: a reply using any template turned its bullets into a follow-up task. For a Trade-off, that meant waiting for the member to "Library: free…". Only Action plan bullets are asks now (`followUpExpectation`). Also, the first version of the stay-quiet rule made Sage skip about 1 in 3 unanswered questions; it now says an unanswered question or choice is worth helping with. After the change, 5 of 5 live runs replied with an even trade-off. Then CI caught that the rules check also matched Sage's own offer ("I can draft a small proposal so members can vote"), which dropped every Action plan reply that quoted the thread (`sage-follow-through.spec.ts` failed). Sentences with "I can" are now left out of that check, and both posts were verified live again.
- Fixed after CI (2026-10-07): with `thread` evidence allowed, the model quoted the member's own details as the evidence for a follow-through `MAKE_PROPOSAL`, and the grounding check (proposals stay charter-only) discarded every draft, so `sage-follow-through.spec.ts` failed in CI and 3 of 3 times locally. The prompt now names the charter-only action types from `CHARTER_ONLY_ACTIONS` and says the member's details go in the draft, not the evidence, and the follow-through rule says the same. Two more failures in that journey came from the first post: Sage sometimes chose NO_ACTION for an unanswered question, or drafted an empty proposal before the member gave any details. The prompt now counts an unanswered question as worth helping with, and drafts a proposal only once the item gives some details (an amount, a number or a date); after Sage has offered, it drafts from what the member gave instead of holding out for more. The journey's results also drifted from run to run because `cleanup-post` left Sage's follow-up tasks and the Sage memory written from them, and the next identical post retrieved them ("[PUBLISHED] … request remaining cost details"); cleanup now removes the post's tasks and that memory too. Locally, before the fix the journey failed 3 of 3 and later 6 of 6 times; with the final code it passed 6 of 6 on 3 workers. A later batch of all the Sage journeys ran with load averages above 60 and failed mostly on page loads (`ERR_NETWORK_IO_SUSPENDED`, `ERR_ABORTED`), so it says nothing either way; CI is the check that matters. The proposal still needs a charter quote; that boundary didn't change. Separately, three E2E specs that flip the account-wide "Show Sage decision trails" setting now take turns through `e2e/support/exclusive.ts`; running in parallel, they turned the setting off under each other.

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
- The @mention/DM agent now helps with everyday decisions from the conversation, but has no structured evidence check (it is member-requested and already has the output safety check).
- `search_commons_documents` reads `KnowledgeDocument`, but no mobile or web screen calls `knowledgeBase.uploadDocument` yet, so in practice it finds nothing until documents are added. It reads only COMMONS and PUBLIC documents (plus CIRCLE ones for a circle), never PRIVATE ones. The older `search_knowledge_base` agent tool still applies no visibility filter.
- Not yet built: learning from how leaders edit suggested comments before approving them (see Next).

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
  - The Sage screen shows a "Meet Sage" card (`apps/mobile/components/sage-intro.tsx`) until it's dismissed. It says Sage is an AI helper and not a person, what it does on its own (replies, reminders and alerts, checking back), and what always waits for a person (proposals, money, membership, group decisions). It also says Sage can make mistakes.
  - Sage settings always shows the card, and the suggestion and alert pages carry a one-line version.
  - This is copy only; no autonomy changed. If the Autonomy Boundaries change, update this card in the same change. Verified by `onboarding-usability.spec.ts` (TESTING.md journey 42).
  - Sage's posts and comments in the feed, post page, and event comments carry an "AI helper" tag (`components/ai-badge.tsx`). The commons feed APIs now return `authorIsAi` from `User.isBot`. Verified in `sage-stewardship.spec.ts` (journey 33).

- 2026-10-06: Sage's core principles are platform-wide and fixed in every Sage prompt; no Commons can change them. Sage must not fall back on mainstream US individual-finance advice.
- 2026-10-06: Everyday decisions may be grounded on the thread or a checked source; rules, votes, membership, discipline and the Commons' money still require the charter. An independent relevance check gates autonomous publishing.
- 2026-10-07: A member's own offer becomes a listing or a shop (branch `claude/family-commons-storefront-27b379`). Prompted by a real family post ("I'm a master arborist 17 years experiecne let me and my team work for you!") that Sage silently dropped for four reasons: resource records needed a word-for-word charter quote (fixed by the 2026-10-06 thread-grounding change); the self-offer check was a phrase list ("I can", "I offer"…) that missed it; only PERSON resources got an invitation; and only a platform admin could list anything.
  - The model now sets `selfOffer`; code still requires the offer to be the item's own author (a third party needs an exact @mention and stays PERSON-only), and the phrase list (now wider) is only a fallback. Money offers (FUNDING) are never invited. One invitation per member per Commons per 30 days, as before.
  - Resource offers use the 2026-10-06 grounding rule: their evidence is the offer quoted exactly from the member's post (`evidenceSource: 'thread'`), so no charter quote is needed. Replies, proposals and escalations that touch rules, money or membership still need one.
  - The member's private card offers **List it for members**, **Open a shop** (the shop application prefilled from the offer, in a commons the member picks, defaulting to the one they posted in) and **Not now**. Sage posts nothing publicly about it (user decision).
  - Listing is automatic when the member accepts, in every Commons (`CommonsAgentSetting.autoListResources`, default on, migration `20261008010000_resource_auto_list`). Stewards can turn it off on the Commons resources screen; accepted offers then wait in a steward review queue (`RESOURCE_REVIEW` alert, Approve / Don't list). Platform admins can still publish from the web page. All three paths share `publishCommonsResource`; a failed knowledge-base copy no longer blocks the listing.
  - Fixed: the app sent shop applications without a commons, so the server refused every one ("You must be an active member of this commons to open a shop").
  - Tests: `commons-actions-router.test.ts` (auto-list, steward-only toggle and review, removed members), `commons-action-agent.test.ts` (`resourceCandidate`, including the exact cousin sentence), Playwright `sage-self-offer.spec.ts` (TESTING.md journey 58). `replayCommonsPost` runs the feed agent's post-model path with a supplied model output for fixtures.
  - Remaining: the live model's choice to emit `VERIFY_RESOURCE` with `selfOffer` isn't covered end to end (the journey uses a fixed output). Shop approval is still a platform-admin step, including for family shops.

## Completed milestones

Move verified work here with the completion date, linked files, and passing test commands. Do not list the current proactive-suggestion slice here until its mobile end-to-end gate passes.

- 2026-10-03 — P0 proactive-suggestion slice: direct recommendations with visible reasons, the auto-reply confidence gate, approval-gated Sage comments and editable proposal drafts from circle trends, bounded circle-scoped outcome memory, and monthly autonomy limits with member-visible usage and paused status. Files: `packages/db/prisma/migrations/20261003010000_sage_autonomy_limits`, `apps/web/app/portal/admin/commons/[coopId]/ai/commons-ai-client.tsx`, `packages/trpc/src/services/{sage-autonomy,sage-outcome-memory,sage-trend-agent,commons-action-agent,commons-action-tools,circle-window}.ts`, `packages/trpc/src/routers/{sage,commons,commons-actions-admin}.ts`, `apps/mobile/app/(authenticated)/sage/[id].tsx`, `apps/mobile/app/commons/[coopId].tsx`. Tests: `pnpm -F @repo/trpc test` (501 passed), `pnpm -F @repo/trpc build`, `pnpm -F @cahootz/mobile type-check`, Playwright `sage-stewardship`, `sage-trend`, `sage-ride-match`, `commons-info-page`.

- 2026-10-04 — P1 tasks and the wake-and-wait loop, responsibility routing, memory consolidation and retrieval, and the steward with specialist tools (remaining gaps listed in each P1 status). Files: `packages/db/prisma/migrations/20261005010000_sage_tasks_alerts`, `packages/trpc/src/services/{sage-tasks,sage-wake,sage-wake-work,sage-responsibility,sage-memory,sage-steward,sage-introductions}.ts`, `packages/trpc/src/agents/tools/specialist-tools.ts`, `apps/api/src/trigger/sage-wake.ts`, `apps/mobile/components/sage-following.tsx`, `apps/mobile/app/(authenticated)/sage/alert/[id].tsx`, the Commons AI actions page. Tests: `pnpm -F @repo/trpc test:run` (563 passed), `pnpm -F @repo/trpc build`, `pnpm -F @cahootz/mobile type-check`, mobile unit test `notification-navigation`, Playwright `sage-steward.spec.ts` (3 journeys) plus the existing Sage journeys.

Next highest-priority incomplete item for comment quality: learn from leader edits. Store the before and after when a circle leader edits a suggested comment before approving it, and give Sage the last 2-3 edits from that Commons as bounded, scoped examples. Otherwise: P2 — Cost optimization and budget administration (Commons-admin control of limits, forecasts and pre-limit alerts), unless the remaining P1 gaps above are prioritized first.
