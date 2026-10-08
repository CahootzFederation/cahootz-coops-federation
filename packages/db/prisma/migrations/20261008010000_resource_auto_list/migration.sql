-- When a member accepts Sage's invitation to list their own offer, list it right away.
-- Stewards can turn this off, and accepted offers then wait for a steward to publish them.
ALTER TABLE "public"."CommonsAgentSetting" ADD COLUMN "autoListResources" BOOLEAN NOT NULL DEFAULT true;
