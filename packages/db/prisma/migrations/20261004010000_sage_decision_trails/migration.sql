-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "showSageDecisionTrails" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "public"."SageDecisionTrail" (
    "id" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "coopId" TEXT NOT NULL,
    "circleId" TEXT,
    "proposalId" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "observed" JSONB NOT NULL,
    "steps" JSONB NOT NULL,
    "relatedPostIds" TEXT[],
    "actionIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SageDecisionTrail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SageDecisionTrail_coopId_createdAt_idx" ON "public"."SageDecisionTrail"("coopId", "createdAt");

-- CreateIndex
CREATE INDEX "SageDecisionTrail_circleId_createdAt_idx" ON "public"."SageDecisionTrail"("circleId", "createdAt");

-- CreateIndex
CREATE INDEX "SageDecisionTrail_sourceType_sourceId_idx" ON "public"."SageDecisionTrail"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "SageDecisionTrail_coopId_agent_createdAt_idx" ON "public"."SageDecisionTrail"("coopId", "agent", "createdAt");

-- CreateIndex
CREATE INDEX "SageDecisionTrail_proposalId_createdAt_idx" ON "public"."SageDecisionTrail"("proposalId", "createdAt");
