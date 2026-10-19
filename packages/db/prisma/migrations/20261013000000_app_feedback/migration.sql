-- CreateTable
CREATE TABLE "public"."AppFeedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "category" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "screenshotUrls" TEXT[],
    "screen" TEXT,
    "coopId" TEXT,
    "platform" TEXT,
    "appVersion" TEXT,
    "slackSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AppFeedback_createdAt_idx" ON "public"."AppFeedback"("createdAt");

-- CreateIndex
CREATE INDEX "AppFeedback_userId_idx" ON "public"."AppFeedback"("userId");

-- AddForeignKey
ALTER TABLE "public"."AppFeedback" ADD CONSTRAINT "AppFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
