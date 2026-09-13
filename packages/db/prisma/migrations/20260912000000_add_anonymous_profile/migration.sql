-- CreateTable
CREATE TABLE "public"."AnonymousProfile" (
    "id" TEXT NOT NULL,
    "anonymousId" TEXT NOT NULL,
    "selfDescription" TEXT,
    "goals" TEXT,
    "interests" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "resourcesOffered" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "resourcesNeeded" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "businessSummary" TEXT,
    "locationSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "migratedToUserId" TEXT,
    "migratedAt" TIMESTAMP(3),

    CONSTRAINT "AnonymousProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AnonymousProfile_anonymousId_key" ON "public"."AnonymousProfile"("anonymousId");
