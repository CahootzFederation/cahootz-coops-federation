-- Add social-network primitives for the public Cahootz Commons feed.

CREATE TABLE "public"."CommonsPost" (
    "id" TEXT NOT NULL,
    "coopId" TEXT NOT NULL DEFAULT 'cahootz',
    "authorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tag" TEXT NOT NULL DEFAULT 'Need',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommonsPost_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."CommonsComment" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommonsComment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."CommonsPostSupport" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommonsPostSupport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."DirectMessage" (
    "id" TEXT NOT NULL,
    "coopId" TEXT NOT NULL DEFAULT 'cahootz',
    "senderId" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DirectMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CommonsPost_coopId_createdAt_idx" ON "public"."CommonsPost"("coopId", "createdAt");
CREATE INDEX "CommonsPost_authorId_createdAt_idx" ON "public"."CommonsPost"("authorId", "createdAt");
CREATE INDEX "CommonsComment_postId_createdAt_idx" ON "public"."CommonsComment"("postId", "createdAt");
CREATE INDEX "CommonsComment_authorId_createdAt_idx" ON "public"."CommonsComment"("authorId", "createdAt");
CREATE UNIQUE INDEX "CommonsPostSupport_postId_userId_key" ON "public"."CommonsPostSupport"("postId", "userId");
CREATE INDEX "CommonsPostSupport_postId_idx" ON "public"."CommonsPostSupport"("postId");
CREATE INDEX "CommonsPostSupport_userId_createdAt_idx" ON "public"."CommonsPostSupport"("userId", "createdAt");
CREATE INDEX "DirectMessage_coopId_createdAt_idx" ON "public"."DirectMessage"("coopId", "createdAt");
CREATE INDEX "DirectMessage_senderId_receiverId_createdAt_idx" ON "public"."DirectMessage"("senderId", "receiverId", "createdAt");
CREATE INDEX "DirectMessage_receiverId_createdAt_idx" ON "public"."DirectMessage"("receiverId", "createdAt");

ALTER TABLE "public"."CommonsPost"
ADD CONSTRAINT "CommonsPost_authorId_fkey"
FOREIGN KEY ("authorId") REFERENCES "public"."User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."CommonsComment"
ADD CONSTRAINT "CommonsComment_postId_fkey"
FOREIGN KEY ("postId") REFERENCES "public"."CommonsPost"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."CommonsComment"
ADD CONSTRAINT "CommonsComment_authorId_fkey"
FOREIGN KEY ("authorId") REFERENCES "public"."User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."CommonsPostSupport"
ADD CONSTRAINT "CommonsPostSupport_postId_fkey"
FOREIGN KEY ("postId") REFERENCES "public"."CommonsPost"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."CommonsPostSupport"
ADD CONSTRAINT "CommonsPostSupport_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "public"."User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."DirectMessage"
ADD CONSTRAINT "DirectMessage_senderId_fkey"
FOREIGN KEY ("senderId") REFERENCES "public"."User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."DirectMessage"
ADD CONSTRAINT "DirectMessage_receiverId_fkey"
FOREIGN KEY ("receiverId") REFERENCES "public"."User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
