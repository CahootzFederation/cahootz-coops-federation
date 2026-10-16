-- These Sage workflows are always on and no longer read FeatureFlag.
-- Keep the shared FeatureFlag table for unrelated legacy capabilities.
DELETE FROM "public"."FeatureFlag"
WHERE "key" IN (
  'sage_weekly_outreach',
  'sage_community_memory',
  'sage_private_safety_response'
);
