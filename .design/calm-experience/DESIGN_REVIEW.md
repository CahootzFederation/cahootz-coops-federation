# Design and product follow-up — November 2, 2026

## Assessment

The updated app is visually calmer: white surfaces, restrained accents, compact Board actions, and a bounded desktop layout provide a stronger foundation. The next improvements should make completing a task and returning to the right community dependable. More palette changes would have less value than fixing the two reproduced flow problems below.

This is a review, not another implementation pass. The approved public landing-page palette remains warm. Fresh browser inspection focused on the mobile app rendered on web, including 375×812, 768×1024, and 1280×800 layouts. It does not certify native iOS/Android behavior. Local fixture content and notification counts are not evidence of real member activity. No posts, messages, votes, or proposals were submitted during this follow-up.

## Must fix

### 1. Account → Alerts loses the selected community on refresh

**Evidence: reproduced in the UI.** Start at `/board?coopId=e2e-private-shared`, select the You tab, select the account's Alerts button, then select Board. The route becomes `/board` without the community parameter. The existing screen initially retains “E2E Shared Private Commons”; refreshing changes the heading to “Cahootz Coop.” This creates a misleading continuity: the same apparent destination changes community after reload.

Source: `apps/mobile/components/account-profile-screen.tsx:215` sends the account Alerts entry to a bare route. `apps/mobile/app/(tabs)/board.tsx:128` and `:130` fall back to session/default community when the parameter is absent. Direct tab navigation was improved in the previous pass; this secondary path remains.

**Recommendation:** preserve the originating community through account-level detours and their return navigation. Account-wide alerts may remain account-wide; that should not erase the community to which Board returns. Audit analogous settings/back paths, rather than assuming every global page itself needs community filtering.

**Acceptance:** use a non-default community; click You → account Alerts → Board; reload; verify the same community heading and board content. Add a mobile-web regression journey for this exact path, including reload.

Screenshots: `r2-context-before-375.jpg`, `r2-context-after-reload-375.jpg`.

### 2. Proposal validation can be invisible on a phone

**Evidence: reproduced in the UI.** Open Start a proposal and press Send proposal with required fields blank. Validation prevents submission, but its alert is below the viewport: observed top 984.5px, bottom 1157.5px on an 812px-high screen. The visible form and fixed Send button provide no visible explanation of why nothing happened.

Source: `apps/mobile/app/(authenticated)/proposals.tsx:156` sets an error without scrolling or focusing; `:396` renders the alert after the form; `:408` renders the persistent footer.

**Recommendation:** identify missing fields inline, focus/scroll the first invalid field into view, and keep a concise error summary visible near the action. Preserve entered values.

**Acceptance:** an empty submission exposes readable feedback in the viewport and moves focus appropriately; partially completed forms retain text; invalid input never creates a proposal. Add a regression UI test with visible assertions rather than merely checking that an alert exists in the document.

Screenshot: `r2-proposal-validation-375.jpg`.

## Should fix next

### 3. Make Messages a quiet inbox

**Evidence: freshly inspected at all three widths.** The screen gives a large dark-green header and instructional panel substantial emphasis. At 375px, a horizontal row exposes roughly two people, followed by “No conversation selected” and “DMs should stay secondary.” These panels compete with the user's immediate goal of finding or starting a conversation. This screen also retains a stone canvas and large dark surfaces despite the approved white-app direction.

Source: `apps/mobile/app/(tabs)/messages.tsx:289` sets the stone background, `:290` the green header, `:328` the horizontal conversation row, and `:492` the dark explanatory panel. The second guidance panel begins at `:504`.

**Recommendation:** use a white header and canvas; show recent conversations as readable vertical rows with preview, recency, and unread state. Put the member directory behind a clear New message action. Replace the product-strategy wording with brief, accurate privacy guidance only where useful. If suggesting public sharing, advise sharing an agreed summary rather than implying private exchanges should be reposted. Keep Sage clearly identified as an assistant within this experience.

**Acceptance:** members can distinguish an existing thread from someone they have not contacted, locate an unread reply, start a conversation, and return without losing typed text. Validate native keyboard behavior separately. This review did not send a message or verify delivery.

### 4. Lead Proposals with relevant decisions and drafts

