-- Read-only. Members active in the last 30 days, and whether their phone can get pushes.
SELECT
  coalesce(u.name, '(no name)') AS member,
  u.email,
  u."lastActiveAt"::date AS last_active,
  (u."onboardingCompletedAt" IS NOT NULL OR u."profileOnboardingCompletedAt" IS NOT NULL) AS finished_onboarding,
  count(d.id) FILTER (WHERE d.enabled) AS push_phones,
  max(d.platform) AS platform,
  max(d."appVersion") AS app_version,
  min(d."createdAt")::date AS phone_registered_on,
  coalesce(p."pushEnabled", true) AS push_switch_on
FROM "User" u
LEFT JOIN "PushDevice" d ON d."userId" = u.id
LEFT JOIN "NotificationPreference" p ON p."userId" = u.id
WHERE u."lastActiveAt" > now() - interval '30 days'
GROUP BY u.id, p."pushEnabled"
ORDER BY push_phones DESC, last_active DESC;
