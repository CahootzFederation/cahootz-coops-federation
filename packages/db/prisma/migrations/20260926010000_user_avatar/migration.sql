-- Personal page avatar: uploaded photo, or emoji on a color, falling back to initials.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "avatarUrl" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "avatarEmoji" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "avatarColor" TEXT;