**Evidence: freshly inspected at all three widths, supported by source.** The hub leads with “Turn conversations into decisions,” a prominent creation card, and drafts before the proposal list. The fixture list starts with a withdrawn item; this demonstrates the mixed-status presentation, not the distribution of production proposals.

Source: `apps/mobile/app/(tabs)/proposals.tsx:281` introduces the hero; `:306` contains Start a proposal. An eligible “need your vote” filter already exists at `:351`, with `showActionableOnly` initially false at `:110`.

**Recommendation:** promote the existing eligible decision queue and unfinished drafts, make creation compact, and distinguish current proposals from history. Preserve history and explanations of status. Do not add another competing voting filter or show voting actions to ineligible members.

**Acceptance:** a council member can identify outstanding votes and deadlines; an ordinary member gets useful status information without unauthorized controls; withdrawn/completed proposals remain discoverable. Validate this hierarchy with actual members before treating it as a measured improvement.

### 5. Distinguish unavailable decision data from voting ineligibility

**Evidence: source-confirmed; no simulated outage performed.** `apps/mobile/hooks/use-commons-proposal-actions.ts:53` catches every action-summary error as null. Lines 61–65 then produce zero actionable votes, `canVote: false`, and `failed: false`. A network failure can therefore silently hide the actionable decision entry.

`packages/trpc/src/routers/proposal.ts:389` explicitly documents verified council access to this endpoint. The ordinary review account's forbidden response is expected; it is not a reason to weaken authorization or grant all members voting rights.

**Recommendation:** represent verified ineligibility, successful empty results, and unknown/unavailable data separately. Offer a quiet retry for unavailable data and avoid reassuring “caught up” implications while status is unknown. Keep backend authorization unchanged.

**Acceptance:** cover eligible-with-items, eligible-with-zero, verified ineligible, and unavailable states. A failed request must not masquerade as a successful empty summary.

## Could improve

- Clarify the difference between the feed and Board. `apps/mobile/components/commons-ai-entry.tsx:1841` still labels the feed “Post board,” which competes with the Board tab. Prefer the circle name or “Feed.” This is a source-based terminology finding; the feed was not recaptured in this follow-up.
- Use one consistent, recognizable Messages entry across primary screens before considering another bottom tab. Check findability with members; do not assume more permanent navigation is inherently simpler.
- Review routine notification interruptions during writing. Defer this until the reproduced flow problems are resolved; fixture notification volume does not establish production overload.

## What is working

- White Board and proposal surfaces support the requested calmer direction.
- The 800px app shell keeps desktop content readable and preserves a coherent mobile layout.
- Compact Board shortcuts expose posting options without the previous large competing cards.
- The proposal composer provides generous inputs and a reachable action; the remaining problem is where its feedback appears.
- Prior improvements to manual welcome navigation, account hierarchy, and public-page progressive disclosure remain useful. Their earlier validation is recorded in ../../design.md; they were not all rerun in this follow-up.

## Product priorities

Prioritization is qualitative: no analytics or interview evidence was supplied, so no numeric RICE score or conversion estimate is justified.

| Order | Work | Expected member value | Relative effort |
|---|---|---|---|
| 1 | Community persistence and visible proposal validation | Complete the intended task in the intended community | Small–medium, including regression tests |
| 2 | Honest decision-summary states | Trust whether action is needed | Small–medium; preserve role checks |
| 3 | Inbox and proposal hierarchy | Find a reply or pending decision with less scanning | Medium; validate with members |
| 4 | Terminology and notification restraint | Reduce repeated interpretation and interruptions | Small–medium, after observation |

Run short usability sessions with a returning member and an eligible council member: find a reply, ask for help in the correct community, resume a draft, and identify a decision needing attention. Observe hesitation, wrong destinations, task completion, and recovery from an error. Evaluate whether people receive useful help and reach decisions—not simply whether the redesign generates more posts or clicks. These are proposed validation measures, not observed outcomes.

## Validation limits

No source behavior was changed and no full automated suite was rerun for this review. Previous implementation checks included passing mobile type checking and four focused design checks. The earlier full suite remained unresolved (76 passed, 43 failed, 2 skipped, 3 not run), with fixture access, timing, and local server failures among the causes. This report does not assert release readiness, complete accessibility conformance, native-device validation, or production performance.
