-- CreateEnum
CREATE TYPE "HumanAIFeedbackResponse" AS ENUM ('YES', 'PARTLY', 'DIFFERENT_TAKE');

-- CreateTable
CREATE TABLE "HumanAIFeedback" (
    "id" TEXT NOT NULL,
    "observationId" TEXT NOT NULL,
    "coopId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "response" "HumanAIFeedbackResponse" NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HumanAIFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HumanAIFeedback_coopId_createdAt_idx" ON "HumanAIFeedback"("coopId", "createdAt");

-- CreateIndex
CREATE INDEX "HumanAIFeedback_userId_idx" ON "HumanAIFeedback"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "HumanAIFeedback_observationId_userId_key" ON "HumanAIFeedback"("observationId", "userId");

-- AddForeignKey
ALTER TABLE "HumanAIFeedback" ADD CONSTRAINT "HumanAIFeedback_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "AIObservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HumanAIFeedback" ADD CONSTRAINT "HumanAIFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Pulse wording is immutable. Revisions are new observations; lifecycle metadata may change.
CREATE FUNCTION public.protect_community_pulse_wording() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."type" = 'community_pulse' AND
    (NEW."summary", NEW."details", NEW."type", NEW."scopeType", NEW."scopeId") IS DISTINCT FROM
    (OLD."summary", OLD."details", OLD."type", OLD."scopeType", OLD."scopeId") THEN
    RAISE EXCEPTION 'Publish a new Pulse observation instead of changing its wording or scope';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_community_pulse_wording BEFORE UPDATE ON public."AIObservation"
FOR EACH ROW EXECUTE FUNCTION public.protect_community_pulse_wording();

ALTER TABLE public."HumanAIFeedback" ADD CONSTRAINT "HumanAIFeedback_comment_length"
CHECK ("comment" IS NULL OR char_length("comment") <= 500);

-- Keep redundant Commons scope truthful and serialize saves against expiry/supersession updates.
CREATE FUNCTION public.check_human_ai_feedback_observation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE observation public."AIObservation"%ROWTYPE;
BEGIN
  SELECT * INTO observation FROM public."AIObservation" WHERE id = NEW."observationId" FOR SHARE;
  IF NOT FOUND OR observation."scopeType" <> 'commons' OR observation."scopeId" <> NEW."coopId"
    OR observation."type" <> 'community_pulse' OR observation.visibility <> 'COMMONS_MEMBERS'
    OR observation.status <> 'ACTIVE' OR (observation."expiresAt" IS NOT NULL AND observation."expiresAt" <= CURRENT_TIMESTAMP) THEN
    RAISE EXCEPTION 'Feedback requires an active member-visible Pulse in the same Commons';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER check_human_ai_feedback_observation BEFORE INSERT OR UPDATE ON public."HumanAIFeedback"
FOR EACH ROW EXECUTE FUNCTION public.check_human_ai_feedback_observation();
