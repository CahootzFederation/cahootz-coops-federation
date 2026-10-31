# Homepage positioning experiment

The public homepage is controlled by the PostHog feature flag
`group-buy-positioning-v1`.

Configure it in PostHog as a multivariate flag with these exact variants:

- `community`: 0% (community option)
- `group-buy`: 100% (current default positioning)

The application defaults to `group-buy` when PostHog is unavailable, no project
key is configured, or PostHog returns an unknown or missing value. An explicit
`community` result still selects the community page. A disabled boolean flag
returns `false` and therefore selects community. Set the active multivariate
flag to 100% `group-buy` to show it to everyone without a preview override. A boolean flag is also
supported: `false` maps to `community` and `true` maps to `group-buy`.

## Local and review overrides

- `/?homepage=community` previews the control and saves the preview for 30 days.
- `/?homepage=group-buy` previews the shared-purchase variant and saves the
  preview for 30 days.
- `/?homepage=auto` clears the preview and returns the browser to PostHog
  assignment.

The preview cookie is separate from the anonymous PostHog distinct ID, so a
preview never replaces the stable identity PostHog uses for its deterministic
rollout.

## Prices on the group-buy variant

The calculator uses the same price rule as real offers (`suggestItemOfferPrice` in `packages/validators/src/marketplace-offers.ts`): the seller gets the bulk price, Stripe's fee comes out next, and what's left is split between the Commons and Cahootz. Members keep about 80% of the savings by default, and small items come in packs so the card fee doesn't eat the savings. The margin and other rules come from the platform admin's **Group Buy pricing** settings through `productDiscovery.homepagePricing`, falling back to the defaults. The funding estimate's planning rate is the average Commons share on the deals shown, not a fixed 5%.

The `group-buy-positioning-v1` PostHog flag is an approved exception to the no-feature-flags rule (decided 2026-10-28): it's a temporary A/B test of marketing pages.
