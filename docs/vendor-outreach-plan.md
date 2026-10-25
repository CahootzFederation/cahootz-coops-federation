# Vendor finding and outreach: plan

Status: approved 2026-10-26. Phase 1 is built (weekly demand check and interest question, Recommend a business, the prospect list in the admin portal). Phases 2-5 are not built.

## Goal

Find local businesses willing to give a Commons a Member Deal or Group Buy, without a person doing the legwork.

- Sage spots what members want and checks that interest with the whole Commons.
- Sage then proposes an outreach campaign to a platform admin.
- Once a campaign is approved, Sage finds businesses and emails them on its own, within the campaign's limits.
- When a business says yes, a platform admin takes over, closes the deal, and sets up the offer using the Member Deals system that already exists.

### Decisions made

| Question | Decision |
|---|---|
| Who approves | A platform admin approves each campaign. |
| What Sage does alone | Within an approved campaign: finds businesses, writes and sends the first email, and sends one follow-up. |
| Hand-off | A vendor's "yes" goes to a platform admin, who reaches out, negotiates, and creates the offer. |
| Where Sage looks | Shops already on Cahootz, member referrals, and web search. Sage can suggest new sources, which an admin turns on. |

### Why this fits the existing Sage rules

The Sage stewardship spec forbids contacting "an external party without explicit workflow authorization." An approved campaign is that authorization.

- It is written down, has limits, can be paused, and is audited. Every rule is enforced in code, not in prompts (AGENT.md 391-405).
- Sage never negotiates, promises a price, signs anyone up, or replies to vendor emails.
- Sage never contacts members through this feature.

## How demand is found without breaking member privacy

Your rule: Sage's guesses about the community ("hypotheses") never go to one person; Sage asks the whole Commons instead. The pipeline follows it:

1. **Private signals (already built).** Sage already saves members' non-sensitive needs from check-ins as anonymous patterns, with a minimum of 5 people or 20% of active members (`sage-community-memory.ts`). These stay internal.
2. **Open interest question (new).** When a pattern maps to something a business could sell, Sage posts a fixed-wording question to the whole Commons. For example: "Would a group buy on groceries help your household? React 👍 or comment if you'd join." It also asks this when public Need/Ask posts cluster on a topic.
   - Responders are counted with the existing `countQuestionResponders`.
   - Cooldowns: one interest question per Commons per week, and the same category at most once every 60 days.
3. **Public evidence only.** A campaign proposal cites only what members said in the open: the number of households who responded and the number of related public Need posts. The admin never sees private signals.

A small mapping in code links the existing need themes (`THEMES` in `sage-private-signals.ts`) to deal categories:

| Need theme | Deal categories |
|---|---|
| food access | groceries, bulk staples, produce |
| childcare and care | baby supplies |
| transportation | auto repair, tires |
| digital access | phones, internet |
| learning and school | school supplies |

Health and money themes stay excluded, as they are today.

## Data model (new, all `@@schema("public")`)

- **`VendorCampaign`**
  - Scope and target: `coopId`, `category`, `searchTerms[]`, `area` (city, state or zip, which the admin can edit), `offerType` (MEMBER_DEAL or GROUP_BUY).
  - Why it exists: `demandEvidence` JSON with the interest count, public Need-post count, source post ids, and the question post id.
  - Limits: `maxEmails` (default 10), `maxSearches` (default 5), `expiresAt` (default 30 days).
  - What the pitch can say: `pitchPoints`, edited and approved by the admin.
  - Status: PROPOSED → APPROVED → ACTIVE ⇄ PAUSED → COMPLETED, EXPIRED or REJECTED.
  - Records: `proposedAt`, `approvedById`, `approvedAt`, `rejectReason`.
- **`ProspectSource`**
  - Fields: `type` (CAHOOTZ_SHOPS, MEMBER_REFERRALS, WEB_SEARCH, DIRECTORY_SITE), `name`, `config` (for example a directory domain plus query hints), `suggestedBy` (sage or an admin), `status` (SUGGESTED, ENABLED or DISABLED).
  - Sage can suggest a source, such as a chamber-of-commerce directory or a farmers-market vendor list. Only an admin can enable it.
