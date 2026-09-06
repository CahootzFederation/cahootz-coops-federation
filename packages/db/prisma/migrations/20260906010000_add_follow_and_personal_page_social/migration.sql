-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN "handle" TEXT;

-- CreateTable
CREATE TABLE "public"."Follow" (
  "id" TEXT NOT NULL,
  "followerId" TEXT NOT NULL,
  "followingId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Follow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PersonalPagePostComment" (
  "id" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PersonalPagePostComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PersonalPagePostSupport" (
  "id" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PersonalPagePostSupport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_handle_key" ON "public"."User"("handle");

-- CreateIndex
CREATE INDEX "Follow_followerId_createdAt_idx" ON "public"."Follow"("followerId", "createdAt");

-- CreateIndex
CREATE INDEX "Follow_followingId_createdAt_idx" ON "public"."Follow"("followingId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Follow_followerId_followingId_key" ON "public"."Follow"("followerId", "followingId");

-- CreateIndex
CREATE INDEX "PersonalPagePostComment_postId_createdAt_idx" ON "public"."PersonalPagePostComment"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "PersonalPagePostComment_authorId_createdAt_idx" ON "public"."PersonalPagePostComment"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "PersonalPagePostSupport_postId_idx" ON "public"."PersonalPagePostSupport"("postId");

-- CreateIndex
CREATE INDEX "PersonalPagePostSupport_userId_createdAt_idx" ON "public"."PersonalPagePostSupport"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PersonalPagePostSupport_postId_userId_key" ON "public"."PersonalPagePostSupport"("postId", "userId");

-- AddForeignKey
ALTER TABLE "public"."Follow"
  ADD CONSTRAINT "Follow_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Follow"
  ADD CONSTRAINT "Follow_followingId_fkey" FOREIGN KEY ("followingId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PersonalPagePostComment"
  ADD CONSTRAINT "PersonalPagePostComment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "public"."PersonalPagePost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PersonalPagePostComment"
  ADD CONSTRAINT "PersonalPagePostComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PersonalPagePostSupport"
  ADD CONSTRAINT "PersonalPagePostSupport_postId_fkey" FOREIGN KEY ("postId") REFERENCES "public"."PersonalPagePost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PersonalPagePostSupport"
  ADD CONSTRAINT "PersonalPagePostSupport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
