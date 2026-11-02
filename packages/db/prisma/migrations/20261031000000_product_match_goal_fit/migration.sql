-- Whether a discovered item fits its Commons' charter and goals, and why.
ALTER TABLE "public"."CommonsProductMatch" ADD COLUMN "goalFit" TEXT;
ALTER TABLE "public"."CommonsProductMatch" ADD COLUMN "goalFitReason" TEXT;
ALTER TABLE "public"."CommonsProductMatch"
  ADD CONSTRAINT "CommonsProductMatch_goalFit_check" CHECK ("goalFit" IS NULL OR "goalFit" IN ('FITS', 'DOES_NOT_FIT'));
