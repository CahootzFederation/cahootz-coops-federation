# Cahootz design and product review

Date: November 2, 2026
Direction: **A simpler, calmer experience**, as requested during this review.
Baseline: `AGENT.md`, `TESTING.md`, the existing app, product roadmaps, and analytics documentation. No `DESIGN_BRIEF.md` was present.
Skills: `design-review` and `product-manager-toolkit`, both already installed.
Source snapshot: `dc735995` plus the existing uncommitted work. This is a review, not an implementation change.

## Assessment

Cahootz has substantial functionality and a clear underlying purpose: help communities turn needs into accountable action. The experience makes people learn too much of the product's structure before that value becomes obvious. A member encounters Commons, circles, a Post board, a Community Board, Personal Page, You, and separate proposal destinations. These are often useful capabilities, but their boundaries and visual priority are inconsistent.

**Prioritize context and accessibility first, then simplify the path to a useful exchange.** A visual redesign alone would leave the most important problems intact: navigation can change the selected community, the public application flow can present an impossible choice, and product analytics do not yet describe the whole member-value loop.

## Scope and evidence

Reviewed the running local public website and member web app, using the existing `releaseclick1` fixture session. Captured the landing page, circles home, feed, Board, account, and proposals at 375×812, 768×1024, and 1280×800. Also opened the Board composer, typed an unpublished test draft, checked proposal validation, and reproduced the public application's empty-state error.

This is a sampled project review, not an exhaustive security audit or release certification. Test content and old E2E records dominate the local database; their volume, names, and apparent engagement are **not evidence about real communities**. No messages, applications, proposals, payments, or outreach were submitted. The API's normal local background jobs were active during inspection.

Native iOS/Android behavior, payment completion, admin workflows, new-account onboarding, screen-reader operation, and dark-mode behavior were not validated. Initial welcome images were captured before the saved session finished loading and are explicitly excluded from visual conclusions. Welcome motion findings below come from source inspection. Automatic browser approval review blocked signing out the existing test session; it was left signed in.

No production analytics or customer interviews were available. Strategic priorities below are hypotheses informed by the code and observed experience, not proven retention or revenue results. No implementation files were changed, so no new UI journey or full test-suite run was required for this review.

## Must fix

### 1. Preserve the chosen Commons across navigation

**Observed:** Cahootz Coop → General feed → Board opened **E2E Market Commons**. You also showed E2E Market Commons; its Governance Proposals link then opened Cahootz Coop. Both are memberships of the fixture account, so this demonstrates an audience/context problem, not a proven authorization bypass.

**Why it matters:** A member can believe they are still acting within the community they just visited. The Board composer says only “Post to the board,” with no community name inside the sheet.

**Source:** [Bottom navigation](/Users/deonrobinson/workspace/soulaancoop/apps/mobile/components/app-bottom-navigation.tsx:39) reads `coopId` but [navigates using a bare destination](/Users/deonrobinson/workspace/soulaancoop/apps/mobile/components/app-bottom-navigation.tsx:75). [Board initialization](/Users/deonrobinson/workspace/soulaancoop/apps/mobile/app/(tabs)/board.tsx:123) falls back to the session Commons. [Account navigation](/Users/deonrobinson/workspace/soulaancoop/apps/mobile/components/account-profile-screen.tsx:230) also uses unscoped Board/proposal links. [The composer heading](/Users/deonrobinson/workspace/soulaancoop/apps/mobile/app/(tabs)/board.tsx:624) omits the audience.

**Refinement:** Carry one explicit selected-Common context through every community-specific destination. Label the composer “Post to [Commons name]”; retain the audience through reload and back navigation. Treat account-wide settings separately from community-specific actions.

**Acceptance:** Starting in either of two memberships, Board, marketplace, proposals, and their creation screens retain that membership through navigation and reload. Show the destination before any submission. Add this regression journey to `apps/mobile/e2e/` when implementing.

Evidence: Cahootz feed, different Commons on Board, composer.

### 2. Remove the impossible application choice

**Observed:** The landing page lists three Commons with Apply links. The embedded application picker says “No live applications yet.” Continue remains enabled; clicking it produces “Choose the commons you want to apply to” without offering any choice.

