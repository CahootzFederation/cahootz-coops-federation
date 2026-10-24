# Voice audit: Sage prompts and app copy

October 16, 2026. This applies the "Voice: Personable and Plain" rules in `AGENT.md`. It started as a list of suggestions; see "Status" for what has shipped.

## Status (October 23, 2026)

**Done**

- **A, G, H** (server error text, "common" typo, hard-coded coin names) shipped on October 16 in `friendly-error.ts`, `routers/groups.ts`, `store-pay-service.ts` and `uc-transfer.ts`. The last hard-coded "UC" in `routers/onramp.ts` now says "coins".
- **The shared Sage voice block** (`SAGE_VOICE` in `sage-principles.ts`) and nearly all of **"Canned Sage text members see"** shipped on October 16. The proposal-engine verdicts are now plain too, and they still give the score.
- **B, C, D, E, F, I** (sentence case, action buttons, "Finish setting up your account", plain governance and money words, plain status words, "You can't get it back"). Proposal status words now come from one helper, `apps/mobile/lib/proposal-status.ts`.
- **Screen by screen:** proposals, the Commons info page, home and feed, login and onboarding (on top of #275/#276), messages, Sage UI, wallet and payments, and notifications. The shared drawer labels are sentence case too ("Personal page", "Proposals and votes", "Sign out (@…)").

**Kept on purpose (the suggestion would have dropped a fact)**

- "Approved automatically" doesn't print a dollar limit. The screen never had it, and today's limit may not be the one that applied.
- The passed-proposal verdict says "it can move forward", not "ready for a vote". Small proposals that pass are approved without a vote.
- Checkout doesn't say the fee "goes to your commons' shared fund". The fee ledger has no commons ID, so we can't promise that. It uses the existing "Wealth Fund fee" name.
- The Commons rules line still bans extraction schemes and charity-only spaces, in plainer words.
- "Private key" stays on the export screen, with a one-line explanation. The button that shows it says "Show my private key".

**Not done yet**

- **J** (call the AI "Sage" everywhere). "AI helper" stays as the label on proposals Sage writes, because specs and the AI disclosure rely on it.
- **"Prompt lines worth changing"**: the reply, trend and registry lines are done. The Community Observer, proposal-engine scorer, Data Needs, Comment Evaluation and newsletter prompt lines are not.
- The "Please try again." fallbacks that `friendly-errors.spec.ts` and `money-screens.spec.ts` assert word for word.

## The short version

A lot of the app already sounds warm: the welcome wizard, family setup, the new-proposal form, the Sage intro card, and most client error alerts. Most Sage prompts are fine too. The stiff spots are concentrated in a few places:

1. **Server error messages reach members word for word.** `apps/mobile/lib/friendly-error.ts` shows any "readable" server message as-is, so about 38 "Failed to…", about 104 "X not found", and about 33 "Unauthorized / Invalid / Insufficient / Cannot" messages win out over the screens' friendlier fallbacks. This is the single biggest fix.
2. **Proposal detail and the Commons "Governance" tab** read like a scoring pipeline or an admin console: "AI Scoring Complete", "Below Threshold", "Pending disbursement", "Funding thresholds".
3. **Sage's canned replies** (refusals, fallbacks, safety, memory, introductions) and its notifications use system words like "grounded answer", "resource", "route the request", and "anonymous pattern".
4. **The proposal engine prompts** ask for score and rubric language, and members see the result.
5. **The login and old onboarding flow** use Title Case, "Verify," and "Submit" throughout.

## Sage prompts

### One shared voice block

`SAGE_VOICE_RULES` (`packages/trpc/src/services/sage-reply-templates.ts:179`) is the existing voice block, but only the reply, Commons Action, and Trend agents use it. The weekly check-in, check-in follow-up, and steward agents each write their own "trusted community organizer" line, and the proposal engine and newsletter agents use neither.

**Suggestion:** move a short voice block next to `SAGE_CORE_PRINCIPLES` in `packages/trpc/src/services/sage-principles.ts`, since every member-facing Sage agent already loads `sageCorePrinciplesInstructions()`. Something like:

> Talk like a friendly, sharp member of this Commons, not an assistant, a consultant, or a form. Use everyday words, short sentences, and contractions. Say "we" and "you." A little warmth is good ("Love this idea"); fake excitement isn't. Never let a friendly tone soften a fact, a risk, or a "no."

Then reuse it from the proposal engine (`packages/validators/src/proposal-engine.ts`) and the newsletter agents. The Structural Scorer's line at `proposal-engine.ts:766`, "Write like you're talking to a smart neighbour," is the best existing tone line and is a good model.

### Prompt lines worth changing

| Where | Now | Suggested |
|---|---|---|
| `agents/registry.ts:272` | "You are Sage, the AI assistant for…" | "You're Sage, a friendly organizer who helps out in {commons}…". "AI assistant" invites assistant-speak like "I'd be happy to help!" |
| `services/sage-reply-templates.ts:180-181` | "No greetings or sign-offs." / "Lead with your position…" | "Open with what you think and why, like you're talking to a neighbor. Skip formal greetings, but a little warmth is fine." Taken together with the 80-word cap, the current rules push clipped, memo-like replies. |
| `services/sage-trend-agent.ts:69` | "Be direct… no hedging, greetings, or 'consider maybe'." | Add: "Direct but friendly: 'I think we should…', 'What if we…'." This keeps member-facing posts from sounding bossy. |
| `agents/registry.ts:159,163` (Community Observer) | "produce ONE structured observation… cite the document title inline" | Add: "Write the summary like a quick catch-up for a friend who missed the conversation." This text becomes the circle digest that members read. |
| `proposal-engine.ts:667,686` | "You are the {domain} expert scorer…" with a "(current: 52%). To score above 70%…" example | Change the example to plain advice: "You've got two new jobs for members, which is great, but there's nothing yet on pay…" |
| `proposal-engine.ts:1067-1083` (Data Needs) | "why_needed: …its impact on the score" | "why_needed: one plain sentence on why members would want to know this before they vote." |
| `proposal-engine.ts:255,268` (Comment Evaluation example) | "raises a valid concern… wider membership" | "This person's worried the plan mostly helps the owner, not the rest of us…" |
| `services/newsletter-article-agent.ts:344` | "Infer a restrained publication voice" | "Write in a warm, plain, neighborly voice that fits the co-op's description and goals." |
| `services/sage-private-signals.ts:148` | Need summaries written as lowercase fragments with no subject | Members read these back in "what do you remember", so ask for "a short phrase you'd say back to them." |

### Canned Sage text members see

| Where | Now | Suggested |
|---|---|---|
| `agents/registry.ts:228` | "I don't have a grounded answer for that in this Commons' charter right now." | "I'm not sure about that one, and our rules don't cover it. A Commons admin would know best." |
| `services/untrusted-input.ts:118` | "I can only help with questions about this Commons, its charter and its goals." | "That's not something I can help with. Ask me anything about our Commons, though." |
| `untrusted-input.ts:114-117` | The same "I'm here for questions about your Commons…" line for every refusal; "I couldn't read that as a message." | Vary them. "Hmm, I didn't quite follow that. Can you tell me in your own words?" / "That looks like code, and that's not really my thing." |
| `services/sage-private-signals.ts:99` | The safety reply: "…can't provide emergency help… a trusted person or support role…" | "I'm so sorry you're going through this. If you're in danger right now, please call your local emergency number. I can't send help myself, but I can help you find someone in your Commons to talk to. I won't share anything without your OK." |
| `sage-private-signals.ts:302` | "…asked an appropriate support person… did not include what you disclosed." | "Thanks for trusting me with this. I've asked someone to reach out to you privately. I didn't pass on what you told me." |
| `sage-private-signals.ts:306` | "…if you want me to route the request." | "I wasn't sure which Commons you meant, so I haven't shared anything yet. Tell me the name and I'll pass it along." |
| `services/sage-member-memory.ts:251` | "…no longer counted in any anonymous Commons-wide pattern from the next daily update." | "Done, I've forgotten that. It'll drop out of any group totals by tomorrow." |
| `sage-member-memory.ts:44` | "2026-10-10: needs rides to work on weekdays (Harbor)" | "Oct 10: you mentioned needing rides to work on weekdays (Harbor)" |
| `services/sage-proactive.ts:149` | "Checking back like I said: {about}?" | "Checking back like I promised. How did {about} go?" |
| `services/commons-action-agent.ts:287-288` | "Would you like to be listed as a resource?" / "…suggested your skills as a resource." | "Want to be someone folks can come to for help?" / "A member thinks your skills could really help people here." |
| `commons-action-agent.ts:455` (also `routers/commons-actions-admin.ts:314`) | "Review and edit this Commons suggestion before you submit it." | "I turned your idea into a draft. Change anything you like and send it when you're ready." |
| `services/sage-introductions.ts:48,73` | "…whose profile says they can help with: {need}. Want the introduction?" | "I found someone here who might be able to help with {need}. Want me to introduce you? Nothing's shared unless you both say yes." |
| `services/sage-member-actions.ts:361,367` | "Sage introduced you about: {need}" / "…Reply yes or no." | "Sage connected you about {need}" / "Did that introduction help? A quick yes or no is perfect." |
| `services/commons-action-tools.ts:293` | "Shout-out to {name} for showing up for another member through Sage." | "Big thanks to {name} for stepping up for another member. This is what we're here for." |
| `services/sage-suggestion-follow-up.ts:152-153` | "Sage is still waiting on you" | "Got a sec?" / "I'd love your take on "{title}" when you have a moment." |
| `sage-suggestion-follow-up.ts:53-84,120` | "Sage closed a suggestion" plus terse reasons like "The person asked left the circle" | "I've closed this one" with the reason written as a full, plain sentence. |
| `services/sage-community-question.ts:90` | "This connects to our goal: {goal}." | "It ties right into our goal of {goal}." |
| `services/sage-weekly-outreach.ts:97,99` | "How is that sitting with you this week?" | "How's that going for you? And how are things outside the Commons?" |
| `services/sage-checkin-followup.ts:51` | "What would make the biggest difference for you this week?" | "Is there anything that would make this week a little easier?" |
| `proposal-engine.ts:~1271-1298` (verdicts) | "below the co-op's minimum threshold…", "meets the co-op's screening standards" | "This one isn't quite ready for a vote yet. A few changes could get it there." / "Nice work, this is ready for members to discuss and vote on." |
| Decision-trail steps members can read (`commons-action-agent.ts:296,397,598,601,615`; `sage-reply-trails.ts:91,102`) | "The active charter (version N) and N mission goals", "Sent the standard reply without asking the model", "Analysis failed" | "Checked our rules and goals", "Sent a ready-made reply", "Something went wrong, so Sage didn't act" |

## App copy

### Fixes that cover many strings at once

| # | Pattern | Fix |
|---|---|---|
| A | Server "Failed to… / not found / Unauthorized / Invalid / Insufficient / Cannot" messages shown word for word (~175 messages) | Add those patterns to `TECHNICAL_PATTERN` in `apps/mobile/lib/friendly-error.ts` so the screen's "We couldn't…" fallback wins. Over time, write new server messages as "We couldn't…" or "You can't…". |
| B | Title Case labels and buttons (~124), like "Add Bank Account" and "Transaction History" | Use sentence case everywhere. |
| C | "Submit / Resubmit / Submitted" (~15) | Use "Send" or the specific action. |
| D | "Connect your wallet" (~10), even though wallets are set up automatically | "Finish setting up your account to join in." |
| E | Governance and finance words: threshold, disbursement, deliberation, treasury, compliance, alignment (~30) | Use a small glossary: plain word first, with a one-line explanation where the real term has to stay. |
| F | Raw enum values shown to members ("votable", "submitted"): `commons/[coopId].tsx:148`, `checkout-hybrid.tsx:104`, `proposal-detail.tsx:48` | Map them through one plain-words table. `plainStatus()` in `proposal-detail.tsx:64` already exists. |
| G | "common" instead of "commons" (9 places): `spaces.tsx`, `group/[groupId].tsx`, `commons-ai-entry.tsx`, `routers/groups.ts:670,805` "Join this common first." | This is a typo; fix it. |
| H | Hard-coded "SC" / "UC" in notifications and errors: `store-pay-service.ts:406-511` "SC Reward Earned!", `uc-transfer.ts:365` | Use the tenant's `scTokenName`. **This is a correctness bug, not just tone.** |
| I | "Are you sure… This action cannot be undone." (4 places) | "Delete this? You can't get it back." |
| J | Three names for the AI: "Sage", "Commons AI", and "AI Review / AI Scoring / AI Alternatives" | Call it Sage everywhere. |

### Screen-by-screen highlights

**Proposals** (`apps/mobile/app/(authenticated)/proposal-detail.tsx`)
- Status badges "AI Review" and "Deliberation" (:54) → "Being checked" and "Open for discussion".
- "AI Scoring Complete · Score: 82% · Advanced" (:458-463) → "Check done: good fit (82%)".
- "Not aligned with commons goals — see AI notes below" (:475) → "This doesn't fit our goals yet. The notes below say why."
- "Members can react & comment — council reviews sentiment" (:491) → "Tell the council what you think. They read every reaction."
- "AI Auto-Approved / Budget below auto-approve threshold…" (:523) → "Approved. It costs under $X, so it didn't need a council vote."
- "Funds disbursed ✓ / Pending disbursement" (:545) → "Money sent ✓ / Waiting for the money to go out".
- Section headers "Below Threshold, Risk Flags, Violations, Compliance Checks, AI Alternatives" → "Not there yet, Things to watch, Breaks a rule, Rule checks, Other ways to do it".
- "Resubmit for Review / Re-evaluating…" → "Send changes / Checking again…".

**Commons info page** (`apps/mobile/app/commons/[coopId].tsx`)
- The "Governance" tab (:116) → "How we decide".
- "Overview, community, and governance details are only visible to approved members." (:829) → "Ask to join to see what's going on inside."
- "Funding thresholds / Small proposal lane / Member approval threshold" → "Who needs to OK what / Small asks / Votes needed to pass".
- The Treasury card (:1621-1644) shows dev text: "…once treasury accounting is exposed to members", "Not configured". → "Shared money" / "Soon you'll see how much money the commons has here." Put the safe address behind a details link.

**Home and feed** (`apps/mobile/components/commons-ai-entry.tsx`)
- "The post was saved, but the server did not place it in this feed." (:857) → "Your post went up, but it landed somewhere else. Check General before you post it again."
- "No scams, harassment, hate, extraction, or charity-only spaces." (:181) → "No scams, harassment, or hate. Every commons should give back to its members."
- "Circle View" and "Explore all Commons directory" → "Your circles" and "Browse all commons".

**Login and onboarding** (`apps/mobile/components/onboarding-flow.tsx`)
- "Log in with code / Verify & Sign In / Verification Code / Resend Code" → "Email me a code / Sign in / Your 6-digit code / Send a new code".
- "Code Sent / Login code sent to your email" (also `routers/auth.ts:406,434`) → "Check your email / We sent a code to {email}."
- "Step 1 of 4: Personal Information … Submit Application / Application Submitted!" → "About you … Send my application / Got it! Your application is in."
- "Choose Your Commons / Eligibility / No commons available at this time." → "Find your commons / Who can join / No commons are open right now. Check back soon."

**Messages** (`apps/mobile/app/(tabs)/messages.tsx`)
- "DMs should stay secondary… The main community knowledge should live in posts and comments." (:493) lectures members. → "Messages are just between you two. If it would help others, share it as a post."
- "Private follow-up needs an email-verified account." (:269) → "To message someone, sign up with your email."

**Sage UI**
- Decision trail labels "Evidence gathered / Action considered / Policy check / Action taken" (`components/sage-decision-trail.tsx:10-13`) → "What Sage looked at / What Sage thought about doing / Rules Sage checked / What Sage did".
- "Show Sage decision trails" (`sage-settings.tsx:14`) → "Show how Sage decides".
- "For your awareness / This alert has expired." (`sage/alert/[id].tsx`) → "Just so you know / This one's out of date now."
- "It's a computer program, not a person." (`sage-intro.tsx:10`) → "Sage is AI, not a person."

**Wallet and payments**
- Export wallet: "Critical Security Information / Verify Your Identity / Wallet Signing Enabled" → "Keep this safe / Make sure it's you / This phone is set up". Keep "private key," but explain it once: "it works like a master password for your money."
- Checkout: "This purchase will use your commons membership for checkout." → "You're buying as a member of {commons}." Keep "fee," and add "Goes to your commons' shared fund."
- Store verification agreement (`apply-sc-verification.tsx:338`): keep the percentages, but write it as "I get it: customers pay X% on top of my price, and Y% of what I earn goes to the commons' shared fund."
- "Withdrawal Initiated" → "Your money's on the way". "Pending claim" and "Awaiting claim" are both used; pick one plain phrase, such as "Waiting for them to accept it".

**Notifications**
- "Payment Issue / Please contact support for a refund." (`p2p-service.ts:332`) → "Your payment didn't go through. Reach out and we'll get your money back."
- The guide push in `welcome-intros.ts:385` shows a raw commons ID and "Assign a guide from the admin portal: URL". → "{name} said hi in {lounge} a while ago and no one's answered yet. Can you find them a guide?"

## What rewording will touch in tests

- **Login button labels** are used by the shared sign-in helper `apps/mobile/e2e/support/auth.ts`, so renaming them breaks nearly every Playwright spec. Do that rename on its own, together with the helper update.
- Other high-traffic copy asserted in specs: the "Governance" tab and "Funding thresholds" (`commons-info-page.spec.ts`), "Proposal Details" (`governance-confirmations.spec.ts`), "Show Sage decision trails" (`sage-decision-trail.spec.ts`), the Sage steering line (`agent-decision-trails.spec.ts`), money screen headers (`money-screens.spec.ts`), and "Circle View" (`circle-view.spec.ts`).
- Sage template text is asserted in about 20 unit tests under `packages/trpc/src/__tests__/`, mainly `sage-reply-templates`, `sage-checkin-followup`, `sage-member-memory`, `sage-private-signals`, `sage-proactive`, `sage-thanks`, `sage-tasks`, `sage-suggestion-follow-up`, and `agent-trails`.
- `apps/mobile/lib/__tests__/friendly-error.test.ts` will need new cases for pattern A.

## Suggested order

1. Fix the `friendly-error.ts` filter (A) and the hard-coded "SC"/"UC" (H). These are small, cover the most screens, and H is a real bug.
2. Add the shared Sage voice block, then rewrite Sage's canned replies, notifications, and decision-trail steps.
3. Proposal detail and the Commons info page.
4. Messages, Sage UI, wallet and payments.
5. Login and onboarding last, as a separate change, because of the shared E2E sign-in helper.
