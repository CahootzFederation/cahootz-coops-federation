-- Sage proposal ideas from charter goals: structured drafts that start with no author until a member
-- takes one on, and a new action type for the idea post.
ALTER TYPE "public"."CommonsActionType" ADD VALUE IF NOT EXISTS 'PROPOSE_IDEA';

ALTER TABLE "public"."CommonsProposalDraft"
  ALTER COLUMN "authorId" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN IF NOT EXISTS "goalKey" TEXT,
  ADD COLUMN IF NOT EXISTS "budgetAmount" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "proposedChanges" JSONB,
  ADD COLUMN IF NOT EXISTS "originObservationId" TEXT,
  ADD COLUMN IF NOT EXISTS "ideaPostId" TEXT,
  ADD COLUMN IF NOT EXISTS "claimedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "CommonsProposalDraft_ideaPostId_key" ON "public"."CommonsProposalDraft"("ideaPostId");
CREATE UNIQUE INDEX IF NOT EXISTS "CommonsProposalDraft_submittedProposalId_key" ON "public"."CommonsProposalDraft"("submittedProposalId");
CREATE INDEX IF NOT EXISTS "CommonsProposalDraft_coopId_kind_createdAt_idx" ON "public"."CommonsProposalDraft"("coopId", "kind", "createdAt");