**Source:** [Public discovery](/Users/deonrobinson/workspace/soulaancoop/packages/trpc/src/routers/coop-config.ts:237) and [application availability](/Users/deonrobinson/workspace/soulaancoop/packages/trpc/src/routers/coop-config.ts:321) have different eligibility rules. The latter additionally requires tagline, description, mission, and eligibility text. The [Continue button](/Users/deonrobinson/workspace/soulaancoop/apps/web/components/member-application-flow.tsx:516) only checks loading, while the [empty state](/Users/deonrobinson/workspace/soulaancoop/apps/web/components/member-application-flow.tsx:574) has no path forward. Query errors also collapse to an empty list through `coopsQuery.data ?? []`.

**Refinement:** Define application readiness once and use it in discovery and application entry points. Render loading, unavailable, and failed-to-load states separately. When nothing is available, replace the application controls with one useful waitlist action; do not tell someone to select a nonexistent option.

**Acceptance:** A listed Apply destination can actually be selected; an empty list has no impossible Continue action; a failed request shows Retry. Cover these states in a UI regression test. This finding is reproduced locally; production incidence was not checked.

Evidence: Mobile application error.

### 3. Make action colors readable

The shared-looking orange is frequently hardcoded as `#FF6B00`. Against white, its calculated sRGB contrast is **2.86:1**; against `#FFF7ED`, **2.69:1**. This affects selected navigation labels, profile editing, white text on orange prompts, and primary buttons. It falls below both the 4.5:1 ordinary-text and 3:1 large-text thresholds. [W3C contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum).

**Source:** [Navigation color and 10px labels](/Users/deonrobinson/workspace/soulaancoop/apps/mobile/components/app-bottom-navigation.tsx:67), [profile prompt](/Users/deonrobinson/workspace/soulaancoop/apps/mobile/components/commons-ai-entry.tsx:1520), [profile edit action](/Users/deonrobinson/workspace/soulaancoop/apps/mobile/components/account-profile-screen.tsx:346), [welcome button colors](/Users/deonrobinson/workspace/soulaancoop/apps/mobile/components/onboarding-welcome.tsx:263).

The public site's [“Already invited?” download action](/Users/deonrobinson/workspace/soulaancoop/apps/web/app/page.tsx:418) has an even stronger defect: it uses the [dark-text secondary button style](/Users/deonrobinson/workspace/soulaancoop/apps/web/app/landing.css:162) on a dark section. Browser-computed colors were `#20251F` on the section's `#1F2924`, approximately **1.04:1**, with a transparent button background. The action is effectively invisible in the desktop application view. Give this action a contrasting fill and text color.

**Refinement:** Keep orange as a brand accent, introduce accessible action/text variants, and use shared semantic tokens. The Board's darker orange on its paper background already measures about 4.69:1 and is a useful starting reference, not a blanket guarantee for other combinations.

**Acceptance:** Measure enabled text in default, selected, hover, focus, and error states. Preserve visible keyboard focus and non-color selection cues. Enlarge navigation labels without reducing their existing 56px-high touch areas.

Evidence: Feed prompt, account action.

### 4. Stop automatically moving introductory content

**Source-confirmed, not a completed browser reproduction:** [The welcome carousel](/Users/deonrobinson/workspace/soulaancoop/apps/mobile/components/onboarding-welcome.tsx:44) advances every 4.5 seconds indefinitely. It has no pause control or reduced-motion condition. Its dot controls are [8×8px, or 22×8px when active](/Users/deonrobinson/workspace/soulaancoop/apps/mobile/components/onboarding-welcome.tsx:253), without an expanded hit area in this component.

**Refinement:** For the requested calm experience, use a static introduction or manual paging. If automatic movement remains, provide a persistent pause mechanism and respect motion preferences; enlarge the controls. W3C requires control over relevant automatically moving or updating content. [W3C pause/stop guidance](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide).

**Acceptance:** Reproduce in a fresh signed-out test context, verify manual navigation and keyboard access, and confirm that reading time is not controlled by a timer. Retest the hydrated layout at all three breakpoints.

## Should fix

### 5. Give each main destination one understandable job

“Post board” appears inside Commons while “Board” is a separate tab. The Board has a Post button, four quick-post buttons, categories, a marketplace preview, resources, and another posting action. Personal Page appears in the drawer, its switcher, and You. Messages are outside the bottom navigation. Governance can be reached through both the community menu and account navigation, with inconsistent context.

