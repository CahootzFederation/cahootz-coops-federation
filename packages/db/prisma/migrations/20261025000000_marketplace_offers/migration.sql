-- CreateEnum
CREATE TYPE "OfferType" AS ENUM ('MEMBER_DEAL', 'GROUP_BUY');

-- CreateEnum
CREATE TYPE "OfferFulfillmentMethod" AS ENUM ('PICKUP', 'DELIVERY');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('DRAFT', 'PENDING_STEWARD', 'LIVE', 'PAUSED', 'AWAITING_VENDOR', 'PAYMENT_OPEN', 'CONFIRMED', 'ORDERED', 'READY', 'FULFILLED', 'EXPIRED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "CommitmentStatus" AS ENUM ('COMMITTED', 'CANCELLED', 'PAYMENT_PENDING', 'PAID', 'LAPSED', 'REFUNDED', 'FULFILLED');

-- AlterTable
ALTER TABLE "CommerceTransaction" ADD COLUMN     "federationFeeAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "offerId" TEXT,
ADD COLUMN     "processingFeeAmount" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "TreasuryLedgerEntry" ADD COLUMN     "coopId" TEXT;

-- CreateTable
CREATE TABLE "MarketplaceOffer" (
    "id" TEXT NOT NULL,
    "offerType" "OfferType" NOT NULL,
    "coopId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "regularPriceCents" INTEGER NOT NULL,
    "regularPriceSource" TEXT NOT NULL,
    "memberPriceCents" INTEGER NOT NULL,
    "federationFeeBps" INTEGER NOT NULL DEFAULT 0,
    "commonsFeeBps" INTEGER NOT NULL DEFAULT 0,
    "minimumCommitments" INTEGER,
    "minimumPaidOrders" INTEGER,
    "maximumQuantity" INTEGER,
    "quantityPerMember" INTEGER NOT NULL DEFAULT 1,
    "committedQuantity" INTEGER NOT NULL DEFAULT 0,
    "commitmentDeadline" TIMESTAMP(3),
    "paymentWindowHours" INTEGER NOT NULL DEFAULT 72,
    "paymentOpensAt" TIMESTAMP(3),
    "paymentDeadline" TIMESTAMP(3),
    "fulfillmentDate" TIMESTAMP(3),
    "fulfillmentMethod" "OfferFulfillmentMethod" NOT NULL DEFAULT 'PICKUP',
    "pickupLocation" TEXT,
    "serviceArea" TEXT,
    "redemptionRules" TEXT,
    "refundPolicy" TEXT,
    "substitutionPolicy" TEXT,
    "terms" TEXT,
    "status" "OfferStatus" NOT NULL DEFAULT 'DRAFT',
    "stewardNote" TEXT,
    "createdById" TEXT NOT NULL,
    "stewardApprovedById" TEXT,
    "stewardApprovedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferCommitment" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "CommitmentStatus" NOT NULL DEFAULT 'COMMITTED',
    "contactName" TEXT,
    "contactPhone" TEXT,
    "regularUnitCents" INTEGER NOT NULL,
    "memberUnitCents" INTEGER NOT NULL,
    "savingsCents" INTEGER NOT NULL DEFAULT 0,
    "commerceTransactionId" TEXT,
    "refundError" TEXT,
    "committedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "paymentNotifiedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "fulfilledAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfferCommitment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferNotificationSend" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfferNotificationSend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketplaceOffer_coopId_status_idx" ON "MarketplaceOffer"("coopId", "status");

-- CreateIndex
CREATE INDEX "MarketplaceOffer_status_commitmentDeadline_idx" ON "MarketplaceOffer"("status", "commitmentDeadline");

-- CreateIndex
CREATE INDEX "MarketplaceOffer_status_paymentDeadline_idx" ON "MarketplaceOffer"("status", "paymentDeadline");

-- CreateIndex
CREATE INDEX "MarketplaceOffer_status_expiresAt_idx" ON "MarketplaceOffer"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "MarketplaceOffer_storeId_idx" ON "MarketplaceOffer"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "OfferCommitment_commerceTransactionId_key" ON "OfferCommitment"("commerceTransactionId");

-- CreateIndex
CREATE INDEX "OfferCommitment_userId_status_idx" ON "OfferCommitment"("userId", "status");

-- CreateIndex
CREATE INDEX "OfferCommitment_offerId_status_idx" ON "OfferCommitment"("offerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OfferCommitment_offerId_userId_key" ON "OfferCommitment"("offerId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "OfferNotificationSend_offerId_userId_kind_key" ON "OfferNotificationSend"("offerId", "userId", "kind");

-- CreateIndex
CREATE INDEX "CommerceTransaction_offerId_idx" ON "CommerceTransaction"("offerId");

-- CreateIndex
CREATE INDEX "TreasuryLedgerEntry_coopId_accountType_idx" ON "TreasuryLedgerEntry"("coopId", "accountType");

-- AddForeignKey
ALTER TABLE "CommerceTransaction" ADD CONSTRAINT "CommerceTransaction_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "MarketplaceOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceOffer" ADD CONSTRAINT "MarketplaceOffer_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceOffer" ADD CONSTRAINT "MarketplaceOffer_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferCommitment" ADD CONSTRAINT "OfferCommitment_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "MarketplaceOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferCommitment" ADD CONSTRAINT "OfferCommitment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferCommitment" ADD CONSTRAINT "OfferCommitment_commerceTransactionId_fkey" FOREIGN KEY ("commerceTransactionId") REFERENCES "CommerceTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferNotificationSend" ADD CONSTRAINT "OfferNotificationSend_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "MarketplaceOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A member price must be a real saving, and quantities must make sense.
ALTER TABLE "MarketplaceOffer" ADD CONSTRAINT "MarketplaceOffer_member_price_check" CHECK ("memberPriceCents" > 0 AND "memberPriceCents" < "regularPriceCents");
ALTER TABLE "MarketplaceOffer" ADD CONSTRAINT "MarketplaceOffer_quantity_check" CHECK ("quantityPerMember" >= 1 AND "committedQuantity" >= 0);
ALTER TABLE "OfferCommitment" ADD CONSTRAINT "OfferCommitment_quantity_check" CHECK ("quantity" >= 1);

-- Give existing ledger entries their Commons from the transaction they came from.
UPDATE "TreasuryLedgerEntry" AS e
SET "coopId" = t."coopId"
FROM "CommerceTransaction" AS t
WHERE e."sourceTransactionId" = t."id" AND e."coopId" IS NULL;
