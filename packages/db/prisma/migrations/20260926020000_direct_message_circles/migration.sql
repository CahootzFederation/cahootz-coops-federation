-- Direct messages become private two-person circles (Group.kind = 'DIRECT').

-- AlterTable
ALTER TABLE "public"."Group" ADD COLUMN "directKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Group_directKey_key" ON "public"."Group"("directKey");

-- AlterTable
ALTER TABLE "public"."GroupMember" ADD COLUMN "lastReadAt" TIMESTAMP(3);

-- Backfill: one DIRECT circle per (commons, pair of people) that has ever
-- exchanged a DirectMessage. Ids and invite codes are derived from the pair
-- so the backfill is idempotent. Invite codes are lowercase, and joinByCode
-- upper-cases its input, so a DM circle can never be joined by code.
WITH pairs AS (
  SELECT
    "coopId",
    LEAST("senderId", "receiverId") AS user_a,
    GREATEST("senderId", "receiverId") AS user_b,
    MIN("createdAt") AS first_at,
    MAX("createdAt") AS last_at
  FROM "public"."DirectMessage"
  WHERE "senderId" <> "receiverId"
  GROUP BY 1, 2, 3
)
INSERT INTO "public"."Group" (
  "id", "coopId", "name", "privacy", "inviteCode", "leaderId",
  "lastActivityAt", "createdAt", "updatedAt", "kind", "directKey"
)
SELECT
  'dm_' || md5(p."coopId" || ':' || p.user_a || ':' || p.user_b),
  p."coopId",
  'Direct message',
  'private',
  'dm-' || md5('invite:' || p."coopId" || ':' || p.user_a || ':' || p.user_b),
  p.user_a,
  p.last_at,
  p.first_at,
  CURRENT_TIMESTAMP,
  'DIRECT',
  p."coopId" || ':' || p.user_a || ':' || p.user_b
FROM pairs p
ON CONFLICT ("directKey") DO NOTHING;

-- Both people become members. Nothing ever marked a DirectMessage read, so
-- migrated history is treated as read instead of flooding unread badges.
WITH pairs AS (
  SELECT
    "coopId",
    LEAST("senderId", "receiverId") AS user_a,
    GREATEST("senderId", "receiverId") AS user_b,
    MIN("createdAt") AS first_at,
    MAX("createdAt") AS last_at
  FROM "public"."DirectMessage"
  WHERE "senderId" <> "receiverId"
  GROUP BY 1, 2, 3
),
members AS (
  SELECT g."id" AS group_id, p.user_a AS user_id, p.first_at, p.last_at
  FROM pairs p
  JOIN "public"."Group" g ON g."directKey" = p."coopId" || ':' || p.user_a || ':' || p.user_b
  UNION ALL
  SELECT g."id", p.user_b, p.first_at, p.last_at
  FROM pairs p
  JOIN "public"."Group" g ON g."directKey" = p."coopId" || ':' || p.user_a || ':' || p.user_b
)
INSERT INTO "public"."GroupMember" ("id", "groupId", "userId", "joinedAt", "role", "lastReadAt")
SELECT
  'dmm_' || md5(m.group_id || ':' || m.user_id),
  m.group_id,
  m.user_id,
  m.first_at,
  'MEMBER',
  m.last_at
FROM members m
ON CONFLICT ("groupId", "userId") DO NOTHING;

-- Messages keep their original ids, authors, and timestamps.
INSERT INTO "public"."GroupComment" ("id", "groupId", "authorId", "content", "createdAt", "updatedAt")
SELECT
  dm."id",
  g."id",
  dm."senderId",
  dm."content",
  dm."createdAt",
  dm."createdAt"
FROM "public"."DirectMessage" dm
JOIN "public"."Group" g
  ON g."directKey" = dm."coopId" || ':' || LEAST(dm."senderId", dm."receiverId") || ':' || GREATEST(dm."senderId", dm."receiverId")
WHERE dm."senderId" <> dm."receiverId"
ON CONFLICT ("id") DO NOTHING;
