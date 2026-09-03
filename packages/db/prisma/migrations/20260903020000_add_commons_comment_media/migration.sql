CREATE TABLE "public"."CommonsCommentMedia" (
  "id" TEXT NOT NULL,
  "commentId" TEXT NOT NULL,
  "storageProvider" TEXT NOT NULL DEFAULT 'vercel-blob',
  "pathname" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "mediaType" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "fileName" TEXT,
  "width" INTEGER,
  "height" INTEGER,
  "durationMs" INTEGER,
  "sizeBytes" INTEGER,
  "order" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CommonsCommentMedia_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommonsCommentMedia_pathname_key"
  ON "public"."CommonsCommentMedia"("pathname");

CREATE INDEX "CommonsCommentMedia_commentId_order_idx"
  ON "public"."CommonsCommentMedia"("commentId", "order");

ALTER TABLE "public"."CommonsCommentMedia"
  ADD CONSTRAINT "CommonsCommentMedia_commentId_fkey"
  FOREIGN KEY ("commentId") REFERENCES "public"."CommonsComment"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
