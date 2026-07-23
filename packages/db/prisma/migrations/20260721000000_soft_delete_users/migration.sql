-- Add explicit soft-delete markers for user-requested account deletion.
ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "deletedBy" TEXT;

CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");
