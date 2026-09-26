-- Comment-level "like" reactions on commons comments (one per member per
-- comment). A reaction on a welcome lounge intro counts as a response to it.

-- CreateTable
CREATE TABLE "public"."CommonsCommentReaction" (
    "id" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommonsCommentReaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommonsCommentReaction_commentId_userId_key" ON "public"."CommonsCommentReaction"("commentId", "userId");

-- CreateIndex
CREATE INDEX "CommonsCommentReaction_commentId_idx" ON "public"."CommonsCommentReaction"("commentId");

-- CreateIndex
CREATE INDEX "CommonsCommentReaction_userId_createdAt_idx" ON "public"."CommonsCommentReaction"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."CommonsCommentReaction" ADD CONSTRAINT "CommonsCommentReaction_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "public"."CommonsComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CommonsCommentReaction" ADD CONSTRAINT "CommonsCommentReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
