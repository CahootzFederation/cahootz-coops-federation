-- One account-wide Sage notification category replaces the per-rhythm controls.
-- Existing per-rhythm rows are retained as inert historical data so this change is reversible.
-- General-feed rhythm posts continue to use the existing Community category.
ALTER TABLE "public"."NotificationPreference"
ADD COLUMN IF NOT EXISTS "sage" BOOLEAN NOT NULL DEFAULT true;
