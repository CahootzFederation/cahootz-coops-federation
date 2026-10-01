-- Commons join policies, invitations, and access requests.
-- See packages/trpc/src/services/commons-membership.ts for the rules.

-- CreateEnum
CREATE TYPE "public"."CommonsJoinPolicy" AS ENUM ('AUTOMATIC', 'APPLICATION_REQUIRED', 'INVITE_ONLY');

-- CreateEnum
CREATE TYPE "public"."CommonsInvitationPurpose" AS ENUM ('DIRECT_JOIN', 'APPLY', 'REQUEST_ACCESS');

-- CreateEnum
CREATE TYPE "public"."CommonsInvitationStatus" AS ENUM ('PENDING_APPROVAL', 'PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');

-- AlterEnum
ALTER TYPE "public"."ApplicationStatus" ADD VALUE 'WITHDRAWN';

-- AlterTable
ALTER TABLE "public"."Application" ADD COLUMN     "invitationId" TEXT,
ADD COLUMN     "referredByUserId" TEXT,
ADD COLUMN     "requestType" TEXT NOT NULL DEFAULT 'APPLICATION',
ADD COLUMN     "reviewedByUserId" TEXT,
ADD COLUMN     "withdrawnAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."CoopConfig" ADD COLUMN     "joinPolicy" "public"."CommonsJoinPolicy" NOT NULL DEFAULT 'APPLICATION_REQUIRED';

-- CreateTable
CREATE TABLE "public"."CommonsInvitation" (
    "id" TEXT NOT NULL,
    "coopId" TEXT NOT NULL,
    "inviterId" TEXT NOT NULL,
    "purpose" "public"."CommonsInvitationPurpose" NOT NULL,
    "recipientEmailNormalized" TEXT,
    "recipientPhoneNormalized" TEXT,
    "recipientName" TEXT,
    "message" TEXT,
    "tokenHash" TEXT NOT NULL,
    "status" "public"."CommonsInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "acceptedByUserId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommonsInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommonsInvitation_tokenHash_key" ON "public"."CommonsInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "CommonsInvitation_coopId_status_idx" ON "public"."CommonsInvitation"("coopId", "status");

-- CreateIndex
CREATE INDEX "CommonsInvitation_recipientEmailNormalized_status_idx" ON "public"."CommonsInvitation"("recipientEmailNormalized", "status");

-- CreateIndex
CREATE INDEX "CommonsInvitation_recipientPhoneNormalized_status_idx" ON "public"."CommonsInvitation"("recipientPhoneNormalized", "status");

-- CreateIndex
CREATE INDEX "CommonsInvitation_inviterId_createdAt_idx" ON "public"."CommonsInvitation"("inviterId", "createdAt");

-- CreateIndex
CREATE INDEX "Application_invitationId_idx" ON "public"."Application"("invitationId");

-- AddForeignKey
ALTER TABLE "public"."Application" ADD CONSTRAINT "Application_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "public"."CommonsInvitation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CommonsInvitation" ADD CONSTRAINT "CommonsInvitation_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The Cahootz Commons is the only automatic commons; every other existing
-- commons keeps requiring an application.
UPDATE "public"."CoopConfig" SET "joinPolicy" = 'AUTOMATIC' WHERE "coopId" = 'cahootz';
