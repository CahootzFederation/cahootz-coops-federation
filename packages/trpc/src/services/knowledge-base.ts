import OpenAI from "openai";
import { db, Prisma } from "@repo/db";
import type { KnowledgeDocumentType, KnowledgeVisibility } from "@repo/db";

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const CHUNK_TARGET_SIZE = 800; // characters, not tokens — simple heuristic, not exact

let client: OpenAI | null = null;
function getOpenAIClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

// Simple paragraph-based chunker: groups consecutive paragraphs up to
// ~CHUNK_TARGET_SIZE characters. Good enough for markdown-ish source text
// (meeting notes, charters, FAQs) without pulling in a tokenizer dependency.
export function chunkText(content: string, targetSize = CHUNK_TARGET_SIZE): string[] {
  const paragraphs = content
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) return [];

  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > targetSize) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

export interface IngestDocumentParams {
  coopId?: string;
  scopeType: string;
  scopeId: string;
  type: KnowledgeDocumentType;
  visibility?: KnowledgeVisibility;
  title: string;
  sourceUrl?: string;
  uploadedById: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export async function ingestDocument(params: IngestDocumentParams) {
  const document = await db.knowledgeDocument.create({
    data: {
      coopId: params.coopId ?? "cahootz",
      scopeType: params.scopeType,
      scopeId: params.scopeId,
      type: params.type,
      visibility: params.visibility ?? "COMMONS",
      title: params.title,
      sourceUrl: params.sourceUrl,
      uploadedById: params.uploadedById,
      content: params.content,
      metadata: (params.metadata ?? {}) as Prisma.InputJsonValue,
    },
  });

  const chunks = chunkText(params.content);
  if (chunks.length === 0) {
    return { document, chunkCount: 0 };
  }

  const openai = getOpenAIClient();
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: chunks,
  });

  for (let i = 0; i < chunks.length; i++) {
    const chunk = await db.knowledgeChunk.create({
      data: {
        documentId: document.id,
        chunkIndex: i,
        content: chunks[i],
      },
    });

    // `embedding` is an Unsupported("vector(1536)") column — Prisma Client
    // has no typed way to read/write it, so it's set via a follow-up raw
    // statement rather than as part of the create() above.
    const vectorLiteral = toVectorLiteral(response.data[i].embedding);
    await db.$executeRaw`UPDATE "KnowledgeChunk" SET "embedding" = ${vectorLiteral}::vector WHERE "id" = ${chunk.id}`;
  }

  return { document, chunkCount: chunks.length };
}

export interface SearchKnowledgeBaseParams {
  coopId?: string;
  scopeType: string;
  scopeId: string;
  visibility?: KnowledgeVisibility;
  query: string;
  limit?: number;
}

export interface KnowledgeSearchResult {
  documentId: string;
  title: string;
  excerpt: string;
  relevance: number;
}

export async function searchKnowledgeBase(
  params: SearchKnowledgeBaseParams,
): Promise<KnowledgeSearchResult[]> {
  const openai = getOpenAIClient();
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: params.query,
  });
  const vectorLiteral = toVectorLiteral(response.data[0].embedding);
  const coopId = params.coopId ?? "cahootz";
  const limit = params.limit ?? 5;

  const rows = await db.$queryRaw<KnowledgeSearchResult[]>(Prisma.sql`
    SELECT
      kd."id" AS "documentId",
      kd."title" AS "title",
      kc."content" AS "excerpt",
      1 - (kc."embedding" <=> ${vectorLiteral}::vector) AS "relevance"
    FROM "KnowledgeChunk" kc
    JOIN "KnowledgeDocument" kd ON kd."id" = kc."documentId"
    WHERE kd."coopId" = ${coopId}
      AND kd."scopeType" = ${params.scopeType}
      AND kd."scopeId" = ${params.scopeId}
      ${params.visibility ? Prisma.sql`AND kd."visibility" = ${params.visibility}::"KnowledgeVisibility"` : Prisma.empty}
    ORDER BY kc."embedding" <=> ${vectorLiteral}::vector
    LIMIT ${limit}
  `);

  return rows;
}

// Every dimension this service assumes is fixed at ingest time — changing
// the embedding model/dims later requires a new column + backfill, not a
// simple config flip, since the column width is hardcoded in the migration.
export const KNOWLEDGE_BASE_EMBEDDING_CONFIG = {
  model: EMBEDDING_MODEL,
  dimensions: EMBEDDING_DIMENSIONS,
};
