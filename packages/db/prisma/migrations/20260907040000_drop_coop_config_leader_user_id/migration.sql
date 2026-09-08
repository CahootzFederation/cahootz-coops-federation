-- DropForeignKey
ALTER TABLE "CoopConfig" DROP CONSTRAINT IF EXISTS "CoopConfig_leaderUserId_fkey";

-- DropIndex
DROP INDEX IF EXISTS "CoopConfig_leaderUserId_idx";

-- AlterTable
ALTER TABLE "CoopConfig" DROP COLUMN IF EXISTS "leaderUserId";
