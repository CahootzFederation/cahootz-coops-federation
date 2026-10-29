-- Member Deals and Group Buys no longer go through a marketplace shop. Cahootz
-- collects every payment, saves a Group Buy member's card to charge once the
-- goal is met, and sends the vendor the order list by hand.

-- Offers name their vendor directly; the shop and product links become optional.
ALTER TABLE "MarketplaceOffer" DROP CONSTRAINT "MarketplaceOffer_productId_fkey";
ALTER TABLE "MarketplaceOffer" DROP CONSTRAINT "MarketplaceOffer_storeId_fkey";

ALTER TABLE "MarketplaceOffer" ADD COLUMN "imageUrl" TEXT,
ADD COLUMN "vendorEmail" TEXT,
ADD COLUMN "vendorName" TEXT,
ADD COLUMN "vendorPhone" TEXT,
ADD COLUMN "vendorProspectId" TEXT,
ALTER COLUMN "storeId" DROP NOT NULL,
ALTER COLUMN "productId" DROP NOT NULL,
ALTER COLUMN "businessId" DROP NOT NULL,
ALTER COLUMN "fulfillmentMethod" SET DEFAULT 'DELIVERY';

-- Existing offers keep their shop's name and the product's photo.
UPDATE "MarketplaceOffer" o
SET "vendorName" = s."name"
FROM "Store" s
WHERE o."storeId" = s."id";
UPDATE "MarketplaceOffer" o
SET "imageUrl" = p."imageUrl"
FROM "Product" p
WHERE o."productId" = p."id" AND o."imageUrl" IS NULL;
UPDATE "MarketplaceOffer" SET "vendorName" = 'Vendor' WHERE "vendorName" IS NULL;
ALTER TABLE "MarketplaceOffer" ALTER COLUMN "vendorName" SET NOT NULL;

ALTER TABLE "MarketplaceOffer" ADD CONSTRAINT "MarketplaceOffer_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MarketplaceOffer" ADD CONSTRAINT "MarketplaceOffer_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Offer payments go to Cahootz, so they have no shop business.
ALTER TABLE "CommerceTransaction" DROP CONSTRAINT "CommerceTransaction_businessId_fkey";
ALTER TABLE "CommerceTransaction" ALTER COLUMN "businessId" DROP NOT NULL;
ALTER TABLE "CommerceTransaction" ADD CONSTRAINT "CommerceTransaction_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Where to ship each order, and the Group Buy card to charge.
ALTER TABLE "OfferCommitment" ADD COLUMN "chargeError" TEXT,
ADD COLUMN "shippingAddress" JSONB,
ADD COLUMN "stripePaymentMethodId" TEXT;

-- What Cahootz paid each vendor, by hand.
CREATE TABLE "OfferVendorPayout" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "method" TEXT NOT NULL,
    "note" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OfferVendorPayout_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OfferVendorPayout_offerId_idx" ON "OfferVendorPayout"("offerId");
ALTER TABLE "OfferVendorPayout" ADD CONSTRAINT "OfferVendorPayout_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "MarketplaceOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A member's saved delivery address, filled in on their next order.
CREATE TABLE "UserShippingAddress" (
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserShippingAddress_pkey" PRIMARY KEY ("userId")
);
ALTER TABLE "UserShippingAddress" ADD CONSTRAINT "UserShippingAddress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
