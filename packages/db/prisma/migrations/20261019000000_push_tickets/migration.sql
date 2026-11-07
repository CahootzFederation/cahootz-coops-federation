-- Track each Expo push attempt so a monitor can read delivery receipts, turn off dead
-- devices, and alert Slack about failed pushes.
CREATE TABLE IF NOT EXISTS "public"."PushTicket" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "coopId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "expoTicketId" TEXT,
    "errorCode" TEXT,
    "checkedAt" TIMESTAMP(3),
    "alertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushTicket_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PushTicket_status_createdAt_idx" ON "public"."PushTicket"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "PushTicket_alertedAt_status_idx" ON "public"."PushTicket"("alertedAt", "status");
