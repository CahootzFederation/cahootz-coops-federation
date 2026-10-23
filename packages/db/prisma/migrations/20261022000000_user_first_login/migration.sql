ALTER TABLE "public"."User" ADD COLUMN "firstLoginAt" TIMESTAMP(3);
-- Preserve returning-account behavior, including expired/revoked sessions.
UPDATE "public"."User" u SET "firstLoginAt" = s."firstLoginAt"
FROM (SELECT "userId", MIN("issuedAt") AS "firstLoginAt" FROM "auth"."Session" GROUP BY "userId") s
WHERE u.id = s."userId";
UPDATE "public"."User" SET "firstLoginAt" = "lastActiveAt"
WHERE "firstLoginAt" IS NULL AND "lastActiveAt" IS NOT NULL;