- **`VendorProspect`**
  - Who they are: `businessName`, `website`, `email`, `phone`, `address`, `category`.
  - Where they came from: `sourceType`, `sourceUrl` (where the contact was found), `storeId` (if already on Cahootz), `referredByUserId` and `referrerMayBeNamed` (for referrals).
  - Pipeline: `status` (see below), `convertedOfferId`.
  - Rule: one prospect per email or domain across the platform.
- **`CampaignProspect`**: links a prospect to a campaign, with `status`, `firstSentAt`, `followUpSentAt` and `respondedAt`.
- **`OutreachMessage`**
  - Fields: `campaignProspectId`, `step` (FIRST or FOLLOW_UP), `subject`, `body`, `status` (QUEUED, SENT, DRY_RUN or FAILED), `resendId`, `sentAt`.
  - `@@unique([campaignProspectId, step])`, so nothing is ever sent twice.
- **`OutreachSuppression`**: `email` or `domain`, `reason` (UNSUBSCRIBED, BOUNCED, ASKED_NOT_TO, ADMIN), `createdAt`. Checked before every send.
- **`VendorResponse`**
  - Filled in from the vendor's reply page: `interest` (YES, NOT_NOW or UNSUBSCRIBE), `contactName`, `bestContact`, `offerIdea`, `respondedAt`.
  - The reply page uses a random token, with only its hash stored.

**Prospect pipeline:**
- Main path: FOUND → VERIFIED → QUEUED → CONTACTED → FOLLOWED_UP → INTERESTED → IN_TALKS (admin) → CONVERTED.
- Other endings: DECLINED, UNSUBSCRIBED, BOUNCED, or SKIPPED (no email, duplicate, suppressed, or already contacted in the last 90 days).

## Sage's steps

### 1. Weekly demand check

A new Trigger task, `vendor-demand-weekly`, runs Mondays at 05:00 UTC, after the 04:30 memory consolidation. It runs once per Commons, with the idempotency key `vendor-demand:<coopId>:<isoWeek>`.

- **Posting a question:** reads active community signals and the last 30 days of public Need/Ask posts, maps them to deal categories, and posts at most one interest question. The question uses a fixed template and makes no model call.
- **Proposing a campaign:** 7 days after a question, counts responders. If at least 5 households responded (or more if the Commons is large), Sage creates a PROPOSED campaign:
  - search terms come from the category map;
  - the area comes from the Commons' location if one is set, otherwise the admin fills it in.
- **Notifying:** platform admins are told through the admin portal and the existing Slack notification.

This needs no model calls. Stores already on Cahootz in that category are matched by a database query.

### 2. Admin approval

New web pages at `/portal/admin/outreach` and `/api/admin/outreach/**`, gated by the platform-admin allowlist like the offers pages.

- **What the admin sees:** the evidence, a preview of the email Sage would send, the limits, and matching Cahootz shops.
- **What the admin can do:** edit the area, limits and pitch points, then **Approve**, **Reject**, **Pause** or **Resume**.
- **Records:** every action is audited.

### 3. Finding businesses

The hourly `vendor-outreach-sweep` handles ACTIVE campaigns that still need prospects. It checks sources in this order:

1. **Cahootz shops:** approved stores in the category, nearest area first. Contact uses the existing in-app owner notification plus email to the store's contact email.
2. **Member referrals:** businesses members recommended in that category.
3. **Web search:** a short-lived research worker using `webSearchTool` from `@openai/agents`.
   - It is already a dependency (the proposal engine and newsletter agent use it), so no new API key is needed.
   - It runs at most `maxSearches` queries per campaign, and enabled directory sites are added as `site:` hints.
   - Output is structured: business name, website, public business email, phone, address, the URL where each contact was found, and why it's relevant.
   - Rule: only contact details the business publishes itself (its own site or a business listing). Nothing behind a login, and no personal social profiles.
   - Sage may also suggest new `ProspectSource` rows it came across.

