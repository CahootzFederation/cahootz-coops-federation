CREATE TABLE "public"."NewsletterSubscription" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "coopId" TEXT NOT NULL,
    "name" TEXT,
    "source" TEXT NOT NULL DEFAULT 'public-newsletter',
    "applyIntent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsletterSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NewsletterSubscription_coopId_email_key" ON "public"."NewsletterSubscription"("coopId", "email");
CREATE INDEX "NewsletterSubscription_coopId_idx" ON "public"."NewsletterSubscription"("coopId");
CREATE INDEX "NewsletterSubscription_email_idx" ON "public"."NewsletterSubscription"("email");
