-- Sage asks the whole Commons an open question when a community pattern qualifies,
-- instead of routing the pattern to one person.
ALTER TYPE "public"."CommonsActionType" ADD VALUE IF NOT EXISTS 'ASK_COMMONS';
