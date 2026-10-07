-- Idempotent: an earlier copy of this migration ran in the PR preview database under the name 20261008000000_sage_person_mentions.
-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."SagePersonMention" (
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
CREATE UNIQUE INDEX IF NOT EXISTS "SagePersonMention_sourceType_sourceId_nameKey_key" ON "public"."SagePersonMention"("sourceType", "sourceId", "nameKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SagePersonMention_coopId_nameKey_createdAt_idx" ON "public"."SagePersonMention"("coopId", "nameKey", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SagePersonMention_createdAt_idx" ON "public"."SagePersonMention"("createdAt");
