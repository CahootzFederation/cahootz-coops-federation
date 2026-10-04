-- AlterTable
ALTER TABLE "public"."CommonsAgentSetting" ADD COLUMN     "autonomyMonthlyCallLimit" INTEGER NOT NULL DEFAULT 2000,
ADD COLUMN     "autonomyMonthlyUsdLimit" DECIMAL(10,2) NOT NULL DEFAULT 5;
