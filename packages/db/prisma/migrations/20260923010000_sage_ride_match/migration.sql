-- AlterEnum
ALTER TYPE "CommonsActionType" ADD VALUE 'RIDE_MATCH_PROPOSAL';

-- AlterTable
ALTER TABLE "CommonsAction" ADD COLUMN     "circleId" TEXT,
ADD COLUMN     "payload" JSONB,
ADD COLUMN     "payloadHash" TEXT,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "CommonsActionParticipant" (
    "id" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommonsActionParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommonsActionReview" (
    "id" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reviewType" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "presentationData" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommonsActionReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommonsActionAudit" (
    "id" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "actorId" TEXT,
    "eventType" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommonsActionAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CircleAgentWindow" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "coopId" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "closedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'OPEN',

    CONSTRAINT "CircleAgentWindow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommonsActionParticipant_actionId_userId_key" ON "CommonsActionParticipant"("actionId", "userId");

-- CreateIndex
CREATE INDEX "CommonsActionReview_userId_status_idx" ON "CommonsActionReview"("userId", "status");

-- CreateIndex
CREATE INDEX "CommonsActionReview_actionId_idx" ON "CommonsActionReview"("actionId");

-- CreateIndex
CREATE INDEX "CommonsActionAudit_actionId_createdAt_idx" ON "CommonsActionAudit"("actionId", "createdAt");

-- CreateIndex
CREATE INDEX "CircleAgentWindow_groupId_status_idx" ON "CircleAgentWindow"("groupId", "status");

-- CreateIndex
CREATE INDEX "CommonsAction_circleId_status_idx" ON "CommonsAction"("circleId", "status");

-- AddForeignKey
ALTER TABLE "CommonsActionParticipant" ADD CONSTRAINT "CommonsActionParticipant_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "CommonsAction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommonsActionReview" ADD CONSTRAINT "CommonsActionReview_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "CommonsAction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommonsActionAudit" ADD CONSTRAINT "CommonsActionAudit_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "CommonsAction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
