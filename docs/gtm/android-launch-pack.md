# Cahootz member app: Android launch pack

Drafted 2026-10-23. **Draft for review. Nothing here has been submitted to a store or posted anywhere.**

Android is in prep (PR #220 adds Play Store builds). iOS is live. There is no hosted web build of the member app, so every link below goes to Google Play, the App Store, or cahootzcoops.com. No app paths.

## How to read this

- `[VERIFY]` marks a claim I couldn't confirm from code. A person needs to check it before it goes anywhere public.
- Evidence is cited as `path:line` against `main` at `80f1b17a`.
- Voice follows "Voice: Personable and Plain" in `AGENT.md`. The coin is "the coin" everywhere. Cahootz is multi-tenant, so no tenant's coin name appears in this pack.
- No store metadata for iOS exists in the repo (no `store.config.json`, no `fastlane`). `apps/mobile/eas.json` only has the build profiles and the App Store Connect app id (`ascAppId` `6772781102`). So the listing below is built from the app code, not copied from the iOS listing. `[VERIFY]` the iOS listing text and keep the two consistent.

## Read this first: things I found that block or change the launch

These matter more than any of the copy. Most affect what Google and Apple will accept.

1. **Sentry records session replays and sends IP addresses, and the analytics doc doesn't say so.** `apps/mobile/app/_layout.tsx:29-43` sets `sendDefaultPii: true`, `replaysSessionSampleRate: 0.1`, `replaysOnErrorSampleRate: 1` and `Sentry.mobileReplayIntegration()`. So about 1 in 10 sessions, and every session with an error, is recorded as a screen replay. `docs/mobile-analytics.md` says "Session replay… off", but that's about PostHog only (`apps/mobile/lib/analytics.ts:212`). Both privacy labels below include Sentry. `[VERIFY]` that replay masks text and images (the SDK default is to mask both, and the code doesn't override it). If masking isn't confirmed, the Data Safety form should also declare screen content.
2. **Phone sign-in with Twilio Verify isn't in this code.** Mobile sign-in is an emailed code only (`apps/mobile/components/onboarding-flow.tsx:555-581`, `apps/mobile/lib/api.ts:2627-2673`), and the schema has no `phoneVerifiedAt` (`packages/db/prisma/schema.prisma:30` only has `phone String? @unique`). Twilio shows up once: `sendClaimSMS` texts a claim link to someone who isn't a member yet (`packages/trpc/src/services/sms.ts:35-78`). The project notes say phone login shipped in runtime 1.1.6. `[VERIFY]` whether phone login lives on another branch or was removed. The labels below describe what main does. If phone login ships, add "phone number used to sign in" and Twilio to both labels.
3. **"Delete Account" only deactivates.** The in-app dialog says "This will deactivate your Cahootz account and sign you out" (`apps/mobile/components/account-profile-screen.tsx:141`). The server sets `deletedAt` and revokes sessions and nothing else (`packages/trpc/src/routers/user.ts:576-590`). Google Play requires an in-app deletion path and a web URL for deletion requests, and the Data Safety form must say what is deleted and what is kept. The privacy page tells people to email team@cahootzcoops.com (`apps/web/app/privacy/page.tsx:100`) and keeps user-provided data for 12 months after use (`:94`). I wrote the form answers to match today's behavior. A person must decide: change the behavior, or say plainly what's kept.
4. **The privacy policy doesn't match what the app does.** `apps/web/app/privacy/page.tsx` is a generic template (IP address, pages visited, OS). It doesn't mention PostHog, Sentry replay, push tokens, photos and videos, Sage (OpenAI), Stripe, or contacts. Both stores require the policy URL to be accurate. Update it before the Play review. The canonical URL is `https://cahootzcommons.com/privacy` (`:18`).
5. **Sage's in-app intro says a proposal always waits for a person. The code says otherwise.** `apps/mobile/components/sage-intro.tsx` ("What always waits for a person: Submitting a proposal, spending or moving money…"). But `packages/trpc/src/services/sage-proposal-writer.ts` and `docs/sage-roadmap.md:415-433` have Sage writing a proposal and putting it up for a member vote. I did not repeat the "never submits a proposal" claim anywhere here. The in-app copy should be fixed. Money and membership still need a person, which I could confirm.
6. **Possible extra Android contacts permission.** `expo-contacts` is configured in `apps/mobile/app.json` and the app only reads contacts (`apps/mobile/lib/contact-invite.ts`). Expo's Android manifest for this module can also request write access unless it's removed. `[VERIFY]` the merged manifest after `expo prebuild` and strip `WRITE_CONTACTS` if present. Google asks about sensitive permissions in the Play Console.
7. **Bank-account and withdraw screens exist but nothing links to them.** `apps/mobile/app/(authenticated)/bank-accounts.tsx` takes a routing and account number, and `apps/mobile/app/withdraw.tsx` exists. A search of `app/`, `components/` and `lib/` finds no link into either one except from each other. I didn't count them as live features, and the listing doesn't mention cashing out. `[VERIFY]` whether they're reachable in the Android build. If they are, add "Financial info: bank account" to both labels.
8. **Is PostHog switched on in production?** `docs/mobile-analytics.md` says the key is an EAS build variable and the SDK is inert without it (`apps/mobile/lib/analytics.ts:3-5`). I can't see the EAS environment. `[VERIFY]` `EXPO_PUBLIC_POSTHOG_KEY` on the Android production profile. The labels below assume it's on, which is the safe way to answer. If it's off, still declare it: `docs/mobile-analytics.md` says the first analytics release ships as a new native build, so this one will.
9. **Smaller doc drift.** The events table in `docs/mobile-analytics.md` doesn't match `AnalyticsEvents` in `apps/mobile/lib/analytics.ts:22-76` (for example `onboarding_completed.exit` values and the proposal and invite events). The doc also says IP-based location is "fine"; the code does set `disableGeoip: true` (`:210`), which is stricter. Neither changes the labels. Worth fixing the doc.
10. **Don't reuse "Building Generational Wealth Together."** That's the default tagline in `apps/mobile/lib/coop-config.ts:57`. It reads like an investment pitch. It's not used in this pack.

---

## 1. Google Play listing

### App name (30 characters max)

**Cahootz**

(7 characters. This matches the `name` in `apps/mobile/app.json` and the home-screen name. `[VERIFY]` it matches the iOS listing name. Play title rules ban keyword stuffing and price claims, so keep it plain.)

### Short description (80 characters max)

> Your Commons in your pocket: post, ask for help, plan events, and vote together.

(80 characters exactly. Backup, 71 characters: "Ask for help, offer help, and decide things together with your Commons.")

### Full description (4,000 characters max)

```
Cahootz is where your Commons lives on your phone.

A Commons is a shared space for people who already have a real connection: a family, a neighborhood, a co-op, a group of friends who keep showing up for each other. In Cahootz you can post, ask for help, offer what you've got, plan things, and make decisions together. Every Commons runs its own space and has its own rules.

WHAT YOU CAN DO

• Post and talk. Share a question, an idea, or what you're working on. Add photos and short videos. Reply, react, and @mention people.
• Ask for help. Offer help. Put a need or an offer on the Board: a hand, advice, a ride, tools, time, a skill. See what's open in your Commons.
• Plan events. Set a date, a place, and who's hosting. People can RSVP, and everyone gets a reminder.
• Vote on ideas. Share an idea, work it into a proposal, and let members vote. You can see where a vote stands.
• Join your people. Your Commons can be open, by invitation, or approved by a steward (the member who looks after the Commons). Invite friends and family from your phone's contacts. Cahootz only opens your contacts when you choose to invite someone.
• Shop in your Commons. Browse stores run by members and pay on Stripe's secure checkout page. Store owners can set up a shop and take payments. Cahootz never sees your card number. [VERIFY]
• Get notified. Turn push notifications on or off, and pick which kinds you want.

MEET SAGE

Sage is your Commons' AI helper. It's a computer program, not a person. Sage reads posts in your Commons to notice what people need, connects people who can help each other, and suggests next steps. It can reply, send reminders, and post a regular catch-up. You can ask Sage what it remembers about you, and tell it to forget. Anything involving money or who's a member waits for a person. In Sage settings you can choose to see how Sage decided what to do.

ABOUT MONEY

Some Commons use a coin to keep track of contribution and take part in decisions. The coin is set up by each Commons, and what it's for is up to that Commons. It isn't an investment, and Cahootz doesn't promise any return. Payments in stores go through Stripe. You'll always see the amount before you pay.

PRIVATE WHERE IT MATTERS

You sign in with a code we email you. No password to remember. Cahootz uses your phone's own lock, like Face ID or a fingerprint, to confirm payments where it makes sense. You can delete your account from the app. [VERIFY: see "Read this first" item 3 for what deleting does today.]

Questions, bugs, or ideas? Use "Report a problem or idea" inside the app, or write to support@cahootz.coop. [VERIFY support address]
```

Length: 2,645 characters. Check the count again after any edit. The limit is 4,000.

Notes on the draft:
- "Everyone gets a reminder" for events: `[VERIFY]` that RSVPs trigger a reminder. I only confirmed RSVP exists (`apps/mobile/app/[coopId]/events/[eventId].tsx:121`). Cut that clause if reminders aren't real.
- "Open, by invitation, or approved by a steward": based on the three join policies `AUTOMATIC`, `INVITE_ONLY` and `APPLICATION_REQUIRED` in `apps/mobile/app/commons/[coopId].tsx:370-392`. `[VERIFY]` that an application is reviewed by a steward in every Commons.
- "Mention others" and "react": reactions and mentions are in the code (`components/reaction-bar.tsx`, `components/mention-composer-input.tsx`).
- "Always see the amount before you pay": the native checkout opens Stripe's hosted page (`components/commerce-payment-confirmation.native.tsx:38`), and the app's own screens show the order total (`components/fee-breakdown.tsx`). `[VERIFY]` there's no path where the amount isn't shown first.
- No coin balance, earning, or spending promises are made. The wallet screen shows a coin balance (`apps/mobile/components/account-profile-screen.tsx:196`), and verified stores can pay out coin rewards on sales. Rules differ by Commons, so I left specifics out.

### Feature bullets

For the "What's new" box and any short promo text.

1. Post, reply, and share photos and short videos with your Commons.
2. Ask for help or offer it on the Board.
3. Plan events with a date, a place, and RSVPs.
4. Vote on ideas and see where each vote stands.
5. Invite your people from your contacts. Cahootz opens them only when you choose.
6. Shop member-run stores and pay on Stripe's secure page.
7. Meet Sage, your Commons' AI helper. It's a program, not a person.
8. Pick exactly which push notifications you get.

### Release notes for the first Android build (500 characters max)

> Cahootz is on Android. Post to your Commons, ask for help or offer it, plan events, vote on ideas, and shop member-run stores. Meet Sage, your Commons' AI helper. Tell us what's broken or what you wish it did from "Report a problem or idea" in the app.

(about 255 characters)

### Other Play Console answers I can pre-fill

| Field | Draft answer | Basis |
| --- | --- | --- |
| Category | Social (alternative: Communication) | The app's core is posting and groups. |
| Tags | Community, Groups, Co-ops | Plain words. |
| Contact email | support@cahootz.coop `[VERIFY]` | `apps/mobile/lib/coop-config.ts:72`. The privacy page uses team@cahootzcoops.com. Pick one. |
| Website | https://cahootzcoops.com `[VERIFY]` | Used in this repo's docs and the privacy contact. |
| Privacy policy URL | https://cahootzcommons.com/privacy | `apps/web/app/privacy/page.tsx:18`. Needs the update in "Read this first" item 4. |
| Account deletion URL | None exists yet. `[VERIFY]` | Play requires one if accounts can be created. See item 3. |
| App access for reviewers | Needs a test account. Use the demo login (`DEMO_LOGIN_EMAIL` in `apps/mobile/components/onboarding-flow.tsx`; the code is emailed). `[VERIFY]` a reviewer can get that code. | Reviewers can't read a real inbox. |
| Ads | No ads | No ad SDK in `apps/mobile/package.json`. |
| Content rating | Likely Teen or Everyone 10+ for user-generated content `[VERIFY]` | Members post text, photos, and video. Answer the IARC questionnaire honestly. |
| Financial features declaration | Declare payments for goods and services. Do not declare lending, investing, or crypto trading. `[VERIFY]` with a person who knows the contracts. | The wallet has a coin balance and a key export screen (`app/export-wallet.tsx`). Google's financial-services declaration and crypto rules may apply. Get a human decision. |
| Target audience | 18 and over | Payments and governance. `[VERIFY]` |
| Permissions shown | Camera, microphone, contacts, notifications, biometrics | `apps/mobile/app.json` (`android.permissions`, plus the plugin strings for camera, photos, microphone, contacts). |

---

## 2. Privacy labels: Google Play Data Safety and the App Store privacy label

### What I audited

Everything the Android and iOS builds do with a person's data, from `apps/mobile` and the server code it calls. No location permission exists: `expo-location` isn't a dependency and a search for latitude, longitude and geolocation finds nothing. The profile field `locationSummary` is a sentence the member types (`apps/mobile/app/profile-onboarding.tsx:144`), not a device location.

### Third parties that touch member data

| Who | What they get | Evidence |
| --- | --- | --- |
| **PostHog** (via the `stuff.cahootzcoops.com` proxy) | A user id, email on the person profile only, `coop_id`, event names, screen route patterns, device model and OS, and the request IP | `apps/mobile/lib/analytics.ts:237-250` (identify), `:210` (`disableGeoip`), `apps/mobile/components/analytics-tracker.tsx:34`, `apps/mobile/contexts/auth-context.tsx:299` |
| **Sentry** | Crash and error reports, performance data, IP address, device info, and screen replays for 10% of sessions plus every session with an error | `apps/mobile/app/_layout.tsx:29-43`. No `Sentry.setUser` call exists, so the account isn't attached on purpose. Post-failure reports send counts, types and sizes, never text or files (`apps/mobile/lib/post-media-upload.ts:55-75`). |
| **Expo** (EAS Observe and push relay) | App performance metrics, and the push token plus the message that goes to the device | `apps/mobile/app/_layout.tsx:8,130,196`; `apps/mobile/lib/push-notifications.ts:136-148` |
| **Apple and Google push (APNs, FCM)** | Delivery of those pushes | via Expo |
| **Stripe** | Card number, billing details, and amount, typed into Stripe's own hosted checkout page opened in the browser. The app never receives the card. Store owners complete Stripe's identity checks on Stripe's page. | `apps/mobile/components/commerce-payment-confirmation.native.tsx:34-39`, `apps/mobile/components/stripe/CardInput.tsx` ("Cards are added at checkout"), `apps/mobile/app/(authenticated)/stripe-onboarding.tsx:207`. No native Stripe SDK is installed (`apps/mobile/package.json:56-57` are web-only). |
| **OpenAI** (Sage) | Text of posts, comments, and Sage chats in the Commons, plus short notes Sage keeps about needs a member mentions | `packages/trpc/src/services/sage-grounding.ts`, `sage-steward.ts`, `sage-community-rhythm.ts` and others import `@openai/agents`. Memory rules: `apps/mobile/components/sage-intro.tsx` ("What Sage remembers"). |
| **Vercel Blob** | Photos and videos members upload | `apps/api/src/routes/upload.ts:22`, `apps/mobile/lib/api.ts:1929-2002` |
| **Resend** | The member's email address and the sign-in code email | `packages/trpc/src/lib/email.ts:15`, `:586` |
| **Twilio** | The recipient phone number and a claim link, for a payment someone sends to a non-member | `packages/trpc/src/services/sms.ts:35-78` |
| **Slack** | Feedback text, screenshots, route, platform, and app version go to the team's channel | `packages/trpc/src/routers/feedback.ts:9`, `packages/db/prisma/schema.prisma:2338-2356` |

I treat all of these as **service providers acting for Cahootz**, which is how Google defines "not shared." That holds only if the vendor terms match. `[VERIFY]` with a person who can see the contracts: signed data-processing terms with PostHog, Sentry, Resend, Twilio, and Slack; OpenAI's API data terms (no training on API data, retention window); and Expo's data use for Observe. If any of those isn't a service-provider relationship, flip that row to "shared" on the Play form.

### Google Play Data Safety form

Top-level answers:

| Question | Answer | Why |
| --- | --- | --- |
| Does your app collect or share any of the required user data types? | Yes | See below. |
| Is all user data encrypted in transit? | Yes `[VERIFY]` | The API base is `https://api.cahootz.coop` (`apps/mobile/lib/coop-config.ts:58`) and PostHog uses an `https://` host. The Android E2E build allows plain http only when `ANDROID_E2E=1`, and store builds never set it (PR #220). |
| Do you provide a way for users to request that their data be deleted? | Yes, with a gap. `[VERIFY]` | In-app "Delete Account" plus an email address. See item 3. Answer only after a person decides what deletion does. |
| Does the app follow the Families policy? | No | Not aimed at children. |

Data types. "Shared" = shared with a third party other than a service provider (see above). "Required" = the app doesn't work without it.

| Google category and type | Collected | Shared | Required or optional | Purposes | Linked to the person | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| **Personal info: Email address** | Yes | No | Required | Account management, app functionality, analytics (PostHog person profile only) | Yes | Sign-in `apps/mobile/lib/api.ts:2627`; analytics `apps/mobile/lib/analytics.ts:237-250` |
| **Personal info: Name** (and nickname, handle) | Yes | No | Required for a profile | App functionality, personalization | Yes | `packages/db/prisma/schema.prisma:19-21`; profile screens |
| **Personal info: Phone number** | Yes, optional | No | Optional | App functionality (membership applications, inviting someone, claim texts) | Yes | `apps/mobile/lib/api.ts:163,200`; `schema.prisma:30`; `sms.ts:35-78`. `[VERIFY]` the mobile app still asks for it anywhere on sign-up. |
| **Personal info: User IDs** | Yes | No | Required | App functionality, analytics, account management | Yes | `identify(user.id)` in `analytics-tracker.tsx:34` |
| **Personal info: Other info** (profile answers: goals, skills, interests, what you offer and need, a short business summary, where you are in words) | Yes, optional | No | Optional | App functionality, personalization (Sage suggestions) | Yes | `apps/mobile/lib/api.ts:190-203`; `schema.prisma:35-44` |
| **Financial info: Purchase history** | Yes | No | Required to buy | App functionality, account management | Yes | Orders and receipts: `apps/mobile/app/(authenticated)/orders.tsx`, `history.tsx`, `receipt.tsx` |
| **Financial info: Payment info** | **No** (card typed on Stripe's page; the app only sees the brand and last four) | No | n/a | n/a | n/a | `commerce-payment-confirmation.native.tsx:34-39`, `payment-methods.tsx` (brand, last4, expiry). `[VERIFY]` against Google's wording for hosted checkout. The cautious choice is to declare it "collected, shared with a payment processor." |
| **Financial info: Bank account** | **No** (screen is unreachable) | No | n/a | n/a | n/a | See item 7. Change to Yes, if `bank-accounts.tsx` ships reachable. |
| **Messages: Other in-app messages** (posts, comments, private circle chat, Sage chats) | Yes | No (processed by OpenAI for Sage, see above) | Optional | App functionality, personalization | Yes | `apps/mobile/app/[coopId]/posts.tsx`; `apps/mobile/app/(tabs)/messages.tsx:423`; `packages/trpc/src/services/sage-*.ts` |
| **Photos and videos** | Yes, optional | No | Optional | App functionality | Yes | `apps/mobile/lib/api.ts:1929-2002`; `apps/mobile/app.json` (`expo-image-picker`, `expo-camera` plugin strings) |
| **Audio files** (sound recorded inside a video) | Yes, optional | No | Optional | App functionality | Yes | `apps/mobile/app.json` microphone string: "only when you record a short video." |
| **Contacts** | **No.** Read on the device only when you pick someone to invite; names and numbers are never sent to Cahootz. The texts go from your own number through `expo-sms`. | n/a | n/a | n/a | n/a | `apps/mobile/lib/contact-invite.ts` has no network calls; `components/invite-contacts-card.tsx`; analytics sends counts only (the `contact_invite_*` events in `AnalyticsEvents`, `apps/mobile/lib/analytics.ts:22-77`). `[VERIFY]` Google's wording for "on-device only." |
| **App activity: App interactions** | Yes | No | Required (no opt-out in the app) | Analytics | Yes | `apps/mobile/lib/analytics.ts:22-76` (events and screens). No analytics opt-out exists yet (`docs/mobile-analytics.md`, Decisions). |
| **App activity: Other user-generated content** (feedback, event RSVPs, proposals and votes) | Yes | No | Optional | App functionality | Yes | `apps/mobile/app/(authenticated)/feedback.tsx`; proposal and event screens |
| **App info and performance: Crash logs** | Yes | No | Required | Analytics, app functionality (fixing bugs) | Yes `[VERIFY]` | Sentry, `_layout.tsx:29-43`. Not attached to an account by code, but IP and device data are collected, so treat as linked unless a person confirms otherwise. |
| **App info and performance: Diagnostics** (performance metrics, screen replays) | Yes | No | Required | Analytics, app functionality | Yes `[VERIFY]` | Sentry replay (10% plus every error), Expo Observe (`_layout.tsx:8,130`) |
| **Device or other IDs** (push token, PostHog and Sentry device ids, an anonymous id for signed-out visitors) | Yes | No | Required for push; the rest, required | App functionality (push), analytics | Yes | `push-notifications.ts:136-148` (token to `PushDevice`, `schema.prisma:2411-2429`); `apps/mobile/lib/anonymous-id.ts` |
| **Location** (approximate or precise) | **No** | n/a | n/a | n/a | n/a | No location permission or library in the build. Only the request IP reaches PostHog (with geo lookup off) and Sentry (`sendDefaultPii: true`). `[VERIFY]` whether Google wants IP address declared as approximate location. Many reviewers read it that way. |
| **Calendar, Files and docs, Health and fitness, Web browsing, Audio (music)** | No | n/a | n/a | n/a | n/a | Nothing in `apps/mobile` collects them. |

Security practices boxes:
- Encrypted in transit: yes `[VERIFY]` (see above).
- Delete request: see item 3.
- Independent security review: no `[VERIFY]`.

Additional notes for the "data safety" free text (Play shows this): the app doesn't use advertising IDs, has no ads, and doesn't sell data. `[VERIFY]` with the policy owner that "doesn't sell data" matches the privacy page's CCPA language (`apps/web/app/privacy/page.tsx:50`).

### App Store privacy nutrition label (update for the current iOS build and the Android-era release)

`docs/mobile-analytics.md` says the label needs product analytics tied to a user id and an email address. That's true, and it needs more: Sentry diagnostics and replay, push device tokens, photos and videos, and Sage's use of post text.

**Tracking:** answer **No**. Nothing links member data with third-party data for advertising or shares it with data brokers. PostHog and Sentry are used for the app's own analytics and diagnostics. `[VERIFY]` that PostHog hasn't been connected to any ad platform or data warehouse that joins outside data.

"Linked to you" = linked to the member's identity. "Used to track you" is No for every row.

| Apple data type | Collected | Linked to you | Purposes | Evidence |
| --- | --- | --- | --- | --- |
| **Contact Info: Email address** | Yes | Yes | App Functionality, Analytics (PostHog person profile), Customer Support | `analytics.ts:237-250`; `lib/api.ts:2627` |
| **Contact Info: Name** | Yes | Yes | App Functionality, Product Personalization | `schema.prisma:19-21` |
| **Contact Info: Phone Number** | Yes, optional | Yes | App Functionality | `lib/api.ts:163,200`. `[VERIFY]` see item 2. |
| **Contacts** | No (read on the device only, never sent) | n/a | n/a | `lib/contact-invite.ts` |
| **Identifiers: User ID** | Yes | Yes | App Functionality, Analytics | `analytics-tracker.tsx:34` |
| **Identifiers: Device ID** (push token, PostHog and Sentry device ids) | Yes | Yes | App Functionality, Analytics | `push-notifications.ts:136-148` |
| **Usage Data: Product Interaction** | Yes | Yes | Analytics | `analytics.ts:22-76` |
| **User Content: Photos or Videos** | Yes, optional | Yes | App Functionality | `lib/api.ts:1929-2002` |
| **User Content: Audio Data** (sound inside a video) | Yes, optional | Yes | App Functionality | `app.json` microphone string |
| **User Content: Other User Content** (posts, comments, chat, profile answers, Sage notes) | Yes | Yes | App Functionality, Product Personalization | `sage-intro.tsx`; `sage-*.ts` |
| **User Content: Customer Support** (feedback with screenshots) | Yes, optional | Yes | Customer Support, App Functionality | `feedback.tsx`; `schema.prisma:2338-2356` |
| **Purchases: Purchase History** | Yes | Yes | App Functionality | `orders.tsx`, `history.tsx`, `receipt.tsx` |
| **Financial Info: Payment Info** | No (typed on Stripe's page) | n/a | n/a | `commerce-payment-confirmation.native.tsx` `[VERIFY]` Apple's wording for hosted web checkout |
| **Diagnostics: Crash Data** | Yes | Yes `[VERIFY]` | App Functionality, Analytics | Sentry, `_layout.tsx:29-43` |
| **Diagnostics: Performance Data** | Yes | Yes `[VERIFY]` | App Functionality, Analytics | Sentry, Expo Observe |
| **Diagnostics: Other Diagnostic Data** (screen replays) | Yes | Yes `[VERIFY]` | App Functionality | Sentry replay (10% plus every error) |
| **Location** | No | n/a | n/a | No location library. The IP address reaches PostHog and Sentry. Apple has no IP address row. Teams usually cover it under Diagnostics or Usage Data, so confirm. |
| **Health and Fitness, Sensitive Info, Browsing History, Search History** | No | n/a | n/a | Nothing collects them. |

### What a person must do before either form is submitted

1. Settle items 1-4 and 6-8 in "Read this first" and update the rows they touch.
2. Update `docs/mobile-analytics.md` (Open questions), the privacy page, and the in-app copy so all four say the same thing.
3. Keep the iOS label and the Play form identical in substance. A mismatch is what reviewers and journalists notice.

---

## 3. Screenshot plan

Google Play needs at least 2 phone screenshots. 8 is the cap, and 6 is plenty. Use a phone around 1080 x 1920 or 1080 x 2400 (check Google's current size rules at upload; `[VERIFY]`). Capture them on a seeded demo Commons with made-up names, a fake coin balance, and no real member photos. The app stays in light mode (`apps/mobile/app.json` `userInterfaceStyle: light`), so no dark-mode versions are needed. Don't show an email address, wallet address, or a real person's face. Captions are short and plain, written to sit on the image.

Screens and routes are the ones that exist today.

| # | Screen to capture | Where it lives | Caption | Why this one |
| --- | --- | --- | --- | --- |
| 1 | Your Commons feed with a few real-looking posts, one with a photo | Commons tab, `apps/mobile/app/(tabs)/index.tsx` and `components/circle-view.tsx` | **Your people, in one place.** | The first thing anyone sees and the core of the app. |
| 2 | The Board, open on "Needs & questions" with the "Ask for help" and "Offer something" buttons showing | `apps/mobile/app/(tabs)/board.tsx:80-97` | **Ask for help. Offer a hand.** | The most distinctive part. Not a generic social feed. |
| 3 | A post being written, with a photo attached and an @mention | `apps/mobile/components/mention-composer-input.tsx`, `app/[coopId]/posts.tsx` | **Share what's going on.** | Shows it's easy and shows photos and video. |
| 4 | An event page with the date, place, and RSVP buttons | `apps/mobile/app/[coopId]/events/[eventId].tsx:121` | **Plan something together.** | Shows action beyond chat. |
| 5 | A proposal with a vote in progress | `apps/mobile/app/(authenticated)/proposal-detail.tsx` or `proposals.tsx` | **Decide things as a group.** | Governance is why this isn't just another group chat. Use a small, low-stakes example (a potluck budget, not an investment). |
| 6 | Sage's intro card, or Sage replying to a post | `apps/mobile/components/sage-intro.tsx`; `app/(authenticated)/sage/index.tsx` | **Meet Sage, your Commons' AI helper.** | Sets the right expectation: it's a program, and the card says so. |
| 7 | Join a Commons or invite from contacts | `apps/mobile/app/commons/index.tsx`; `components/invite-contacts-card.tsx` | **Bring your family and friends in.** | Shows how a Commons grows. Use the invite card, not the real contact list. |
| 8 | Alerts and notification settings together (or Alerts alone) | `apps/mobile/app/(tabs)/notifications.tsx`; `app/(authenticated)/notification-settings.tsx` | **You choose what you hear about.** | Backs up the privacy and control story. |

Leave these out of store screenshots:
- The wallet, balance, and "Privacy & Security" (key export) screens. They invite questions about crypto and investment before a person has read what the coin is. Show them in help docs instead.
- The pay-a-store flow. It's fine to describe in text, but a screenshot of money moving is the likeliest thing to draw a policy question. Add it later if Play asks for proof of payments features.
- Anything showing the debug "Update Channels" row.

Also needed (not screenshots): a 512 x 512 icon (the Android adaptive icon in `apps/mobile/assets/images/adaptive-icon.png` is the source) and a 1024 x 500 feature graphic. `[VERIFY]` current Play size rules. I didn't draft a feature graphic. Suggested line for it: **"Ask. Offer. Decide. Together."**

---

## 4. Announcement and social drafts

### Announcement for existing iOS members

Where it goes: an email from Cahootz, or a post from the team in each Commons. Links go to the Play Store or cahootzcoops.com, never an app path. Fill in the Play link once the listing is live. `[VERIFY]` that no email goes out before then.

**Subject:** Cahootz is on Android now

**Preview line:** Got a friend who's been waiting? Send them this.

> Hi {first name},
>
> You've been using Cahootz on your iPhone. Today it's on Android too.
>
> If you've got people in your Commons who've been stuck on the sidelines because they don't have an iPhone, now they can join in. They can post, ask for help, plan events, and vote, just like you.
>
> Same app, same Commons. Nothing changes for you.
>
> Want to invite someone? Open Cahootz, tap "Invite from your contacts," and pick who you want to ask. Or send them this link: {Play Store link}. `[VERIFY]` an invite link that lands on the right store for each phone (cahootzcoops.com can sort that out).
>
> A few things we're glad to be honest about:
> - Android is brand new. If something looks off, tell us. In the app, tap "Report a problem or idea." We read every one.
> - Android and iPhone members see the same Commons, so no one gets left out of a conversation.
>
> Thanks for being here early.
>
> {Name}, Cahootz
> support@cahootz.coop `[VERIFY]`

Notes:
- The email says nothing about the coin, money, or Sage. It doesn't need to, and there's less to get wrong. A paragraph about money would need review by whoever owns coin policy.
- "Same Commons, nothing changes for you" is true only if the feature set matches on both platforms. PR #220 adds an iOS and Android parity rule to `AGENTS.md`, but I haven't checked every `Platform.OS` branch in the app (28 files use one). `[VERIFY]` with a first Android test build before sending.
- Don't send this before the Play listing is public.

### Three social posts (draft, post nothing)

Keep the voice warm and plain. No exclamation-point stacks, no promises about money.

**Post 1: the announcement**

> Cahootz is on Android now. 🎉
>
> If your people have been waiting, they can join your Commons today: post, ask for help, plan events, and vote on ideas together.
>
> {Play Store link}

**Post 2: what a Commons actually is**

> A Commons isn't another feed to scroll.
>
> It's a place for people who already know each other to ask for a ride, offer a skill, plan a meal, and decide things together.
>
> Now on iPhone and Android. {cahootzcoops.com}

**Post 3: the honest one about Sage**

> Meet Sage. It's the AI helper in every Commons, and it's a program, not a person.
>
> It notices what people need, connects folks who can help each other, and nudges plans along. Anything about money or who's a member waits for a person.
>
> You can ask it what it remembers about you, and tell it to forget. {cahootzcoops.com}

Notes on the posts:
- Post 3's last claim: `[VERIFY]` that "waits for a person" matches the product. Item 5 in "Read this first" shows Sage can put a proposal up for a vote on its own in some Commons, so the post limits itself to money and membership, which `components/sage-intro.tsx` and `docs/sage-roadmap.md` both support. A person should still confirm it's accurate for every Commons.
- The emoji in Post 1 is optional. The voice guide says "no fake excitement," so cut it if it feels forced.
- No post names a coin, a price, or a return. None should.
- Add each platform's character limit and image before scheduling. I didn't draft images.

---

## Open items for a person (short list)

1. Decide what "Delete Account" should do and publish a deletion URL (item 3).
2. Update the privacy policy page (item 4).
3. Confirm Sentry replay masking, the production PostHog key, and vendor data terms (items 1, 8, and the third-party table).
4. Fix or remove the Sage intro line about proposals (item 5).
5. Check the merged Android manifest for contacts write access (item 6).
6. Check whether bank-account and withdraw screens ship reachable (item 7).
7. Confirm whether phone sign-in is real (item 2).
8. Give the pack a copy edit against the live iOS listing text, which isn't in the repo.
