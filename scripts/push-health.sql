-- Read-only push notification health check. Run against the production
-- database (Railway → Postgres → Data → Query). Nothing here writes.

-- 1. How many active members have a phone that can get pushes?
SELECT
  count(*) FILTER (WHERE u."lastActiveAt" > now() - interval '30 days') AS active_members_30d,
  count(*) FILTER (WHERE u."lastActiveAt" > now() - interval '30 days'
    AND EXISTS (SELECT 1 FROM "PushDevice" d WHERE d."userId" = u.id AND d.enabled)) AS active_with_push_device
FROM "User" u;

-- 2. New phones registered per week. If the ask stopped on 2026-09-26,
--    this should drop to near zero after that week.
SELECT date_trunc('week', "createdAt")::date AS week, count(*) AS phones_registered
FROM "PushDevice"
WHERE "createdAt" > now() - interval '12 weeks'
GROUP BY 1 ORDER BY 1;

-- 3. What Expo/Apple said about recent sends. Any InvalidCredentials or
--    DeviceNotRegistered here is a second, bigger problem.
SELECT status, coalesce("errorCode", '-') AS error_code, count(*) AS tickets
FROM "PushTicket"
WHERE "createdAt" > now() - interval '14 days'
GROUP BY 1, 2 ORDER BY 3 DESC;

-- 4. Alerts written in the last 7 days, and how many of them were pushed.
SELECT
  n.type,
  count(*) AS alerts,
  count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "PushTicket" t WHERE t."notificationId" = n.id)) AS pushed
FROM "Notification" n
WHERE n."createdAt" > now() - interval '7 days'
GROUP BY 1 ORDER BY 2 DESC
LIMIT 25;
