-- Weekly outreach is a reviewed, consent-aware, low-risk Sage workflow.
-- Make it operational by default while preserving the feature flag as an
-- emergency/operator pause that the hourly watchdog will loudly report.
INSERT INTO "public"."FeatureFlag" (
  "id", "key", "enabled", "description", "metadata", "createdAt", "updatedAt"
)
VALUES (
  gen_random_uuid()::text,
  'sage_weekly_outreach',
  true,
  'Send one private weekly Sage check-in on each member''s stable weekday',
  jsonb_build_object('scheduleVersion', 'v1', 'enabledAt', NOW()::text),
  NOW(),
  NOW()
)
ON CONFLICT ("key") DO UPDATE SET
  "enabled" = true,
  "metadata" = COALESCE("FeatureFlag"."metadata", '{}'::jsonb)
    || jsonb_build_object(
      'scheduleVersion', COALESCE("FeatureFlag"."metadata"->>'scheduleVersion', 'v1'),
      'enabledAt', NOW()::text
    ),
  "updatedAt" = NOW();
