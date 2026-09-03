ALTER TABLE "public"."User"
  ADD COLUMN "skills" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "interests" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "resourcesOffered" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "resourcesNeeded" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "businessSummary" TEXT,
  ADD COLUMN "locationSummary" TEXT,
  ADD COLUMN "profileSignals" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "public"."CommonsPost"
  ADD COLUMN "classification" TEXT NOT NULL DEFAULT 'social',
  ADD COLUMN "classificationConfidence" DOUBLE PRECISION,
  ADD COLUMN "classificationSignals" JSONB NOT NULL DEFAULT '{}';

CREATE INDEX "CommonsPost_coopId_classification_createdAt_idx"
  ON "public"."CommonsPost"("coopId", "classification", "createdAt");

CREATE TABLE "public"."PushDevice" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "coopId" TEXT NOT NULL DEFAULT 'cahootz',
  "expoPushToken" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "deviceName" TEXT,
  "appVersion" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "lastRegisteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PushDevice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PushDevice_expoPushToken_key"
  ON "public"."PushDevice"("expoPushToken");

CREATE INDEX "PushDevice_userId_enabled_idx"
  ON "public"."PushDevice"("userId", "enabled");

CREATE INDEX "PushDevice_coopId_enabled_idx"
  ON "public"."PushDevice"("coopId", "enabled");

ALTER TABLE "public"."PushDevice"
  ADD CONSTRAINT "PushDevice_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "public"."User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
