CREATE TABLE "public"."PersonalPagePost" (
  "id" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "tag" TEXT,
  "media" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PersonalPagePost_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PersonalPagePost_authorId_createdAt_idx" ON "public"."PersonalPagePost"("authorId", "createdAt");

ALTER TABLE "public"."PersonalPagePost"
  ADD CONSTRAINT "PersonalPagePost_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
