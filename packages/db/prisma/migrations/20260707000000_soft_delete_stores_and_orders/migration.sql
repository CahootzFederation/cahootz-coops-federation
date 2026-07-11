-- Add explicit soft-delete markers for admin-managed stores and orders.
ALTER TABLE "Store" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Store" ADD COLUMN "deletedBy" TEXT;

ALTER TABLE "StoreOrder" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "StoreOrder" ADD COLUMN "deletedBy" TEXT;

ALTER TABLE "CommerceTransaction" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "CommerceTransaction" ADD COLUMN "deletedBy" TEXT;

CREATE INDEX "Store_deletedAt_idx" ON "Store"("deletedAt");
CREATE INDEX "StoreOrder_deletedAt_idx" ON "StoreOrder"("deletedAt");
CREATE INDEX "CommerceTransaction_deletedAt_idx" ON "CommerceTransaction"("deletedAt");
