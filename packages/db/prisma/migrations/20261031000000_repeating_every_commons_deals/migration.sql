-- Group deals can be open to every Commons, repeat on their own, and be a
-- service (nothing ships, so no address).

-- An offer with no Commons is open to members of every Commons.
ALTER TABLE "MarketplaceOffer" ALTER COLUMN "coopId" DROP NOT NULL;

-- A repeating deal posts a fresh copy when it hits its goal or ends short.
ALTER TABLE "MarketplaceOffer" ADD COLUMN "repeats" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "roundDays" INTEGER,
ADD COLUMN "repeatedFromId" TEXT;

CREATE INDEX "MarketplaceOffer_repeats_status_idx" ON "MarketplaceOffer"("repeats", "status");

-- The Commons whose share a member's payment goes to. Existing spots belong to
-- their offer's Commons.
ALTER TABLE "OfferCommitment" ADD COLUMN "coopId" TEXT;
UPDATE "OfferCommitment" c
SET "coopId" = o."coopId"
FROM "MarketplaceOffer" o
WHERE c."offerId" = o."id";

ALTER TYPE "OfferFulfillmentMethod" ADD VALUE 'SERVICE';
