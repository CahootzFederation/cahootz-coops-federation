-- AlterTable
ALTER TABLE "Proposal" ADD COLUMN     "votingEndsAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SageTask" (
    "id" TEXT NOT NULL,
    "coopId" TEXT NOT NULL,
    "circleId" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "expected" TEXT,
    "offer" TEXT,
    "ownerUserId" TEXT,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "postId" TEXT,
    "sourceActionId" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "nextWakeAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 1,
    "lastWokeAt" TIMESTAMP(3),
    "leaseUntil" TIMESTAMP(3),
    "outcome" TEXT,
    "createdBy" TEXT NOT NULL DEFAULT 'SAGE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SageTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SageTaskEvent" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SageTaskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SageWakeCycle" (
    "id" TEXT NOT NULL,
    "coopId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "leaseUntil" TIMESTAMP(3) NOT NULL,
    "tasksProcessed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SageWakeCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SageAlert" (
    "id" TEXT NOT NULL,
    "coopId" TEXT NOT NULL,
    "circleId" TEXT,
    "category" TEXT NOT NULL,
    "recipientUserId" TEXT,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "postId" TEXT,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "dueAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "reroutedFromId" TEXT,
    "feedback" TEXT,
    "sourceActionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SageAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SageTask_status_nextWakeAt_idx" ON "SageTask"("status", "nextWakeAt");

-- CreateIndex
CREATE INDEX "SageTask_coopId_status_idx" ON "SageTask"("coopId", "status");

-- CreateIndex
CREATE INDEX "SageTask_ownerUserId_status_idx" ON "SageTask"("ownerUserId", "status");

-- CreateIndex
CREATE INDEX "SageTask_subjectType_subjectId_idx" ON "SageTask"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "SageTaskEvent_taskId_createdAt_idx" ON "SageTaskEvent"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "SageWakeCycle_coopId_startedAt_idx" ON "SageWakeCycle"("coopId", "startedAt");

-- CreateIndex
CREATE INDEX "SageAlert_recipientUserId_createdAt_idx" ON "SageAlert"("recipientUserId", "createdAt");

-- CreateIndex
CREATE INDEX "SageAlert_coopId_status_createdAt_idx" ON "SageAlert"("coopId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "SageAlert_subjectType_subjectId_category_idx" ON "SageAlert"("subjectType", "subjectId", "category");

-- AddForeignKey
ALTER TABLE "SageTaskEvent" ADD CONSTRAINT "SageTaskEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "SageTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

