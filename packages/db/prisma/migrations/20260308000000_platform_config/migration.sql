-- CreateTable: PlatformConfig
CREATE TABLE "public"."PlatformConfig" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "PlatformConfig_pkey" PRIMARY KEY ("key")
);

-- Seed default coin config
INSERT INTO "public"."PlatformConfig" ("key", "value", "updatedAt") VALUES
  ('coin.symbol',      'SC',           NOW()),
  ('coin.name',        'Cahootz Coin', NOW()),
  ('coin.description', 'Cahootz Coin (SC) is a non-transferable membership token that tracks your co-op participation and gives you a voice in governance.', NOW()),
  ('platform.name',    'Cahootz',      NOW())
ON CONFLICT ("key") DO NOTHING;
