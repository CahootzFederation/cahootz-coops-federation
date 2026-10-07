-- Slack-style emoji reactions. Existing comment likes become "❤️" reactions.

-- AlterTable
ALTER TABLE "public"."CommonsCommentReaction" ADD COLUMN "emoji" TEXT NOT NULL DEFAULT '❤️';

-- DropIndex
DROP INDEX "public"."CommonsCommentReaction_commentId_userId_key";

-- CreateIndex
CREATE UNIQUE INDEX "CommonsCommentReaction_commentId_userId_emoji_key" ON "public"."CommonsCommentReaction"("commentId", "userId", "emoji");

-- CreateTable
CREATE TABLE "public"."CommonsPostReaction" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommonsPostReaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommonsPostReaction_postId_userId_emoji_key" ON "public"."CommonsPostReaction"("postId", "userId", "emoji");

-- CreateIndex
CREATE INDEX "CommonsPostReaction_postId_idx" ON "public"."CommonsPostReaction"("postId");

-- CreateIndex
CREATE INDEX "CommonsPostReaction_userId_createdAt_idx" ON "public"."CommonsPostReaction"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."CommonsPostReaction" ADD CONSTRAINT "CommonsPostReaction_postId_fkey" FOREIGN KEY ("postId") REFERENCES "public"."CommonsPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CommonsPostReaction" ADD CONSTRAINT "CommonsPostReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
