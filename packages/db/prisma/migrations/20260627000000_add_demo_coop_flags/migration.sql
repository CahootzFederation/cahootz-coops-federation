ALTER TABLE "CoopConfig"
  ADD COLUMN IF NOT EXISTS "isDemo" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "PublicCoopInfo"
  ADD COLUMN IF NOT EXISTS "isDemo" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "CoopConfig_isDemo_idx" ON "CoopConfig"("isDemo");
CREATE INDEX IF NOT EXISTS "PublicCoopInfo_isDemo_idx" ON "PublicCoopInfo"("isDemo");
