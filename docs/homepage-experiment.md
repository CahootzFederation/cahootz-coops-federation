# Homepage positioning experiment

The public homepage is controlled by the PostHog feature flag
`group-buy-positioning-v1`.

Configure it in PostHog as a multivariate flag with these exact variants:

- `community`: 50% (control and safe fallback)
- `group-buy`: 50% (shared-purchase positioning)

The application defaults to `community` when PostHog is unavailable, the flag
is disabled, or PostHog returns an unknown value. A boolean flag is also
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
