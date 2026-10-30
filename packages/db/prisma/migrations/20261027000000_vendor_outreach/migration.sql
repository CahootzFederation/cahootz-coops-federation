-- CreateEnum
CREATE TYPE "VendorCampaignStatus" AS ENUM ('PROPOSED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'EXPIRED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ProspectSourceStatus" AS ENUM ('SUGGESTED', 'ENABLED', 'DISABLED');

-- CreateEnum
CREATE TYPE "CampaignProspectStatus" AS ENUM ('QUEUED', 'SENT', 'FOLLOWED_UP', 'RESPONDED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "OutreachStep" AS ENUM ('FIRST', 'FOLLOW_UP');

-- CreateEnum
CREATE TYPE "OutreachMessageStatus" AS ENUM ('SENT', 'DRY_RUN', 'FAILED');

-- CreateEnum
CREATE TYPE "VendorInterest" AS ENUM ('YES', 'NOT_NOW', 'UNSUBSCRIBE');

-- AlterTable
ALTER TABLE "VendorProspect" ADD COLUMN     "convertedOfferId" TEXT,
ADD COLUMN     "declinedUntil" TIMESTAMP(3),
ADD COLUMN     "lastContactedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "VendorCampaign" (
    "id" TEXT NOT NULL,
    "coopId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "offerType" "OfferType" NOT NULL DEFAULT 'GROUP_BUY',
    "searchTerms" TEXT[],
    "area" TEXT,
    "demandActionId" TEXT,
    "demandEvidence" JSONB NOT NULL,
    "pitchPoints" TEXT,
    "maxEmails" INTEGER NOT NULL DEFAULT 10,
    "maxSearches" INTEGER NOT NULL DEFAULT 5,
    "searchesUsed" INTEGER NOT NULL DEFAULT 0,
    "status" "VendorCampaignStatus" NOT NULL DEFAULT 'PROPOSED',
    "rejectReason" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "discoveredAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProspectSource" (
    "id" TEXT NOT NULL,
    "type" "ProspectSourceType" NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "suggestedBy" TEXT NOT NULL,
    "reason" TEXT,
    "status" "ProspectSourceStatus" NOT NULL DEFAULT 'SUGGESTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProspectSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignProspect" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "status" "CampaignProspectStatus" NOT NULL DEFAULT 'QUEUED',
    "skipReason" TEXT,
    "replyTokenHash" TEXT,
    "personalLine" TEXT,
    "firstSentAt" TIMESTAMP(3),
    "followUpSentAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignProspect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachMessage" (
    "id" TEXT NOT NULL,
    "campaignProspectId" TEXT NOT NULL,
    "step" "OutreachStep" NOT NULL,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "OutreachMessageStatus" NOT NULL,
    "resendId" TEXT,
    "error" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutreachMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachSuppression" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "domain" TEXT,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutreachSuppression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorResponse" (
    "id" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "campaignProspectId" TEXT,
    "interest" "VendorInterest" NOT NULL,
    "contactName" TEXT,
    "bestContact" TEXT,
    "offerIdea" TEXT,
    "respondedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VendorCampaign_demandActionId_key" ON "VendorCampaign"("demandActionId");

-- CreateIndex
CREATE INDEX "VendorCampaign_status_idx" ON "VendorCampaign"("status");

-- CreateIndex
CREATE INDEX "VendorCampaign_coopId_createdAt_idx" ON "VendorCampaign"("coopId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProspectSource_name_key" ON "ProspectSource"("name");

-- CreateIndex
CREATE INDEX "ProspectSource_status_idx" ON "ProspectSource"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignProspect_replyTokenHash_key" ON "CampaignProspect"("replyTokenHash");

-- CreateIndex
CREATE INDEX "CampaignProspect_status_idx" ON "CampaignProspect"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignProspect_campaignId_prospectId_key" ON "CampaignProspect"("campaignId", "prospectId");

-- CreateIndex
CREATE INDEX "OutreachMessage_status_sentAt_idx" ON "OutreachMessage"("status", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutreachMessage_campaignProspectId_step_key" ON "OutreachMessage"("campaignProspectId", "step");

-- CreateIndex
CREATE UNIQUE INDEX "OutreachSuppression_email_key" ON "OutreachSuppression"("email");

-- CreateIndex
CREATE UNIQUE INDEX "OutreachSuppression_domain_key" ON "OutreachSuppression"("domain");

-- CreateIndex
CREATE INDEX "VendorResponse_prospectId_idx" ON "VendorResponse"("prospectId");

-- AddForeignKey
ALTER TABLE "CampaignProspect" ADD CONSTRAINT "CampaignProspect_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "VendorCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignProspect" ADD CONSTRAINT "CampaignProspect_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "VendorProspect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachMessage" ADD CONSTRAINT "OutreachMessage_campaignProspectId_fkey" FOREIGN KEY ("campaignProspectId") REFERENCES "CampaignProspect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorResponse" ADD CONSTRAINT "VendorResponse_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "VendorProspect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorResponse" ADD CONSTRAINT "VendorResponse_campaignProspectId_fkey" FOREIGN KEY ("campaignProspectId") REFERENCES "CampaignProspect"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Built-in places Sage may look for businesses. Sage's own suggestions start as
-- SUGGESTED until a platform admin turns them on.
INSERT INTO "ProspectSource" ("id", "type", "name", "config", "suggestedBy", "status", "updatedAt") VALUES
  ('src_cahootz_shops', 'CAHOOTZ_SHOP', 'Shops already on Cahootz', '{}', 'system', 'ENABLED', CURRENT_TIMESTAMP),
  ('src_member_referrals', 'MEMBER_REFERRAL', 'Member recommendations', '{}', 'system', 'ENABLED', CURRENT_TIMESTAMP),
  ('src_web_search', 'WEB_SEARCH', 'Web search', '{}', 'system', 'ENABLED', CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;
