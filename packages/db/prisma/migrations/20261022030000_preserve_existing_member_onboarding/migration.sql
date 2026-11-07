-- Grandfather people who had signed in before durable onboarding was introduced.
-- Membership alone is not evidence of a login: invited newcomers still onboard.
-- The original rollout time, rather than this correction's time, preserves resumes
-- for people who started the new onboarding and have not finished it.
UPDATE "public"."User" AS u
SET "onboardingStep" = 'complete',
    "onboardingCompletedAt" = rollout."started_at"
FROM "public"."_prisma_migrations" AS rollout
WHERE rollout."migration_name" = '20261022010000_onboarding_progress'
  AND rollout."finished_at" IS NOT NULL
  AND rollout."rolled_back_at" IS NULL
  AND u."firstLoginAt" < rollout."started_at"
  AND u."onboardingCompletedAt" IS NULL;
