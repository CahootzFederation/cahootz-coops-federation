# Public homepage

There is one public homepage, `apps/web/app/page.tsx`, served at `/`.

From October to November 2026 the homepage was an A/B test between a community
page and a group-buy page, chosen by the PostHog flag `group-buy-positioning-v1`.
On 2026-11-06 the two were merged into one page and the test was removed:

- The middleware no longer asks PostHog which page to show or sets the
  `cahootz_homepage_experiment_preview` / `cahootz_posthog_distinct_id` cookies.
- The `?homepage=` preview override does nothing now.
- `/landing` (the old group-buy page) permanently redirects to `/`.
- The `group-buy-positioning-v1` flag can be archived in PostHog.

## What the page does

Its one job: show what being in a commons is like, then get the visitor into the
app (if they have an invite) or onto the waitlist (if they don't). In order:

1. **Hero:** the street screen in a large phone, with **Join the waitlist** and
   **Have an invite? Get the iPhone app** (App Store).
2. **What you can do:** one screen and one claim per row (group deals, Sage),
   three short extras (street, families, Community Board), and a folded
   **See the savings math on real products** panel with the product calculator.
3. **How to get in:** three steps and the list of commons to join.
4. **Questions.**
5. **Join:** the waitlist form and the folded business form.

The phone screenshots live in `apps/web/public/app-screens/`. They show a staged
sample commons with made-up neighbors, so re-capture them when the app's look
changes.

## Prices in the savings calculator

The calculator uses the same price rule as real offers (`suggestItemOfferPrice` in `packages/validators/src/marketplace-offers.ts`): the seller gets the bulk price, Stripe's fee comes out next, and what's left is split between the Commons and Cahootz. Members keep about 80% of the savings by default, and small items come in packs so the card fee doesn't eat the savings. The margin and other rules come from the platform admin's **Group Buy pricing** settings through `productDiscovery.homepagePricing`, falling back to the defaults. The funding estimate's planning rate is the average Commons share on the deals shown, not a fixed 5%.
