-- Store member and visitor requests for future commons.

CREATE TABLE "public"."CommonsSuggestion" (
    "id" TEXT NOT NULL,
    "coopId" TEXT NOT NULL DEFAULT 'cahootz',
    "name" TEXT NOT NULL,
    "reason" TEXT,
    "suggestedByEmail" TEXT NOT NULL,
    "suggestedByName" TEXT,
    "userId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommonsSuggestion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CommonsSuggestion_coopId_createdAt_idx" ON "public"."CommonsSuggestion"("coopId", "createdAt");
CREATE INDEX "CommonsSuggestion_suggestedByEmail_createdAt_idx" ON "public"."CommonsSuggestion"("suggestedByEmail", "createdAt");
CREATE INDEX "CommonsSuggestion_status_createdAt_idx" ON "public"."CommonsSuggestion"("status", "createdAt");

ALTER TABLE "public"."CommonsSuggestion"
ADD CONSTRAINT "CommonsSuggestion_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "public"."User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
