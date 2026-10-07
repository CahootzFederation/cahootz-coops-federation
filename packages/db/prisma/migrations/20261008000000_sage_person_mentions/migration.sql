-- CreateTable
CREATE TABLE "public"."SagePersonMention" (
    "id" TEXT NOT NULL,
    "coopId" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "relation" TEXT,
    "mentionedById" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SagePersonMention_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SagePersonMention_sourceType_sourceId_nameKey_key" ON "public"."SagePersonMention"("sourceType", "sourceId", "nameKey");

-- CreateIndex
CREATE INDEX "SagePersonMention_coopId_nameKey_createdAt_idx" ON "public"."SagePersonMention"("coopId", "nameKey", "createdAt");

-- CreateIndex
CREATE INDEX "SagePersonMention_createdAt_idx" ON "public"."SagePersonMention"("createdAt");
