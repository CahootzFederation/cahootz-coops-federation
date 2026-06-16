ALTER TABLE "public"."DirectoryBusiness"
  ADD COLUMN "formattedAddress" TEXT,
  ADD COLUMN "placeId" TEXT,
  ADD COLUMN "latitude" DOUBLE PRECISION,
  ADD COLUMN "longitude" DOUBLE PRECISION;

CREATE INDEX "DirectoryBusiness_coopId_latitude_longitude_idx"
  ON "public"."DirectoryBusiness"("coopId", "latitude", "longitude");
