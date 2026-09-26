CREATE TYPE "public"."StoreKind" AS ENUM ('MEMBER', 'OFFICIAL_COMMONS');
CREATE TYPE "public"."ProductKind" AS ENUM ('STANDARD', 'FUNDING_BADGE');
CREATE TYPE "public"."FundingBadgeTier" AS ENUM (
  'SEED_SUPPORTER',
  'GROWTH_SUPPORTER',
  'COMMUNITY_BUILDER',
  'COMMONS_PILLAR',
  'CORNERSTONE_PARTNER',
  'LEGACY_FOUNDER'
);
CREATE TYPE "public"."FundingBadgeEntitlementStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REVOKED');

ALTER TABLE "public"."Store"
  ADD COLUMN "kind" "public"."StoreKind" NOT NULL DEFAULT 'MEMBER';

ALTER TABLE "public"."Product"
  ADD COLUMN "kind" "public"."ProductKind" NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN "fundingBadgeTier" "public"."FundingBadgeTier";

ALTER TABLE "public"."CommerceTransaction"
  ADD COLUMN "refundedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE TABLE "public"."FundingBadgeEntitlement" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "coopId" TEXT NOT NULL,
  "tier" "public"."FundingBadgeTier" NOT NULL,
  "productId" TEXT NOT NULL,
  "commerceTransactionId" TEXT NOT NULL,
  "status" "public"."FundingBadgeEntitlementStatus" NOT NULL DEFAULT 'ACTIVE',
  "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "suspendedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FundingBadgeEntitlement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FundingBadgeEntitlement_userId_coopId_tier_key"
  ON "public"."FundingBadgeEntitlement"("userId", "coopId", "tier");
CREATE UNIQUE INDEX "FundingBadgeEntitlement_commerceTransactionId_productId_key"
  ON "public"."FundingBadgeEntitlement"("commerceTransactionId", "productId");
CREATE INDEX "FundingBadgeEntitlement_userId_coopId_status_idx"
  ON "public"."FundingBadgeEntitlement"("userId", "coopId", "status");
CREATE INDEX "FundingBadgeEntitlement_coopId_tier_status_idx"
  ON "public"."FundingBadgeEntitlement"("coopId", "tier", "status");

CREATE UNIQUE INDEX "Store_one_official_per_commons"
  ON "public"."Store"("coopId")
  WHERE "kind" = 'OFFICIAL_COMMONS' AND "deletedAt" IS NULL;
CREATE UNIQUE INDEX "Store_one_member_shop_per_owner_commons"
  ON "public"."Store"("ownerId", "coopId")
  WHERE "kind" = 'MEMBER' AND "deletedAt" IS NULL;

ALTER TABLE "public"."FundingBadgeEntitlement"
  ADD CONSTRAINT "FundingBadgeEntitlement_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."FundingBadgeEntitlement"
  ADD CONSTRAINT "FundingBadgeEntitlement_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."FundingBadgeEntitlement"
  ADD CONSTRAINT "FundingBadgeEntitlement_commerceTransactionId_fkey"
  FOREIGN KEY ("commerceTransactionId") REFERENCES "public"."CommerceTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
