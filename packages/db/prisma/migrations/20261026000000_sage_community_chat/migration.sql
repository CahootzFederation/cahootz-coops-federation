-- AlterEnum
ALTER TYPE "public"."ProductKind" ADD VALUE 'SAGE_MESSAGE_PACK';

-- AlterTable
ALTER TABLE "public"."Product" ADD COLUMN "sageMessageCount" INTEGER;

-- CreateTable
CREATE TABLE "public"."SageMessageCredit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "coopId" TEXT NOT NULL,
    "messages" INTEGER NOT NULL,
    "productId" TEXT NOT NULL,
    "commerceTransactionId" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SageMessageCredit_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SageMessageCredit_messages_positive" CHECK ("messages" > 0)
);

-- CreateTable
CREATE TABLE "public"."SageMessageUse" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "coopId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "paid" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SageMessageUse_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SageMessageUse_source_check" CHECK ("source" IN ('CHAT', 'DM'))
);

-- CreateTable
CREATE TABLE "public"."SageChatMessage" (
    "id" TEXT NOT NULL,
    "coopId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SageChatMessage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SageChatMessage_role_check" CHECK ("role" IN ('MEMBER', 'SAGE'))
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_storeId_sageMessageCount_key" ON "public"."Product"("storeId", "sageMessageCount");

-- CreateIndex
CREATE INDEX "SageMessageCredit_userId_coopId_idx" ON "public"."SageMessageCredit"("userId", "coopId");

-- CreateIndex
CREATE UNIQUE INDEX "SageMessageCredit_commerceTransactionId_productId_key" ON "public"."SageMessageCredit"("commerceTransactionId", "productId");

-- CreateIndex
CREATE INDEX "SageMessageUse_userId_coopId_createdAt_idx" ON "public"."SageMessageUse"("userId", "coopId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SageMessageUse_source_sourceId_key" ON "public"."SageMessageUse"("source", "sourceId");

-- CreateIndex
CREATE INDEX "SageChatMessage_userId_coopId_createdAt_idx" ON "public"."SageChatMessage"("userId", "coopId", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."SageMessageCredit" ADD CONSTRAINT "SageMessageCredit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SageMessageCredit" ADD CONSTRAINT "SageMessageCredit_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SageMessageCredit" ADD CONSTRAINT "SageMessageCredit_commerceTransactionId_fkey" FOREIGN KEY ("commerceTransactionId") REFERENCES "public"."CommerceTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SageMessageUse" ADD CONSTRAINT "SageMessageUse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SageChatMessage" ADD CONSTRAINT "SageChatMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
