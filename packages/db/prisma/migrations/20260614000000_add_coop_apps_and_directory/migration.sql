-- CreateTable
CREATE TABLE "public"."CoopAppSetting" (
    "id" TEXT NOT NULL,
    "coopId" TEXT NOT NULL,
    "appKey" TEXT NOT NULL,
    "publicEnabled" BOOLEAN NOT NULL DEFAULT true,
    "memberEnabled" BOOLEAN NOT NULL DEFAULT true,
    "portalEnabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoopAppSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CoopAppRequest" (
    "id" TEXT NOT NULL,
    "coopId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "requestedBy" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoopAppRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DirectoryBusiness" (
    "id" TEXT NOT NULL,
    "coopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "description" TEXT,
    "imageUrl" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zipCode" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "DirectoryBusiness_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CoopAppSetting_coopId_appKey_key" ON "public"."CoopAppSetting"("coopId", "appKey");

-- CreateIndex
CREATE INDEX "CoopAppSetting_coopId_publicEnabled_sortOrder_idx" ON "public"."CoopAppSetting"("coopId", "publicEnabled", "sortOrder");

-- CreateIndex
CREATE INDEX "CoopAppSetting_coopId_memberEnabled_sortOrder_idx" ON "public"."CoopAppSetting"("coopId", "memberEnabled", "sortOrder");

-- CreateIndex
CREATE INDEX "CoopAppRequest_coopId_status_createdAt_idx" ON "public"."CoopAppRequest"("coopId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "DirectoryBusiness_coopId_isActive_isFeatured_sortOrder_idx" ON "public"."DirectoryBusiness"("coopId", "isActive", "isFeatured", "sortOrder");

-- CreateIndex
CREATE INDEX "DirectoryBusiness_coopId_category_idx" ON "public"."DirectoryBusiness"("coopId", "category");

-- Seed built-in app settings for every active coop.
INSERT INTO "public"."CoopAppSetting" ("id", "coopId", "appKey", "publicEnabled", "memberEnabled", "portalEnabled", "sortOrder", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, c."coopId", 'marketplace', true, true, true, 0, NOW(), NOW()
FROM "public"."CoopConfig" c
WHERE c."isActive" = true
ON CONFLICT ("coopId", "appKey") DO NOTHING;

INSERT INTO "public"."CoopAppSetting" ("id", "coopId", "appKey", "publicEnabled", "memberEnabled", "portalEnabled", "sortOrder", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, c."coopId", 'directory', true, true, true, 1, NOW(), NOW()
FROM "public"."CoopConfig" c
WHERE c."isActive" = true
ON CONFLICT ("coopId", "appKey") DO NOTHING;