**Checks in code before anyone is queued:**
- email format, and a mail-server (MX) lookup with Node's built-in `dns`;
- dedupe by email and domain across the platform;
- the suppression list;
- not contacted by any campaign in the last 90 days.

Prospects with no email become SKIPPED (phone only) and appear in the admin list, in case the admin wants to call.

### 4. Sending the email

Code builds each email. Sage writes only one short personal paragraph.

**Who the email is from:** Cahootz Commons. The email never mentions Sage, AI, or the specific Commons or church.
- It's signed "The Cahootz Commons team", never with a made-up person's name, and it never claims to be written by a person.
- If a vendor asks who they're talking to, a real person on the team answers. Sage never replies to emails.

**Fixed parts from code:**
- **Opening:** "Hi {business}, I'm reaching out from Cahootz Commons, a network of community groups that buy from local businesses together."
- **Facts block:** "{N} households in a community near you said they'd buy {category} together", using numbers from the campaign record, never from the model. The area is general (city or neighborhood), never the Commons' name.
- **How deals work:** members pay your price through Cahootz, there's no markup for members, and Cahootz and the Commons each take a small agreed share. Exact rates are discussed with a person.
- **The ask:** one link to the vendor's reply page.
- **Footer:** the mailing address, an unsubscribe link, and a `List-Unsubscribe` header.

**Sage's paragraph:**
- Written by gpt-5.6-luna, at most 600 characters, explaining why this business fits, based on what the search found.
- It must pass a new outreach check. The check blocks dollar amounts, promises ("guarantee", "we will buy", "contract", "deal is done"), links, claims about specific members, and anything that says or implies leadership approved something.
- If the check fails, the email goes out without the paragraph rather than with bad text.

**Sending:**
- **Sender:** a new outreach address on its own sending subdomain, separate from login codes and receipts, shown as "Cahootz Commons". A suggested address is `partners@deals.cahootzcoops.com`.
  - Cold email gets more spam complaints than transactional mail. Keeping it on its own subdomain means a bad week of outreach can't push login codes into spam.
  - Configured by two new env vars, approved by you: `RESEND_OUTREACH_FROM_EMAIL` (the sender) and `OUTREACH_REPLY_TO_EMAIL` (a real inbox the team reads, for example `partners@cahootzcoops.com`).
  - Sending refuses to start until both are set and the mailing address is in `PlatformConfig`.
- A new exported `sendVendorOutreachEmail` in `lib/email.ts` uses that sender and reply-to and adds the unsubscribe headers.
- **The email links to two places:** the vendor reply page, and the new businesses page (below), so a vendor who searches for us finds a real explanation.
- When Resend isn't configured (local runs and CI), messages are saved as DRY_RUN and not sent.

**Limits, all enforced in code:**
- per-campaign `maxEmails`;
- at most 20 outreach emails a day across the platform;
- weekdays, 9am to 5pm in the Commons' time zone (defaulting to Eastern);
- one follow-up after 5 business days, then stop.

### 5. When the vendor answers

There's a public reply page at `apps/web/app/v/[token]`, with a token per prospect and no sign-in. It offers three choices:

- **"Yes, I'm interested":** the vendor gives a name, the best way to reach them, and optionally what they could offer. The prospect becomes INTERESTED, and platform admins get Slack and admin-portal alerts. **Sage stops here.**
- **"Not right now":** the prospect becomes DECLINED, and Sage won't contact them again for 180 days.
- **"Unsubscribe":** the vendor is suppressed permanently. Unsubscribing takes one click.

Replies to the email itself land in the support inbox, where an admin can mark the prospect's status by hand.

### 6. Closing the deal (people)

On an interested prospect, the admin has **Mark in talks**, **Mark declined** and **Mark converted**.

- To convert, the admin helps the vendor open a shop (the existing store application and Stripe onboarding).
- The admin then creates the offer in the existing offers admin. The steward still approves it as today, and the prospect links to the new offer.

## The main website, a businesses page, and a blog post

