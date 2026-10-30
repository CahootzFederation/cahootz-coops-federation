-- CreateEnum
CREATE TYPE "ProspectSourceType" AS ENUM ('MEMBER_REFERRAL', 'CAHOOTZ_SHOP', 'WEB_SEARCH', 'DIRECTORY_SITE', 'ADMIN');

-- CreateEnum
CREATE TYPE "ProspectStatus" AS ENUM ('FOUND', 'VERIFIED', 'QUEUED', 'CONTACTED', 'FOLLOWED_UP', 'INTERESTED', 'IN_TALKS', 'CONVERTED', 'DECLINED', 'UNSUBSCRIBED', 'BOUNCED', 'SKIPPED');

-- CreateTable
CREATE TABLE "VendorProspect" (
    "id" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "category" TEXT,
    "description" TEXT,
    "website" TEXT,
    "domain" TEXT,
    "email" TEXT,
    "emailNormalized" TEXT,
    "phone" TEXT,
    "city" TEXT,
    "state" TEXT,
    "sourceType" "ProspectSourceType" NOT NULL,
    "sourceUrl" TEXT,
    "storeId" TEXT,
    "status" "ProspectStatus" NOT NULL DEFAULT 'FOUND',
    "statusNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorProspect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorReferral" (
    "id" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "referredByUserId" TEXT NOT NULL,
    "coopId" TEXT NOT NULL,
    "howKnown" TEXT,
    "mayNameReferrer" BOOLEAN NOT NULL DEFAULT false,
    "confirmedPublicContact" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorReferral_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VendorProspect_emailNormalized_key" ON "VendorProspect"("emailNormalized");

-- CreateIndex
CREATE INDEX "VendorProspect_status_idx" ON "VendorProspect"("status");

-- CreateIndex
CREATE INDEX "VendorProspect_category_idx" ON "VendorProspect"("category");

-- CreateIndex
CREATE INDEX "VendorProspect_domain_idx" ON "VendorProspect"("domain");

-- CreateIndex
CREATE INDEX "VendorReferral_referredByUserId_createdAt_idx" ON "VendorReferral"("referredByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "VendorReferral_coopId_createdAt_idx" ON "VendorReferral"("coopId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VendorReferral_prospectId_referredByUserId_key" ON "VendorReferral"("prospectId", "referredByUserId");

-- AddForeignKey
ALTER TABLE "VendorReferral" ADD CONSTRAINT "VendorReferral_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "VendorProspect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorReferral" ADD CONSTRAINT "VendorReferral_referredByUserId_fkey" FOREIGN KEY ("referredByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

