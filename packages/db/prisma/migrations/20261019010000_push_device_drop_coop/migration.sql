-- A phone belongs to a member, not one Commons. The column only held the Commons the
-- member opened last, and filtering on it dropped pushes from their other Commons.
DROP INDEX IF EXISTS "public"."PushDevice_coopId_enabled_idx";
ALTER TABLE "public"."PushDevice" DROP COLUMN IF EXISTS "coopId";
