-- A family's guided-setup answers, so its stewards can edit them later.
ALTER TABLE "public"."CoopConfig" ADD COLUMN "familySetup" JSONB;

-- Families started before guided setup were given two placeholder goals.
-- Clear them so those families show as not set up yet.
UPDATE "public"."CoopConfig"
SET "missionGoals" = '[]'::jsonb
WHERE "coopId" LIKE 'family-%'
  AND "missionGoals" = '[{"key": "stay_connected", "label": "Stay connected", "priorityWeight": 0.5}, {"key": "support_each_other", "label": "Support each other", "priorityWeight": 0.5}]'::jsonb;
