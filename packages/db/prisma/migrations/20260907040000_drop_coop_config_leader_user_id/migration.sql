-- DropForeignKey
ALTER TABLE "CoopConfig" DROP CONSTRAINT "CoopConfig_leaderUserId_fkey";

-- DropIndex
DROP INDEX "CoopConfig_leaderUserId_idx";

-- AlterTable
ALTER TABLE "CoopConfig" DROP COLUMN "leaderUserId";
