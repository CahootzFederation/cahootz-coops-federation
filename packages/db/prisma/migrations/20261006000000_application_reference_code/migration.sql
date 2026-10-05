-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "referenceCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Application_referenceCode_key" ON "Application"("referenceCode");

