-- Cahootz's mailing address for the footer of every outreach email (US law
-- requires one in business email). An address an admin already set is kept.
INSERT INTO "public"."PlatformConfig" ("key", "value", "updatedAt", "updatedBy")
VALUES ('outreach.postalAddress', '2261 Market Street STE 16357, San Francisco, CA 94114', CURRENT_TIMESTAMP, 'migration')
ON CONFLICT ("key") DO NOTHING;