**Refinement:** Test a simple distinction: **Community** for conversations and circles; **Board** for needs, offers, events, and exchange; **Alerts** for things needing attention; **You** for profile and settings. Use “Feed” or the circle's name instead of “Post board.” Put messages in one consistent, visible location. Keep proposals reachable within the selected community, with an action count when a vote needs attention.

Do not remove capabilities solely to reduce the number of screens. Reduce duplicate entry points and explain what remains. On the Board, one primary “Post” action can reveal the four choices on demand.

Sources: [Feed title](/Users/deonrobinson/workspace/soulaancoop/apps/mobile/components/commons-ai-entry.tsx:1843), [drawer](/Users/deonrobinson/workspace/soulaancoop/apps/mobile/components/app-drawer.tsx:49), [Board actions](/Users/deonrobinson/workspace/soulaancoop/apps/mobile/app/(tabs)/board.tsx:407). Evidence: feed, Board, and account captures below.

### 6. Establish one visual system and a wider-screen layout

The website uses warm paper, dark green, serif display type, and angular controls. The Board uses paper and editorial dividers. The feed, circles, and account use white/gray surfaces, heavy sans-serif type, large rounded cards, and bright orange. Within the landing page, the black calculator, dark business form, white application form, and journal cards create further shifts.

At 1280px, the feed and account stretch across nearly the whole window; circles stay in two widely separated columns. The Board does rearrange into two sections at tablet width, but its lone product preview expands dramatically on desktop.

**Refinement:** Use shared color, spacing, type, radius, and control tokens. Keep the warmth, reduce decorative containers, reserve strong color for the primary action, and constrain reading surfaces to approximately 640–720px as a starting design hypothesis. Use a deliberate wider-screen shell instead of stretching a phone screen. Prefer compact circle rows with readable names where the current large avatars add little information.

Sources: [Circle widths and avatars](/Users/deonrobinson/workspace/soulaancoop/apps/mobile/components/circle-view.tsx:507), [Board-local tokens](/Users/deonrobinson/workspace/soulaancoop/apps/mobile/app/(tabs)/board.tsx:58), [landing styles](/Users/deonrobinson/workspace/soulaancoop/apps/web/app/landing.css:1). Evidence: desktop feed, circles, Board, and account captures.

### 7. Let the homepage serve one primary audience

The mobile landing page was approximately **15,592 CSS pixels tall** before validation expanded it. The first phone viewport contains a header download link, hero download button, invite link, explanation link, and fixed download bar. Later it asks visitors to apply, join a waitlist, register business interest, model treasury contributions, and read the journal.

**Refinement:** Make joining or opening the right community the main journey. Keep a concise explanation and credible product preview. Move business onboarding and the treasury calculator to dedicated destinations; make journal content secondary. Show the fixed download bar after the hero action leaves view. Avoid unsupported certainty such as “Your people are already there” when the visitor's community is unknown.

This is a prioritization judgment, not proof that a shorter page will convert better. Measure the join journey before and after, segmented by invited members, applicants, and organizers.

Source: [Landing page](/Users/deonrobinson/workspace/soulaancoop/apps/web/app/page.tsx:136). Evidence: all landing captures.

### 8. Put useful actions above account infrastructure

On a 375px phone, You spends its first screen on identity, email, wallet address, repeated membership information, and funding badges. The navigation list starts below that. The feed gives an optional profile-completion prompt more visual weight than the community's content. The proposals page highlights starting something new ahead of existing decisions and mixes withdrawn and closed entries with other proposals.

**Refinement:** Put Personal Page, messages, settings, and relevant pending actions near the top of You. Keep wallet details under Wallet. Turn the profile prompt into a quiet, dismissible reminder. In proposals, lead with “Needs your vote,” “Your drafts,” and “All proposals,” preserving access to closed decisions and their audit history.

Sources: [Account detail blocks](/Users/deonrobinson/workspace/soulaancoop/apps/mobile/components/account-profile-screen.tsx:357), [profile prompt](/Users/deonrobinson/workspace/soulaancoop/apps/mobile/components/commons-ai-entry.tsx:1520), [proposal hierarchy](/Users/deonrobinson/workspace/soulaancoop/apps/mobile/app/(tabs)/proposals.tsx:280). The local proposal data is old test data; it supports the layout observation, not a conclusion about real decision throughput.

