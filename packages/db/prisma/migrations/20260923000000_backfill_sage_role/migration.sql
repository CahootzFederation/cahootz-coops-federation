-- DataMigration: stamp the "sage" role onto the existing global Sage bot
-- account (handle "sage") now that Sage accounts are recognized by role
-- instead of by hardcoded handle. New, per-coop Sage accounts get this
-- role at creation time (see packages/trpc/src/lib/bot.ts); this backfill
-- only covers the pre-existing account created before that change.
UPDATE "public"."User"
SET "roles" = array_append("roles", 'sage')
WHERE "handle" = 'sage'
  AND "isBot" = true
  AND NOT ('sage' = ANY("roles"));

UPDATE "public"."UserCoopMembership" m
SET "roles" = array_append(m."roles", 'sage')
FROM "public"."User" u
WHERE m."userId" = u."id"
  AND u."handle" = 'sage'
  AND u."isBot" = true
  AND NOT ('sage' = ANY(m."roles"));
