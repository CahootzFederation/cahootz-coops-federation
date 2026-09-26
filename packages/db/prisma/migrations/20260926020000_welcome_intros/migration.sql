-- A newcomer's intro comment on a welcome lounge's Sage welcome post, with
-- the reply and escalation state that makes each alert fire at most once.

-- CreateTable
CREATE TABLE "public"."WelcomeIntro" (
    "id" TEXT NOT NULL,
    "coopId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "newcomerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "responderId" TEXT,
    "responseCommentId" TEXT,
    "guideEscalatedAt" TIMESTAMP(3),
    "adminEscalatedAt" TIMESTAMP(3),

    CONSTRAINT "WelcomeIntro_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WelcomeIntro_commentId_key" ON "public"."WelcomeIntro"("commentId");

-- CreateIndex
CREATE UNIQUE INDEX "WelcomeIntro_groupId_newcomerId_key" ON "public"."WelcomeIntro"("groupId", "newcomerId");

-- CreateIndex
CREATE INDEX "WelcomeIntro_postId_respondedAt_idx" ON "public"."WelcomeIntro"("postId", "respondedAt");

-- CreateIndex
CREATE INDEX "WelcomeIntro_respondedAt_createdAt_idx" ON "public"."WelcomeIntro"("respondedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."WelcomeIntro" ADD CONSTRAINT "WelcomeIntro_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WelcomeIntro" ADD CONSTRAINT "WelcomeIntro_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "public"."CommonsComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WelcomeIntro" ADD CONSTRAINT "WelcomeIntro_newcomerId_fkey" FOREIGN KEY ("newcomerId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
