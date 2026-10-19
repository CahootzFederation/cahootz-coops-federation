-- Runtime feature flags are no longer used. The formerly gated workflows are
-- now part of the default product behavior.
DROP TABLE IF EXISTS "public"."FeatureFlag";
