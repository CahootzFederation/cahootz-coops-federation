-- One weekly "member deals" notification per member per Commons.
CREATE TABLE "public"."OfferDigestSend" (
    "id" TEXT NOT NULL,
    "coopId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OfferDigestSend_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OfferDigestSend_coopId_userId_weekKey_key" ON "public"."OfferDigestSend"("coopId", "userId", "weekKey");
