-- New-member re-engagement drip.

-- Member activity: written (throttled) by accountAuthenticatedProcedure.
ALTER TABLE "public"."User" ADD COLUMN "lastActiveAt" TIMESTAMP(3);

-- Seed it from existing sessions so members who are already active aren't
-- treated as "never came back" by the drip the first time it runs.
UPDATE "public"."User" AS u
SET "lastActiveAt" = s."lastActiveAt"
FROM (
    SELECT "userId", MAX("lastActiveAt") AS "lastActiveAt"
    FROM "auth"."Session"
    GROUP BY "userId"
) AS s
WHERE s."userId" = u."id";

-- Opt-out category for the drip ("Getting started tips").
ALTER TABLE "public"."NotificationPreference" ADD COLUMN "onboarding" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "public"."OnboardingDripSend" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "coopId" TEXT NOT NULL,
    "step" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENDING',
    "channel" TEXT,
    "targetType" TEXT,
    "targetId" TEXT,
    "notificationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "OnboardingDripSend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingDripSend_userId_coopId_step_key" ON "public"."OnboardingDripSend"("userId", "coopId", "step");

-- CreateIndex
CREATE INDEX "OnboardingDripSend_coopId_createdAt_idx" ON "public"."OnboardingDripSend"("coopId", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."OnboardingDripSend" ADD CONSTRAINT "OnboardingDripSend_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
