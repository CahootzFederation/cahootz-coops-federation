-- CreateEnum
CREATE TYPE "CommonsActionType" AS ENUM ('MAKE_PROPOSAL', 'RESPOND_CHARTER_CORRECTION', 'RESPOND_MISSION_ALIGNMENT', 'RESPOND_RESOURCE_FOLLOWUP', 'VERIFY_RESOURCE', 'LOG_RESOURCE', 'ANSWER_QUESTION', 'CLARIFY_NEED', 'CONNECT_MEMBERS', 'ESCALATE_TO_ADMIN', 'NO_ACTION');

-- CreateEnum
CREATE TYPE "CommonsActionStatus" AS ENUM ('PENDING', 'PUBLISHED', 'APPROVED', 'DISMISSED', 'FAILED');

-- CreateTable
CREATE TABLE "CommonsAgentSetting" (
    "coopId" TEXT NOT NULL,
    "autoReply" BOOLEAN NOT NULL DEFAULT true,
    "lastScanAt" TIMESTAMP(3),
    "newPostOffset" INTEGER NOT NULL DEFAULT 0,
    "newCommentOffset" INTEGER NOT NULL DEFAULT 0,
    "backfillPostCursor" TEXT,
    "backfillCommentCursor" TEXT,
    "backfillPostsDone" BOOLEAN NOT NULL DEFAULT false,
    "backfillCommentsDone" BOOLEAN NOT NULL DEFAULT false,
    "lastCharterKey" TEXT,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommonsAgentSetting_pkey" PRIMARY KEY ("coopId")
);

-- CreateTable
CREATE TABLE "CommonsContentScan" (
    "id" TEXT NOT NULL,
    "coopId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "charterConfigId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "error" TEXT,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommonsContentScan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommonsAction" (
    "id" TEXT NOT NULL,
    "coopId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourcePostId" TEXT NOT NULL,
    "sourceAuthorId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "type" "CommonsActionType" NOT NULL,
    "status" "CommonsActionStatus" NOT NULL DEFAULT 'PENDING',
    "summary" TEXT NOT NULL,
    "evidence" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "draftText" TEXT,
    "charterConfigId" TEXT NOT NULL,
    "publishedCommentId" TEXT,
    "replySourceKey" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommonsAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommonsResource" (
    "id" TEXT NOT NULL,
    "coopId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "candidateUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CANDIDATE',
    "invitedAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "knowledgeDocId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommonsResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommonsProposalDraft" (
    "id" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "coopId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "submittedProposalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommonsProposalDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AICostEvent" (
    "id" TEXT NOT NULL,
    "coopId" TEXT,
    "feature" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "requestId" TEXT,
    "inputTokens" INTEGER,
    "cachedInputTokens" INTEGER,
    "outputTokens" INTEGER,
    "costUsd" DECIMAL(18,9),
    "pricingVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AICostEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommonsContentScan_coopId_scannedAt_idx" ON "CommonsContentScan"("coopId", "scannedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommonsContentScan_sourceType_sourceId_contentHash_charterC_key" ON "CommonsContentScan"("sourceType", "sourceId", "contentHash", "charterConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "CommonsAction_replySourceKey_key" ON "CommonsAction"("replySourceKey");

-- CreateIndex
CREATE INDEX "CommonsAction_coopId_status_createdAt_idx" ON "CommonsAction"("coopId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "CommonsAction_sourceType_sourceId_idx" ON "CommonsAction"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "CommonsAction_sourceType_sourceId_contentHash_charterConfig_key" ON "CommonsAction"("sourceType", "sourceId", "contentHash", "charterConfigId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "CommonsResource_actionId_key" ON "CommonsResource"("actionId");

-- CreateIndex
CREATE INDEX "CommonsResource_coopId_status_idx" ON "CommonsResource"("coopId", "status");

-- CreateIndex
CREATE INDEX "CommonsResource_candidateUserId_status_idx" ON "CommonsResource"("candidateUserId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CommonsProposalDraft_actionId_key" ON "CommonsProposalDraft"("actionId");

-- CreateIndex
CREATE INDEX "CommonsProposalDraft_authorId_coopId_idx" ON "CommonsProposalDraft"("authorId", "coopId");

-- CreateIndex
CREATE UNIQUE INDEX "AICostEvent_requestId_key" ON "AICostEvent"("requestId");

-- CreateIndex
CREATE INDEX "AICostEvent_coopId_createdAt_idx" ON "AICostEvent"("coopId", "createdAt");

-- CreateIndex
CREATE INDEX "AICostEvent_feature_createdAt_idx" ON "AICostEvent"("feature", "createdAt");