### 9. Complete accessible interaction details

The drawer's proposals control renders as a focusable `DIV` with an accessible label but no button/link role. The Board renders multiple section titles as level-one headings. Feed attachment, event, and send controls are 32px squares; they fall short of the design skill's 44px touch-target goal. This is not a claim that every such target violates WCAG's separate minimum-target exceptions.

Proposal validation is helpful and uses an alert, but the error summary remained below the visible phone viewport after pressing the fixed Send button. A sighted member receives no visible explanation in that view.

**Refinement:** Add appropriate control roles, hierarchical headings, visible focus treatments, and larger hit areas. Move focus/scroll to the first invalid field and display concise inline errors. Verify the complete keyboard journey; this review inspected semantics and form behavior but did not certify keyboard or screen-reader coverage.

Sources: [Feed controls](/Users/deonrobinson/workspace/soulaancoop/apps/mobile/components/commons-ai-entry.tsx:1761), [Board headings](/Users/deonrobinson/workspace/soulaancoop/apps/mobile/app/(tabs)/board.tsx:407), [proposal validation](/Users/deonrobinson/workspace/soulaancoop/apps/mobile/app/(authenticated)/proposals.tsx:156). Evidence: validation viewport.

## Could improve

- Replace technical or structural labels in ordinary member paths: “Governance Proposals,” “Procurement,” “Deliberation,” “Commons AI,” and “with the same Commons posting tools used elsewhere in the app.” Use everyday labels, with precise governance detail available when it affects a decision.
- Make Sage summaries compact and expandable; group routine updates without hiding votes, deadlines, or material risks. The local fixture does not establish whether production has too many Sage posts.
- Use a controlled review fixture with a small community, a large community, no activity, an active vote, a failed request, and a long ordinary name. Existing leftover E2E content makes realistic density and content-quality judgments harder.

## What works well

- The public site's paper palette, display typography, and community language give it a recognizable identity worth retaining.
- Four persistent main tabs are a manageable starting point. Their selected state is exposed semantically, and their touch areas are generous.
- The Board separates browsing needs, offers, and events from commerce, and adapts to two sections at tablet size.
- The proposal form asks three understandable questions, accepts uncertainty about cost, and hides optional detail. Its missing-field summary gives concrete instructions.
- Sage is visibly labeled as an AI helper. The documented approval boundaries, scoped memory, cost limits, and decision trails are valuable trust foundations.
- The repository has substantial real-UI test coverage, including isolated two-account journeys. Keep this discipline while simplifying the interface.

## Product review

### Focus the first successful use

**Recommended initial segment, to validate:** an existing small community with an organizer and a real recurring need. Families, neighborhoods, clubs, co-ops, merchants, and governance operators have different reasons to adopt. Serving all of them through the same first-run pitch makes the product harder to explain and evaluate.

Member job: **“When I need help or can offer something, I want the right people in my community to see it and respond, so something useful actually happens.”**

Organizer job: **“When our group agrees to do something, I want a clear owner, next step, and outcome, so commitments do not disappear into conversation.”**

The recommended first-use loop is:

**Join the right Commons → see a relevant need or offer → respond or post → receive a useful human response → confirm what happened.**

Governance, commerce, and Sage should support this loop when relevant. Keep approvals and verifiable records; introduce their details at the moment a member needs them. A general social feed alone does not make the project's accountability and follow-through advantages visible.

### Measure delivered value

[Mobile analytics](/Users/deonrobinson/workspace/soulaancoop/apps/mobile/lib/analytics.ts:22) cover onboarding, invitations, notifications, sign-in, and some navigation. [The documented funnel](/Users/deonrobinson/workspace/soulaancoop/docs/mobile-analytics.md:58) emphasizes onboarding, lounge joining, push permission, and return visits. These are useful diagnostics, but do not establish that a member received help or that a community completed work.

Sage already has outcome records and verification logic; do not create a duplicate outcome system or treat generated narratives as confirmed facts. Connect authorized product measurement to existing records where suitable, and use optional member confirmation for real-world outcomes the app cannot verify.

