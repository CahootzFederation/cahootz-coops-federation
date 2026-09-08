-- DropForeignKey
ALTER TABLE "public"."CommentAIEvaluation" DROP CONSTRAINT "CommentAIEvaluation_commentId_fkey";

-- DropTable
DROP TABLE "public"."CommentAIEvaluation";

-- DropEnum
DROP TYPE "public"."CommentAlignment";

-- CreateEnum
CREATE TYPE "public"."AIEvaluationStatus" AS ENUM ('SUCCESS', 'ERROR');

-- CreateTable
CREATE TABLE "public"."AIEvaluation" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "agentKey" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "model" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "input" JSONB,
    "output" JSONB,
    "status" "public"."AIEvaluationStatus" NOT NULL DEFAULT 'SUCCESS',
    "error" TEXT,
    "durationMs" INTEGER,

    CONSTRAINT "AIEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AIEvaluation_entityType_entityId_idx" ON "public"."AIEvaluation"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AIEvaluation_agentKey_createdAt_idx" ON "public"."AIEvaluation"("agentKey", "createdAt");
