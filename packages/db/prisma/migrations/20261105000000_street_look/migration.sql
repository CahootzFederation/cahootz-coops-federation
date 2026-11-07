-- How each member's person looks on Commons streets (account-wide).
CREATE TABLE "public"."StreetLook" (
    "userId" TEXT NOT NULL,
    "skin" TEXT NOT NULL,
    "hairStyle" TEXT NOT NULL,
    "hairColor" TEXT NOT NULL,
    "shirt" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StreetLook_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "public"."StreetLook" ADD CONSTRAINT "StreetLook_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
