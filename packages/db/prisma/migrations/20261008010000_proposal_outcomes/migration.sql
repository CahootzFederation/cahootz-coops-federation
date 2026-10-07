-- Proposal outcome loop: keep the engine's KPIs, when to measure them, and what happened.
ALTER TABLE "public"."ProposalKPI" ADD COLUMN "higherIsBetter" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "measureAfterDays" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN "measureBy" TIMESTAMP(3),
ADD COLUMN "outcome" TEXT,
ADD COLUMN "actualValue" DOUBLE PRECISION,
ADD COLUMN "outcomeNote" TEXT,
ADD COLUMN "verification" TEXT,
ADD COLUMN "outcomeSources" JSONB,
ADD COLUMN "outcomeRecordedAt" TIMESTAMP(3),
ADD COLUMN "reportedById" TEXT,
ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "public"."Proposal" ADD COLUMN "priorOutcomes" JSONB;

CREATE INDEX "ProposalKPI_proposalId_idx" ON "public"."ProposalKPI"("proposalId");
CREATE INDEX "ProposalKPI_measureBy_outcome_idx" ON "public"."ProposalKPI"("measureBy", "outcome");