| Measure | Proposed definition | Guardrail |
| --- | --- | --- |
| Primary value measure | Number and share of pilot Commons with at least one verified or member-confirmed useful outcome in a rolling 28 days | Separate completed help, delivered work, and enacted decisions; deduplicate; report sample size |
| Activation | Newly joined members who participate in a useful exchange within 7 days / newly joined members | A Sage-only response or notification permission is not activation |
| Responsiveness | Median time to first human response; share of asks still unanswered after 48 hours | Exclude bots and self-replies; a reply is only a proxy for usefulness |
| Follow-through | Accepted commitments completed by their due date / commitments due | Separate canceled and abandoned work; never infer completion from a message alone |
| Retained value | Activated members who participate in another useful exchange in days 8–28 / activated members with a complete observation window | Report by Commons and entry path; do not reward posting volume |
| Sage quality | Accepted suggestions, unnecessary alerts, member corrections, verified outcomes, and cost per outcome | Preserve voluntary participation, privacy boundaries, and spending limits |

The 7-, 28-, and 48-hour windows are proposed measurement definitions, not established baselines or promises. Avoid a mandatory survey after every interaction. Start with a small pilot and lightweight confirmation.

### Prioritized product work

Use the toolkit's **value-versus-effort** approach here. RICE would imply precision we do not have: reach, actual user impact, and engineering estimates were not supplied. The effort labels below are provisional relative estimates.

| Order | Work | Expected value / confidence | Relative effort | Evidence needed to finish |
| --- | --- | --- | --- | --- |
| 1 | Consistent Commons context and application availability | High; reproduced defects | Medium | Regression journeys pass across two memberships, reloads, empty and error states |
| 2 | Contrast, static welcome, interaction semantics | High; source and visual evidence | Small–medium | Measured colors, motion control, keyboard and phone checks |
| 3 | Simplify navigation and first useful action | High hypothesis; user research needed | Medium | Members can find a relevant action and correctly identify its audience without coaching |
| 4 | Outcome measurement and pilot baseline | High strategic value; current analytics gap is evidenced | Medium | A small cohort report distinguishes activity from verified value |
| 5 | Shared visual tokens and wide-screen shell | Medium–high usability hypothesis | Medium | Critical screens match the chosen system at three breakpoints |
| 6 | Refine acquisition around demonstrated value | Conditional on activation and follow-through | Medium | Partner cohorts show useful outcomes and retention, not just attributed sign-ins |

The in-progress [outreach feature](/Users/deonrobinson/workspace/soulaancoop/docs/outreach.md:1) already distinguishes visitors, accounts, applications, and joined members, and appropriately requires explicit message approval. Extend its evaluation to downstream value before broadening outreach. Its documented native-install attribution gap means an iPhone-install campaign cannot be judged solely from the current web attribution report.

### Validate before a large redesign

Recruit 5–8 members and 5–8 organizers from the chosen pilot segment; include people who tried the product and stopped. Ask about the last real request or unfinished commitment, what they used, and where it broke down. Observe the existing product before showing a proposed redesign.

Test four tasks: find the right community, find/respond to a need, identify where a draft will be published, and find a decision needing attention. A practical formative target is at least 4 of the first 5 members completing each task without help, with **zero wrong-audience submissions**. This is a design gate, not a statistically reliable conversion estimate.

Hypothesis: fewer competing entry points and explicit community context will reduce hesitation and wrong-destination choices. If users still need coaching, revisit the labels and structure before polishing visuals. Establish an outcome baseline before setting growth targets; do not invent a percentage uplift from this review.

### Reconcile the product's governing documentation

[AGENT.md](/Users/deonrobinson/workspace/soulaancoop/AGENT.md:319) sets explicit governance and charter requirements. The [organizational roadmap](/Users/deonrobinson/workspace/soulaancoop/documents/org_roadmap.md:3) and [technical roadmap](/Users/deonrobinson/workspace/soulaancoop/documents/tech_roadmap.md:3) still describe an empty charter and disabled compliance gates. The Sage roadmap describes a much more developed operating model.

Mark superseded plans as historical and publish one dated product/release baseline. This is a documentation and decision-making gap; it does not establish which rules production currently enforces. Do not change governance rules as part of visual cleanup.

## Observed checks

Observed passes: the landing page had no horizontal overflow at 375px or 1280px; the sampled core mobile views kept their main tab bar visible; the Board composer disabled publishing while empty and enabled it after required draft text; proposal validation listed the missing answers. These checks do not imply that unsampled states or complete transactional journeys pass.
