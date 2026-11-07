-- Is Sage running, and is it reaching people? Read-only. Last 14 days.
-- Run against production:  psql "$DATABASE_URL" -f scripts/sage-health-check.sql

\echo '1. Is the wake loop running? (should be every ~15 min per Commons)'
SELECT "coopId", reason, status, count(*) AS runs, max("startedAt") AS last_run,
       max(error) FILTER (WHERE status = 'FAILED') AS last_error
FROM "SageWakeCycle"
WHERE "startedAt" > now() - interval '14 days'
GROUP BY 1, 2, 3 ORDER BY last_run DESC;

\echo '2. Is Sage calling the model? (no rows = never woke up, or no API key)'
SELECT "coopId", feature, status, count(*) AS calls,
       round(sum(coalesce("costUsd", 0))::numeric, 4) AS usd, max("createdAt") AS last_call
FROM "AICostEvent"
WHERE "createdAt" > now() - interval '14 days'
GROUP BY 1, 2, 3 ORDER BY last_call DESC;

\echo '3. What did Sage decide? (outcome shows "did nothing", "paused", "held for review", etc.)'
SELECT "coopId", agent, trigger, left(outcome, 90) AS outcome, count(*) AS n, max("createdAt") AS last
FROM "SageDecisionTrail"
WHERE "createdAt" > now() - interval '14 days'
GROUP BY 1, 2, 3, 4 ORDER BY n DESC LIMIT 60;

\echo '4. Did anything reach members? (Sage notifications by type)'
SELECT "coopId", type, count(*) AS sent, count(*) FILTER (WHERE read) AS read, max("createdAt") AS last
FROM "Notification"
WHERE type LIKE 'SAGE%' AND "createdAt" > now() - interval '14 days'
GROUP BY 1, 2 ORDER BY sent DESC;

\echo '5. How busy is each Commons? (Sage only reacts to activity)'
SELECT p."coopId",
       count(DISTINCT p.id) AS posts,
       count(DISTINCT p.id) FILTER (WHERE p."circleId" IS NOT NULL) AS circle_posts,
       count(DISTINCT c.id) AS comments,
       count(DISTINCT p."authorId") AS posters
FROM "CommonsPost" p
LEFT JOIN "CommonsComment" c ON c."postId" = p.id AND c."createdAt" > now() - interval '14 days'
WHERE p."createdAt" > now() - interval '14 days'
GROUP BY 1 ORDER BY posts DESC;

\echo '6. Per-Commons switches and limits'
SELECT "coopId", "autoReply", "autonomyMonthlyUsdLimit", "autonomyMonthlyCallLimit", "lastScanAt"
FROM "CommonsAgentSetting";

\echo '7. Follow-ups and alerts Sage is holding'
SELECT 'task' AS kind, "coopId", status, count(*) FROM "SageTask"
WHERE "createdAt" > now() - interval '14 days' GROUP BY 1, 2, 3
UNION ALL
SELECT 'alert', "coopId", status, count(*) FROM "SageAlert"
WHERE "createdAt" > now() - interval '14 days' GROUP BY 1, 2, 3
ORDER BY 1, 2, 3;
