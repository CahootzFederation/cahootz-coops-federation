-- Link a Sage alert to the internal community hypothesis it came from, so the
-- 30- and 90-day impact reviews can see what Sage did about the hypothesis.
ALTER TABLE "public"."SageAlert" ADD COLUMN "originObservationId" TEXT;

CREATE INDEX "SageAlert_originObservationId_status_idx"
  ON "public"."SageAlert"("originObservationId", "status");
ALTER TABLE "public"."SageAlert"
  ADD CONSTRAINT "SageAlert_originObservationId_fkey"
  FOREIGN KEY ("originObservationId") REFERENCES "public"."AIObservation"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
