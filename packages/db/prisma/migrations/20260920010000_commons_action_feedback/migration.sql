CREATE TYPE "CommonsActionFeedbackRating" AS ENUM ('GOOD', 'NEEDS_WORK');
CREATE TYPE "CommonsActionFeedbackReason" AS ENUM ('WRONG_ACTION', 'INCORRECT_CHARTER_USE', 'INACCURATE', 'MISSED_CONTEXT', 'TONE', 'UNCLEAR', 'OTHER');

ALTER TABLE "CommonsAction"
  ADD COLUMN "generatedDraftText" TEXT,
  ADD COLUMN "sourceTextSnapshot" TEXT,
  ADD COLUMN "contextSnapshot" TEXT,
  ADD COLUMN "charterSnapshot" TEXT,
  ADD COLUMN "goalsSnapshot" JSONB;

CREATE TABLE "CommonsActionFeedback" (
  "id" TEXT NOT NULL,
  "actionId" TEXT NOT NULL,
  "coopId" TEXT NOT NULL,
  "rating" "CommonsActionFeedbackRating" NOT NULL,
  "reasons" "CommonsActionFeedbackReason"[] NOT NULL,
  "notes" TEXT,
  "correctedText" TEXT,
  "reviewedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommonsActionFeedback_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommonsActionFeedback_actionId_key" ON "CommonsActionFeedback"("actionId");
CREATE INDEX "CommonsActionFeedback_coopId_rating_createdAt_idx" ON "CommonsActionFeedback"("coopId", "rating", "createdAt");
ALTER TABLE "CommonsActionFeedback" ADD CONSTRAINT "CommonsActionFeedback_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "CommonsAction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
