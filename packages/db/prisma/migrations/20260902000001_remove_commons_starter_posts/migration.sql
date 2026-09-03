-- Remove the starter/demo Commons posts that were previously created by the API fallback.

DELETE FROM "public"."CommonsPost"
WHERE "id" IN (
  'starter-food',
  'starter-repair',
  'starter-tech',
  'starter-market',
  'starter-event'
);

DELETE FROM "public"."User"
WHERE "email" = 'commons-starter@cahootz.coop';
