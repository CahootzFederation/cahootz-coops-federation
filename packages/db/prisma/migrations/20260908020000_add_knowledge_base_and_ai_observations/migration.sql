-- Enable pgvector (required for KnowledgeChunk.embedding below).
-- If this fails, the target Postgres host does not allow CREATE EXTENSION
-- from a migration role — enable it out-of-band via the hosting provider first.
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "KnowledgeDocumentType" AS ENUM ('MEETING_NOTES', 'CHARTER', 'BYLAWS', 'FAQ', 'PROJECT_PLAN', 'RESEARCH', 'VENDOR_LIST', 'GRANT_NOTES', 'MEMBER_GUIDE', 'DECISION_SUMMARY', 'OTHER');

-- CreateEnum
CREATE TYPE "KnowledgeVisibility" AS ENUM ('PRIVATE', 'CIRCLE', 'COMMONS', 'PUBLIC');

-- CreateEnum
CREATE TYPE "AIObservationVisibility" AS ENUM ('PRIVATE_TO_AUTHOR_SCOPE', 'CIRCLE', 'COMMONS_ADMINS', 'COMMONS_MEMBERS', 'PUBLIC');

-- CreateEnum
CREATE TYPE "AIObservationStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'DISMISSED', 'EXPIRED');

-- CreateTable
CREATE TABLE "KnowledgeDocument" (
    "id" TEXT NOT NULL,
    "coopId" TEXT NOT NULL DEFAULT 'cahootz',
    "scopeType" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "type" "KnowledgeDocumentType" NOT NULL,
    "visibility" "KnowledgeVisibility" NOT NULL DEFAULT 'COMMONS',
    "title" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "uploadedById" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeChunk" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(1536),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIObservation" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "summary" TEXT NOT NULL,
    "details" JSONB,
    "visibility" "AIObservationVisibility" NOT NULL DEFAULT 'COMMONS_ADMINS',
    "status" "AIObservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3),
    "reviewAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "generatedByAgentKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIObservationSource" (
    "id" TEXT NOT NULL,
    "observationId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIObservationSource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeDocument_coopId_scopeType_scopeId_idx" ON "KnowledgeDocument"("coopId", "scopeType", "scopeId");

-- CreateIndex
CREATE INDEX "KnowledgeDocument_coopId_type_idx" ON "KnowledgeDocument"("coopId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeChunk_documentId_chunkIndex_key" ON "KnowledgeChunk"("documentId", "chunkIndex");

-- CreateIndex (vector similarity search over cosine distance, matching the
-- "<=>" operator used by searchKnowledgeBase(). ivfflat rather than hnsw for
-- broad pgvector compatibility (hnsw requires pgvector >= 0.5.0); lists=100
-- is a reasonable default for a small corpus and can be tuned/rebuilt later
-- as document volume grows.)
CREATE INDEX "KnowledgeChunk_embedding_ivfflat_idx" ON "KnowledgeChunk" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);

-- CreateIndex
CREATE INDEX "AIObservation_scopeType_scopeId_status_idx" ON "AIObservation"("scopeType", "scopeId", "status");

-- CreateIndex
CREATE INDEX "AIObservation_status_expiresAt_idx" ON "AIObservation"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "AIObservation_generatedByAgentKey_createdAt_idx" ON "AIObservation"("generatedByAgentKey", "createdAt");

-- CreateIndex
CREATE INDEX "AIObservationSource_observationId_idx" ON "AIObservationSource"("observationId");

-- CreateIndex
CREATE INDEX "AIObservationSource_sourceType_sourceId_idx" ON "AIObservationSource"("sourceType", "sourceId");

-- AddForeignKey
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIObservation" ADD CONSTRAINT "AIObservation_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIObservationSource" ADD CONSTRAINT "AIObservationSource_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "AIObservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
