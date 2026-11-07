-- Emoji reactions on personal page posts (❤️ stays the post's like in PersonalPagePostSupport).


-- CreateTable
CREATE TABLE "public"."PersonalPagePostReaction" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PersonalPagePostReaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PersonalPagePostReaction_postId_idx" ON "public"."PersonalPagePostReaction"("postId");

-- CreateIndex
CREATE INDEX "PersonalPagePostReaction_userId_createdAt_idx" ON "public"."PersonalPagePostReaction"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PersonalPagePostReaction_postId_userId_emoji_key" ON "public"."PersonalPagePostReaction"("postId", "userId", "emoji");

-- AddForeignKey
ALTER TABLE "public"."PersonalPagePostReaction" ADD CONSTRAINT "PersonalPagePostReaction_postId_fkey" FOREIGN KEY ("postId") REFERENCES "public"."PersonalPagePost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PersonalPagePostReaction" ADD CONSTRAINT "PersonalPagePostReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