The main site (`apps/web/app/page.tsx`) is built for members. Today a vendor who looks us up finds very little written for them:
- one link, "Bring your business into the commons", to an interest form;
- a treasury calculator that says 4-15% of member spending comes out of business revenue, which contradicts the no-markup, small-share pitch;
- old wording in places a vendor can reach: "Unity Coin" in the business form, "community-owned economies" in the site title and social previews, and a public `/buy` page selling Unity Coins.

**Before the first email goes out:**
1. **A focused page for businesses** at `/for-businesses`. It's linked from the landing nav and footer, and every outreach email links to it. It covers:
   - what Cahootz Commons is;
   - how Member Deals and Group Buys work;
   - how vendors get paid: members pay your price through Stripe, there's no markup for members, and Cahootz and the community each take a small agreed share;
   - what we ask of you: a member price, and pickup or delivery;
   - a "Talk to us" form.
2. **A "For local businesses" section on the main page**, replacing the treasury calculator, with a short pitch and a link to `/for-businesses`.
3. **Clean up what a vendor can see:**
   - the "Unity Coin" placeholder in `business-signup-form.tsx`;
   - the site title, description and social-preview text in `app/layout.tsx`;
   - the blog page heading;
   - the public `/buy` Unity Coin page (remove it or redirect it);
   - one contact address everywhere (today the site uses hello@cahootz.coop and team@cahootzcoops.com);
   - adding `/contact` and `/for-businesses` to `sitemap.ts`.

**A blog post (helpful, not required).** For example "Why local businesses are giving Cahootz communities a better price." The existing post "From Customers to Co-Owners" is the only one aimed at businesses, and it predates Member Deals.
- Posts come from Notion and are re-synced on every build, so a post has to be published in Notion. I can draft the text.

## Member referrals (mobile)

A **Recommend a business** form, reached from the marketplace's Deals section and the vendor-less categories:

- **Fields:** business name, what they sell, plus any of website, email or phone.
- **Questions:** "How do you know them?" and "Can we mention you?" (default no).
- **Confirmation:** a tick box confirming it's the business's public contact or the member has their OK.

Each referral creates a `VendorProspect` with the source MEMBER_REFERRAL. Rate limit: 5 referrals per member per day, matching the spirit of the invitations cap.

## Guardrails summary

**Sage may do automatically:**
- post interest questions with fixed wording;
- propose campaigns;
- suggest sources;
- find and verify businesses for an approved campaign;
- send the first email and one follow-up within limits.

**Needs a platform admin:**
- approving, editing, pausing or ending a campaign;
- enabling a source;
- everything after a vendor says yes.

**Sage never:**
- emails without an active approved campaign, or past its limits;
- signs as a made-up person or claims a person wrote the email;
- names an individual member;
- names a referrer without permission;
- promises prices or terms;
- negotiates;
- replies to vendor emails;
- texts or calls anyone;
- creates offers;
- contacts members.

**Privacy:** emails carry only aggregate public counts and a general area. They never name a Commons, a church or any member.

**Pausing:** pausing a campaign stops all sends immediately. An expired campaign sends nothing.

**Records:**
- an audit entry for every send, skip, approval and response;
- a Sage decision trail for every campaign proposal and every model-written paragraph.

## Cost

| Activity | Cost |
|---|---|
| Demand check and interest question | No model calls |
| Web search | About $0.012 per call, up to 5 per campaign |
| Sage's paragraph | About $0.0006 per email (luna) |
| **Whole campaign** | **About $0.07 at most** |

New feature keys (`vendor-outreach-research`, `vendor-outreach-draft`) are added to `AUTONOMOUS_SAGE_FEATURES`. That way they count toward each Commons' monthly Sage limit (default $5) and stop when it's hit. Costs are recorded through `recordAICost`.

## Phases (each ships on its own)

1. **Demand and referrals:** the theme-to-category map, the weekly demand check and interest question, the referral form, the `VendorProspect` model, and the admin prospect list.
2. **Campaigns:** `VendorCampaign`, Sage's proposals, the admin approve/edit/reject page, and `ProspectSource` with Sage's suggestions.
3. **Discovery:** Cahootz-shop matching, referral matching, the web-search research worker, and the code checks (MX lookup, dedupe, suppression).
4. **Outreach:** the website work above (ships first in this phase), the email builder and outreach check, `sendVendorOutreachEmail` with unsubscribe headers, the hourly sweep with limits and the follow-up, the vendor reply page, and suppression.
5. **Hand-off and results:** admin pipeline actions, linking prospects to offers, and a funnel report: questions asked → interest → campaigns → contacted → interested → converted.

