CREATE TABLE "public"."CommonsPostMedia" (
  "id" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
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

  CONSTRAINT "CommonsPostMedia_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommonsPostMedia_pathname_key" ON "public"."CommonsPostMedia"("pathname");
CREATE INDEX "CommonsPostMedia_postId_order_idx" ON "public"."CommonsPostMedia"("postId", "order");

ALTER TABLE "public"."CommonsPostMedia"
  ADD CONSTRAINT "CommonsPostMedia_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "public"."CommonsPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
