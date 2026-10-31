-- A product-discovery run's step-by-step log (searches, pages, finds), so admins can watch it.
ALTER TABLE "public"."ProductDiscoveryRun" ADD COLUMN "progress" JSONB NOT NULL DEFAULT '[]';
