-- CreateTable
CREATE TABLE "public"."SageDevIssueDraft" (
    "id" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "cadence" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "privacyFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "githubIssueNumber" INTEGER,
    "githubIssueUrl" TEXT,
    "postedAt" TIMESTAMP(3),
    "postedBy" TEXT,
    "dismissedAt" TIMESTAMP(3),
    "dismissedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SageDevIssueDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SageDevIssueDraft_periodKey_key" ON "public"."SageDevIssueDraft"("periodKey");

-- CreateIndex
CREATE INDEX "SageDevIssueDraft_status_createdAt_idx" ON "public"."SageDevIssueDraft"("status", "createdAt");