## Files likely to change

**Database:** `packages/db/prisma/schema.prisma`, plus a migration `<ts>_vendor_outreach`.

**Sage services:** `packages/trpc/src/services/vendor-outreach/`, containing:
- `categories.ts` (the theme-to-deal map)
- `demand.ts`
- `campaigns.ts`
- `discovery.ts`
- `research-agent.ts`
- `verify.ts`
- `email-builder.ts`
- `outreach-check.ts`
- `sweep.ts`
- `responses.ts`

**Shared Sage changes:**
- `packages/trpc/src/services/sage-autonomy.ts` (new feature keys)
- `packages/trpc/src/lib/email.ts` (`sendVendorOutreachEmail`)
- `packages/trpc/src/services/sage-community-question.ts` (deal-interest template), or a sibling file that reuses `countQuestionResponders`

**Router:** `packages/trpc/src/routers/vendor-outreach.ts`, covering member referrals and the public vendor-response endpoints.

**Trigger tasks:** `apps/api/src/trigger/vendor-demand.ts` and `vendor-outreach.ts`.

**Web:**
- `apps/web/app/portal/admin/outreach/**`
- `apps/web/app/api/admin/outreach/**`
- `apps/web/app/v/[token]/page.tsx`
- `apps/web/app/v/unsubscribe/page.tsx`

**Mobile:**
- `apps/mobile/app/(authenticated)/recommend-business.tsx`
- a link from `components/marketplace-lane.tsx`
- `lib/api.ts`

**Docs:** `docs/sage-roadmap.md` (decision log, what Sage may now do), `TESTING.md`, `AGENT.md` (one line under Autonomy Boundaries: "contacting businesses within an admin-approved outreach campaign").

## Tests

**Unit tests:**
- the theme-to-category map;
- interest thresholds and cooldowns;
- campaign status changes;
- email builder output, where code-inserted numbers match the record and the footer and unsubscribe are always present;
- the outreach check refusing promises, prices and links;
- suppression and 90-day dedupe;
- daily and per-campaign caps;
- send idempotency (a second sweep run sends nothing);
- reply-page token handling;
- refusal when no campaign is approved, or when it's paused or expired;
- cost-limit fail-closed.

**Research worker:** a unit test with a mocked web-search tool, plus a live `@sage` check that it returns sourced, structured results.

**E2E:**
- **Mobile:** recommend a business, then see it saved.
- **Web admin:** a proposed campaign shows evidence, the admin approves it, and prospects appear.
- **Vendor reply page:** "Yes" marks the prospect interested; "Unsubscribe" suppresses it.
- Sends run in DRY_RUN mode, so no real email leaves in tests.

## Open decisions

1. **Mailing address for the email footer.** US anti-spam law (CAN-SPAM) requires one. We'd keep it as a `PlatformConfig` value, and sending is refused until it's set.
2. **The new sending address.** Pick the address and subdomain, add the DNS records Resend gives you (SPF, DKIM, and a DMARC policy) for that subdomain, and set up the reply inbox. This needs someone with DNS and Resend access.
3. **Disclosing automation.** The emails won't say they're automated. Some states, California for example, restrict bots that hide what they are in order to make a sale, so include this in the legal check. Never signing as a fake person keeps the risk low.
4. **Limits.** Are 10 emails per campaign, 20 a day across the platform, and one follow-up the right defaults?
5. **Personal email addresses.** If a business lists a personal-looking address (for example gmail), contact it or skip it?
6. **Where each Commons is.** There's no location field today, so admins type the area per campaign. Should Commons get a location field?
7. **Legal check.** Business-to-business cold email is generally allowed in the US with honest headers, a mailing address and a working unsubscribe. Have someone confirm it for your states.
