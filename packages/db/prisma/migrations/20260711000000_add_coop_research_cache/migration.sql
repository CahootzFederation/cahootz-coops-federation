-- CreateTable
CREATE TABLE "public"."CoopResearchCache" (
    "id" TEXT NOT NULL,
    "coopId" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL DEFAULT 'newsletter-research',
    "contextHash" TEXT,
    "data" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "CoopResearchCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CoopResearchCache_coopId_cacheKey_key" ON "public"."CoopResearchCache"("coopId", "cacheKey");

-- CreateIndex
CREATE INDEX "CoopResearchCache_coopId_idx" ON "public"."CoopResearchCache"("coopId");

-- CreateIndex
CREATE INDEX "CoopResearchCache_expiresAt_idx" ON "public"."CoopResearchCache"("expiresAt");
