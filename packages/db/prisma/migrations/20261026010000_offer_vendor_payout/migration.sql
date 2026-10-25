-- Offers now record a dollar amount per unit for the vendor, and how what's left
-- after Stripe's fee and the vendor is split between the Commons and Cahootz.
ALTER TABLE "MarketplaceOffer" ADD COLUMN "vendorPayoutCents" INTEGER;
ALTER TABLE "MarketplaceOffer" ADD COLUMN "commonsSplitBps" INTEGER NOT NULL DEFAULT 5000;

-- Existing offers keep what the vendor got under the old percentage shares.
UPDATE "MarketplaceOffer"
SET "vendorPayoutCents" = "memberPriceCents" - ROUND("memberPriceCents" * ("federationFeeBps" + "commonsFeeBps") / 10000.0)::INTEGER;

ALTER TABLE "MarketplaceOffer" ALTER COLUMN "vendorPayoutCents" SET NOT NULL;
ALTER TABLE "MarketplaceOffer" DROP COLUMN "federationFeeBps";
ALTER TABLE "MarketplaceOffer" DROP COLUMN "commonsFeeBps";

ALTER TABLE "MarketplaceOffer" ADD CONSTRAINT "MarketplaceOffer_vendor_payout_check" CHECK ("vendorPayoutCents" > 0 AND "vendorPayoutCents" <= "memberPriceCents");
ALTER TABLE "MarketplaceOffer" ADD CONSTRAINT "MarketplaceOffer_commons_split_check" CHECK ("commonsSplitBps" BETWEEN 0 AND 10000);
