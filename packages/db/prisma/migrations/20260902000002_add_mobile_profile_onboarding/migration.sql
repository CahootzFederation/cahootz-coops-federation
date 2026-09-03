ALTER TABLE "public"."User"
  ADD COLUMN "selfDescription" TEXT,
  ADD COLUMN "shortTermGoals" TEXT,
  ADD COLUMN "longTermGoals" TEXT,
  ADD COLUMN "profileOnboardingCompletedAt" TIMESTAMP(3);
