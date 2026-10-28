export const HOMEPAGE_EXPERIMENT_FLAG_KEY = "group-buy-positioning-v1";
export const HOMEPAGE_EXPERIMENT_PREVIEW_COOKIE =
  "cahootz_homepage_experiment_preview";
export const HOMEPAGE_POSTHOG_DISTINCT_ID_COOKIE =
  "cahootz_posthog_distinct_id";

export type HomepageVariant = "community" | "group-buy";

export function normalizeHomepageVariant(
  value: boolean | string | null | undefined,
): HomepageVariant | null {
  if (value === true || value === "group-buy") return "group-buy";
  if (value === false || value === "community") return "community";
  return null;
}
