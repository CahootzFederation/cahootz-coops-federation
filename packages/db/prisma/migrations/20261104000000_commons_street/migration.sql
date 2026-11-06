-- Commons Street: one lot per member per Commons, plus live street presence.
CREATE TABLE "public"."StreetLot" (
    "id" TEXT NOT NULL,
    "coopId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lotNumber" INTEGER NOT NULL,
    "houseStyle" TEXT NOT NULL DEFAULT 'a',
    "wallColor" TEXT NOT NULL DEFAULT 'cream',
    "roofColor" TEXT NOT NULL DEFAULT 'terracotta',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StreetLot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StreetLot_coopId_userId_key" ON "public"."StreetLot"("coopId", "userId");
CREATE UNIQUE INDEX "StreetLot_coopId_lotNumber_key" ON "public"."StreetLot"("coopId", "lotNumber");

ALTER TABLE "public"."StreetLot" ADD CONSTRAINT "StreetLot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "public"."StreetPresence" (
    "id" TEXT NOT NULL,
    "coopId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exitedAt" TIMESTAMP(3),

    CONSTRAINT "StreetPresence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StreetPresence_coopId_userId_key" ON "public"."StreetPresence"("coopId", "userId");
CREATE INDEX "StreetPresence_coopId_exitedAt_lastActivityAt_idx" ON "public"."StreetPresence"("coopId", "exitedAt", "lastActivityAt");

ALTER TABLE "public"."StreetPresence" ADD CONSTRAINT "StreetPresence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
