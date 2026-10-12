# Website redesign: from co-op platform to community social app

_Recommendations only. Last updated 2026-10-12. No code has changed._

## 1. What the member app is today

From `apps/mobile/app/(authenticated)`, recent `main` history (#205–#224), `AGENT.md` and `docs/sage-roadmap.md`, the iOS app is now mainly a social product:

- **Commons feed**: posts, comments, @mentions that link to profiles, and Slack-style emoji reactions with a full picker (#214).
- **Circles and groups** (`group/[groupId]`, `spaces`): smaller rooms inside a commons. Members can switch between commons from Circle View (#208).
- **Sage**, the commons' AI member (`sage/`): replies grounded in the charter, consent-first introductions and mutual matches (rides, stores, posts), proactive suggestions with follow-up, weekly outreach (#223), and a visible decision trail.
- **Family commons** (`create-family`): guided setup, goal priorities, and steward approval for invites.
- **Invites** (`commons-invites`): a guide role lets members invite people directly (#205). Real-time alert popups.
- **Stores, resources and payments**: member stores, resources, quick pay and scan-to-pay, and earning the coin.
- **Proposals**: still there, but now one tab among several rather than the main thing.
- **Phone-first sign-in** with an email fallback. The app is iOS only (Android in preparation), and there is no web build of the app.

## 2. Where the homepage is out of date (`apps/web/app/page.tsx`)

- The hero and meta description are about members, businesses and *shared decisions*. The longest section, and 5 of the 7 FAQs, are about how the "Commons AI Agent" governs proposals. That is the product's back office, not the reason anyone downloads the app.
- It never says "Sage". It shows nothing of the feed, circles, reactions, families or matches.
- It has no phone mockups or real screenshots. The visuals are abstract diagrams ("Members, spaces, local businesses, and decisions connect…").
- The only App Store CTA is the hero button from PR #226. The final "next step" CTA goes to a commons directory or an interest list, not to the app.
- It has no social proof: no member voices, counts, ratings or commons logos.
- It does not explain how invites work (how do I get in?) or that families can use it too.

## 3. What comparable sites do

| Site | Pattern worth borrowing |
|---|---|
| **Clubhouse** | The homepage is almost nothing: brand, one "get clubhouse" link, and the footer. It works only because the brand is already known. Lesson: don't copy the minimalism; copy the *single action*. |
| **Geneva** | Hero: "The online place to find your offline people", with a rotating line ("Find natural explorers in Los Angeles"). One Download button. Built around people and places, not features. |
| **Partiful** | A big playful hero, a wall of press quotes, emoji in the headings, feature sections that each repeat "Get the app", and an App Store rating with real reviews ("5.0 • 217K Ratings"). Shows the guest list and reactions as the social hook. |
| **Nextdoor** | Trust first: "neighbors verify their address to join". Has a "Have an invite code?" path and a separate business entry point. |
| **Discord / BeReal** (from memory, not re-checked) | Discord shows big product screenshots of servers and channels in a friendly illustrated style. BeReal leads with one idea and a phone mockup. |

Patterns they share: a people-first headline, one primary CTA repeated in every section, real app screens in phone frames, social proof, and a clear answer to "how do I get in?"

## 4. Prioritised recommendations

### P1. Rewrite the hero around people, not governance (S)
- **Now:** "A place for your commons to move together" and a business, decisions and agent framing.
- **Change:** A people-first headline with a subhead naming 3 concrete things: your circles, your people, and Sage. Keep the #226 App Store badge as the primary CTA. Add a secondary "Have an invite?" link (see P5). Update `metadata` and the OG description.
- **Why:** Every comparable site sells belonging in one line. Governance is a reason to trust the product, not a reason to download it.
- **Touches:** `page.tsx` hero and metadata, `layout.tsx` OG text, `landing.css` hero.

### P2. Replace the abstract diagrams with real app screens in phone frames (M)
- **Now:** A diagram of nodes ("Your commons", "Spaces & circles"…).
- **Change:** 3–4 iPhone mockups: the commons feed with reactions, a circle, a Sage match card ("Two members are driving to the market Saturday…"), and the family setup. Use seeded demo data with no real member PII and a generic coin name. Make it a scroll-snapping strip on mobile.
- **Why:** Discord, Partiful and BeReal all *show* the product. The site currently describes an app nobody can see without installing it.
- **Touches:** a new `PhoneFrame` component, `public/screens/*`, and `landing.css`. Screens can be captured with the existing mobile Playwright setup.

### P3. Make Sage a named, friendly character, and move proposals lower (M)
- **Now:** The "Commons AI Agent" appears mostly as a proposal judge, plus a long FAQ about decision limits.
- **Change:** A "Meet Sage" section covering introductions and mutual matches, catching needs and offers in the feed, following up, and answering from your commons' own charter. Add a "What Sage won't do" trust line (no votes, no spending, no membership changes without people) based on the roadmap's boundaries. Shrink "From an idea to a decision" to a short "Decide together" card, and move the detailed governance FAQs to a `/how-it-works` or `/governance` page.
- **Why:** Sage is the product's distinctive social feature. Leading with its limits keeps trust without making the page feel like a bylaws document.
- **Touches:** `page.tsx` sections and FAQ, a new `app/how-it-works/page.tsx`.

### P4. Repeat the download CTA and add a sticky mobile bar (S)
- **Now:** One App Store button, in the hero.
- **Change:** Add the badge to the end of the feature sections and the final "next step" block, and as a sticky bottom bar on mobile. Add an "Android coming soon — get notified" link to the existing interest list. Since there is no web app, never link to app paths.
- **Why:** Partiful repeats "Get the app" in almost every section.
- **Touches:** an `AppStoreBadge` component used in several places, plus `landing.css`.

### P5. Explain how to get in: invites, guides and joining (S–M)
- **Now:** "Find a commons" goes to a directory, with no explanation of invites.
- **Change:** A 3-step strip: "Get invited by a member or guide → Sign in with your phone → Jump into your circles". Add "Start a family commons" and "Start a commons for your community" paths that lead to the interest form. Mention that stewards approve phone-only joins.
- **Why:** Nextdoor's "Have an invite code?" and Clubhouse's invite-era mystique both make access legible.
- **Touches:** `page.tsx` and `c/` pages (add a download CTA to each commons page so shared links convert).

### P6. Add social proof (M; depends on content)
- Short member quotes (with consent), counts such as commons, circles and members once they are flattering, the App Store rating once there are enough reviews, and logos or names of public commons from `c/`. Partiful's review wall is the model.
- **Touches:** `page.tsx` and a static `testimonials.ts`.

### P7. A section for families (S)
- "Your family, organised": shared goals with priorities, invites with an adult approving, and a private space. This is a distinct, relatable entry point that no competitor here covers.
- **Touches:** `page.tsx` and `public/screens/family.png`.

### P8. Reposition local business and the coin as "support your people" (S)
- Keep the stores section but frame it socially: "Buy from members, earn the coin, see your money stay local." Never name a specific tenant's coin. Keep `/business` as a separate entry point, as Nextdoor does.

### P9. Visual tone (M–L, optional)
- Warmer and more human: photography of real gatherings, emoji or reaction accents (the app now has reactions), and less of an "institutional" palette. Keep gold, cream and charcoal so the site matches the app.

## 5. Suggested new homepage outline

1. **Hero:** headline, subhead, App Store badge, "Have an invite?" link, and a phone mockup of the feed.
2. **Proof strip:** member quote or rating, plus "Used by N commons".
3. **Your people, in one place:** feed, circles and reactions (3 phone frames).
4. **Meet Sage:** matches, follow-ups, charter answers, and "What Sage won't do".
5. **For families:** goals and safe invites.
6. **Support your people:** stores, resources and the coin.
7. **Decide together** (compact), linking to `/how-it-works`.
8. **How to get in:** invite, phone sign-in, circles, and start your own commons.
9. **Find a commons:** the existing directory.
10. **Short FAQ:** what a commons is, privacy, the cost, Android, and what Sage does.
11. **Final CTA:** App Store badge, plus "Android coming soon" signup.

## 6. Draft copy

**Headlines (pick one):**
- "Your people, all in one place."
- "The app for the communities you actually belong to."
- "Find your people. Look out for each other."
- "Where your community keeps showing up for each other."

**Subhead:** "Join your commons, chat in circles, plan with your family, and let Sage introduce you to the members who can help, or who need you."

**Meet Sage:** "Sage is your commons' helper. It notices when someone needs a ride and someone else is driving, answers questions from your own charter, and follows up so things don't slip. Sage never votes, spends or makes membership changes for you. People decide."

**How to get in:** "1. Get an invite from a member. 2. Sign in with your phone number. 3. You're in your circles."

**Families:** "Set your family's goals, decide what comes first, and keep everyone in the loop, with a grown-up approving every invite."

**Final CTA:** "Your community is already here. Download Cahootz Commons for iPhone." Below it: "On Android? Tell us and we'll let you know."

App Store URL: https://apps.apple.com/us/app/cahootz-commons/id6772781102
