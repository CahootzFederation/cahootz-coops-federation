-- Link vendor outreach campaigns and marketplace offers to the product-discovery
-- bot's items, so a discovered item can find a seller and become a Group Buy.
ALTER TABLE "public"."VendorCampaign" ADD COLUMN "sourcedProductId" TEXT;
ALTER TABLE "public"."MarketplaceOffer" ADD COLUMN "sourcedProductId" TEXT;

CREATE INDEX "VendorCampaign_sourcedProductId_idx" ON "public"."VendorCampaign"("sourcedProductId");
CREATE INDEX "MarketplaceOffer_sourcedProductId_idx" ON "public"."MarketplaceOffer"("sourcedProductId");

ALTER TABLE "public"."VendorCampaign" ADD CONSTRAINT "VendorCampaign_sourcedProductId_fkey"
  FOREIGN KEY ("sourcedProductId") REFERENCES "public"."SourcedProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."MarketplaceOffer" ADD CONSTRAINT "MarketplaceOffer_sourcedProductId_fkey"
  FOREIGN KEY ("sourcedProductId") REFERENCES "public"."SourcedProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;
