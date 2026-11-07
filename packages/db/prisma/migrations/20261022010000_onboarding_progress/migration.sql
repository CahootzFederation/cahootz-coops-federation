ALTER TABLE "public"."User"
ADD COLUMN "onboardingStep" TEXT NOT NULL DEFAULT 'profile',
ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3),
ADD COLUMN "onboardingDraft" JSONB NOT NULL DEFAULT '{}';
-- Profile completion is evidence of reaching invitations, not finishing onboarding.
UPDATE "public"."User" SET "onboardingStep" = 'invite'
WHERE "profileOnboardingCompletedAt" IS NOT NULL;
