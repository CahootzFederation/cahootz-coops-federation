ALTER TYPE "public"."AIObservationVisibility" ADD VALUE IF NOT EXISTS 'SAGE_INTERNAL' BEFORE 'PRIVATE_TO_AUTHOR_SCOPE';
ALTER TYPE "public"."AIObservationStatus" ADD VALUE IF NOT EXISTS 'CANDIDATE' BEFORE 'ACTIVE';
ALTER TYPE "public"."AIObservationStatus" ADD VALUE IF NOT EXISTS 'UNSUPPORTED' AFTER 'ACTIVE';

ALTER TABLE "public"."AIObservation" ADD COLUMN "systemKey" TEXT;
ALTER TABLE "public"."CommonsAction" ADD COLUMN "originObservationId" TEXT;
ALTER TABLE "public"."GroupComment" ADD COLUMN "systemKey" TEXT;

CREATE UNIQUE INDEX "AIObservation_systemKey_key" ON "public"."AIObservation"("systemKey");
CREATE INDEX "AIObservation_scopeType_scopeId_generatedByAgentKey_createdAt_idx"
  ON "public"."AIObservation"("scopeType", "scopeId", "generatedByAgentKey", "createdAt");
CREATE INDEX "CommonsAction_originObservationId_status_idx"
  ON "public"."CommonsAction"("originObservationId", "status");
ALTER TABLE "public"."CommonsAction"
  ADD CONSTRAINT "CommonsAction_originObservationId_fkey"
  FOREIGN KEY ("originObservationId") REFERENCES "public"."AIObservation"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "GroupComment_systemKey_key" ON "public"."GroupComment"("systemKey");
