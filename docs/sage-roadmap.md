# Sage roadmap

Last updated: 2026-10-23

This is the plan: what we're building next and how we'll know it's done. What's already built, how it was tested, its known gaps, and the decisions behind it are in `docs/sage-changelog.md`.

## North star

Sage helps a Commons run itself. It notices what people need, says what it thinks, and moves useful work forward. Members keep the final say over governance, money, privacy, and anything that can't be undone.

The loop Sage works in:

1. Watch activity and scheduled health signals.
2. Compare them with the charter, goals, open commitments, and what happened before.
3. Say what it thinks and suggest one concrete action.
4. Let code check whether that action is allowed.
5. Do it when it's low-risk and allowed, or send it to the right member for a yes.
6. Follow up when the deadline comes.
7. Check what actually happened and record it.
8. Learn from that outcome, without treating its own notes as fact.

## Boundaries that don't change

- Sage never votes, spends funds, changes membership or roles, amends a charter, makes on-chain transactions, disciplines members, or makes irreversible outside commitments on its own. When one of those happens, it's because members approved it, either a person with the right role or a passed vote that code applies (see Now 1).
- The model's confidence never grants authority. Code checks permission, evidence, severity, whether it can be undone, budget, and required approval.
- Private-circle and member-specific information stays with the people allowed to see it.
- Every action Sage takes can safely run twice and is logged.
- Sage's memory is its interpretation, with sources and confidence, not verified fact.
- Sage's automatic work stops at each Commons' spending or call limit. Members asking Sage for help still get an answer.
- Sage's core principles are the same on every Commons and can't be changed by a vote.

## Now

### 1. Passed proposals take effect, with a log

Why: Sage writes up to two proposals a week, but nothing counts the votes and nothing applies the result. `ConfigAmendment` and `CharterAmendment` stop at "ACKNOWLEDGED," and a person has to make the change by hand. A steward also shouldn't be the one applying their own removal.

Build:

- A proposal can carry one or more specific changes, and voters see each one as before and after:
  - **Charter:** replace `charterText`. Commons-specific instructions for Sage live here too, so changing the charter changes what Sage follows. There's no separate Sage instructions setting.
  - **Goals:** add, edit, or remove `missionGoals`.
  - **Voting rules:** `quorumPercent`, `approvalThresholdPercent`, `votingWindowDays`, `proposalCategories`.
  - **Stewards:** add or remove a member's steward role for this Commons.
  - **Sage settings:** the monthly autonomy dollar and call limits, and how many proposals Sage may make each week (zero is allowed).
- When the voting window closes, count the votes automatically using the quorum and threshold that were in effect when voting opened. Every change uses the Commons' normal `approvalThresholdPercent`; none needs a supermajority.
- A passed change waits 48 hours, then code applies it. Members get notified when it passes ("This takes effect on {date}") and again when it lands. During the wait, members can see exactly what will change.
- Code checks each change again right before applying it. Is the target member still active? Did the field change since the vote opened? Does a removal leave at least one steward? A proposal that would leave the Commons with no steward can't go to a vote unless it also adds one.
- Applying a change creates a new active `CoopConfig` version and a `CoopConfigAudit` row (`status` APPLIED, `diff`, `sequence`) that points to the proposal and its vote count. Steward role changes are logged the same way. If two passed proposals touch the same field, they're applied in the order they passed and the conflict is recorded.
- Members can see a Commons' history of changes: what changed, which proposal made it, and the vote count.
- Once this ships, Sage's own charter and goal proposals use it too. The steward one-tap apply goes away.

Done when: a member's proposal to change a goal, add a steward, or lower Sage's proposal pace goes from vote to tally to a 48-hour wait to applied with nobody touching it, and the change history shows the proposal and vote behind it. A Playwright journey covers two members voting a change through. Unit tests cover the tally, the wait, the re-checks, the last-steward rule, and conflicting changes.

### 2. Prove Sage helps in production

Why: nearly every status note in the changelog ends with "unmeasured." We don't know if Sage reaches members or if what it does is useful.

Build:

- A PostHog dashboard for each Commons: suggestion accept, decline, and correct rates; replies and notifications that members acted on; Sage proposals made and passed; and cost per accepted suggestion and per passed proposal.
- A check at startup that fails loudly if production Trigger.dev has no `OPENAI_API_KEY`.
- Turn `scripts/sage-health-check.sql` into a weekly scheduled report instead of something someone has to remember to run.

Done when: one page shows whether Sage was worth it last week in each Commons.

### 3. Close the rest of the proposal loop

Build:

- After a proposal passes, Sage asks the author how it went and records the result (PR #217, which needs to be brought up to date with `main`).
- When the review sends a Sage proposal back, Sage fixes it using the review's reasons before members see it.

Done when: Sage can tell a Commons what happened with the last few things it voted for.

### 4. Match needs with offers

Build:

- Bring PR #218 (a member's offer becomes a listing or a shop) and PR #216 (Sage asks a family about someone they keep mentioning) up to date and merge them.
- Mutual match: one match type covering rides, stores, and posts. The person with the need is asked first. The facts come from records, never from ownership claims.

Done when: a need someone mentions becomes an introduction or a listing both sides agreed to, and Sage checks whether it worked out.

## Next

- **Week one for a new Commons.** Sage helps a new Commons write its charter goals, posts starter proposals, nudges people to invite others, and checks in on day 7.
- **Cost controls for admins.** A warning before Sage pauses, spending forecasts, cheaper first-pass filters, and cost per outcome. Members can already change the limits by vote (Now 1); this adds what admins need to see.
- **Independent review and replay tests.** A separate reviewer checks high-impact actions, and real corrected cases get replayed whenever the model changes.

## Parked

Not being worked on. Bring one back by moving it up and saying why.

- Trust basics: real deletion when a member asks Sage to forget (today it's hidden for 180 days), a pause button for Sage in each Commons, and a queue screen for Commons admins.
- Learning from how leaders edit Sage's suggested comments.
- Turning Sage's specialist tools on or off by vote.
- A safety-contact role (disciplinary work is out of scope).
- Waking Sage right away on events instead of the 15-minute sweep.
- Spotting real contradictions in memory instead of near-duplicate titles.
- Sending vote alerts in batches for very large Commons.

## How to update this

- Change an item's "Build" or "Done when" before building it if the plan changes.
- When something ships, take it off this page. Add what was built, the tests that actually ran, and what's still missing to `docs/sage-changelog.md`.
- Record decisions in the changelog's decision log with the date.
- Keep this page short. Details belong in the changelog or a design doc.
