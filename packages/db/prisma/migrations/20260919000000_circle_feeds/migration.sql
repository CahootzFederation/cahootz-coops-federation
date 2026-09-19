-- General is a stable, per-commons virtual circle. Existing commons posts
-- belong to it, including posts written before circles had IDs.
ALTER TABLE "public"."CommonsPost" ADD COLUMN "circleId" TEXT;

UPDATE "public"."CommonsPost"
SET "circleId" = 'general:' || "coopId"
WHERE "circleId" IS NULL;

-- Preserve the old circle discussion as posts in each circle's new feed.
-- Keep GroupComment rows as an audit-friendly legacy record.
INSERT INTO "public"."CommonsPost"
  ("id", "coopId", "circleId", "authorId", "title", "content", "tag", "classification", "classificationSignals", "createdAt", "updatedAt")
SELECT
  'circle:' || gc."id", g."coopId", gc."groupId", gc."authorId",
  LEFT(gc."content", 120), gc."content", 'Social', 'social', '{}'::jsonb,
  gc."createdAt", gc."updatedAt"
FROM "public"."GroupComment" gc
JOIN "public"."Group" g ON g."id" = gc."groupId"
ON CONFLICT ("id") DO NOTHING;

CREATE INDEX "CommonsPost_coopId_circleId_createdAt_idx"
  ON "public"."CommonsPost"("coopId", "circleId", "createdAt");
