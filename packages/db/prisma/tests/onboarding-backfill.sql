\set ON_ERROR_STOP on
BEGIN;
-- All test data and the backfill itself are rolled back at the end.
INSERT INTO public."User" (id, email, "updatedAt", "firstLoginAt", "onboardingStep", "onboardingDraft")
SELECT 'e2e-backfill-' || kind, 'e2e-backfill-' || kind || '@test.cahootz.local', now(),
  CASE kind WHEN 'established' THEN m.started_at - interval '1 day'
            WHEN 'unfinished' THEN m.started_at + interval '1 day' ELSE NULL END,
  CASE kind WHEN 'invited' THEN 'welcome' ELSE 'profile' END,
  '{"selfDescription":"E2E preserved draft"}'::jsonb
FROM public."_prisma_migrations" m
CROSS JOIN (VALUES ('established'), ('unfinished'), ('invited')) cases(kind)
WHERE m.migration_name = '20261022010000_onboarding_progress' AND m.finished_at IS NOT NULL;
\ir ../migrations/20261022030000_preserve_existing_member_onboarding/migration.sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public."User" WHERE id = 'e2e-backfill-established' AND "onboardingStep" = 'complete' AND "onboardingCompletedAt" IS NOT NULL) THEN
    RAISE EXCEPTION 'Established account was not grandfathered';
  END IF;
  IF (SELECT count(*) FROM public."User" WHERE id IN ('e2e-backfill-unfinished', 'e2e-backfill-invited') AND "onboardingCompletedAt" IS NULL) <> 2 THEN
    RAISE EXCEPTION 'New or invited accounts were incorrectly completed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public."User" WHERE id = 'e2e-backfill-unfinished' AND "onboardingStep" = 'profile' AND "onboardingDraft"->>'selfDescription' = 'E2E preserved draft') THEN
    RAISE EXCEPTION 'Unfinished progress was changed';
  END IF;
END $$;
ROLLBACK;
