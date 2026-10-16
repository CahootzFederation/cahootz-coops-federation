-- Sage's weekly community rhythm: rhythm posts are COMMUNITY_RHYTHM actions, members choose per
-- category whether to be notified, see the post in the feed (default), or mute it, and opt in to
-- being named in the Friday appreciation.
ALTER TYPE "public"."CommonsActionType" ADD VALUE IF NOT EXISTS 'COMMUNITY_RHYTHM';

ALTER TABLE "public"."User" ADD COLUMN IF NOT EXISTS "nameInSageAppreciation" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "public"."SageRhythmPreference" (
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SageRhythmPreference_pkey" PRIMARY KEY ("userId", "category")
);

CREATE INDEX IF NOT EXISTS "SageRhythmPreference_category_mode_idx" ON "public"."SageRhythmPreference"("category", "mode");

ALTER TABLE "public"."SageRhythmPreference" ADD CONSTRAINT "SageRhythmPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
