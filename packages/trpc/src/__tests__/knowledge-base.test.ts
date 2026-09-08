import { describe, expect, it, vi, beforeEach } from "vitest";
import { db } from "@repo/db";

const mockDb = db as any;

const mockEmbeddingsCreate = vi.fn();
vi.mock("openai", () => {
  class MockOpenAI {
    embeddings = { create: mockEmbeddingsCreate };
    constructor(_opts: any) {}
  }
  return { default: MockOpenAI };
});

import { chunkText, ingestDocument, searchKnowledgeBase } from "../services/knowledge-base.js";

describe("chunkText", () => {
  it("groups consecutive short paragraphs into one chunk", () => {
    const content = "Para one.\n\nPara two.\n\nPara three.";
    expect(chunkText(content, 800)).toEqual(["Para one.\n\nPara two.\n\nPara three."]);
  });

  it("splits into a new chunk once the target size is exceeded", () => {
    const long = "x".repeat(50);
    const content = [long, long, long].join("\n\n");
    const chunks = chunkText(content, 60);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toContain(long);
  });

  it("returns an empty array for blank content", () => {
    expect(chunkText("   \n\n  ")).toEqual([]);
  });
});

describe("knowledge-base service", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockDb.knowledgeDocument = {
      create: vi.fn().mockImplementation(({ data }: any) => ({
        id: "doc_1",
        ...data,
        createdAt: new Date("2026-09-08T00:00:00.000Z"),
        updatedAt: new Date("2026-09-08T00:00:00.000Z"),
      })),
    };
    mockDb.knowledgeChunk = {
      create: vi.fn().mockImplementation(({ data }: any) => ({
        id: `chunk_${data.chunkIndex}`,
        ...data,
      })),
    };
    mockDb.$executeRaw = vi.fn().mockResolvedValue(1);
    mockDb.$queryRaw = vi.fn().mockResolvedValue([]);

    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: [0.1, 0.2, 0.3] }],
    });
  });

  describe("ingestDocument", () => {
    it("creates the document, chunks + embeds the content, and writes each chunk's embedding via raw SQL", async () => {
      mockEmbeddingsCreate.mockResolvedValue({
        data: [{ embedding: [0.1, 0.2] }],
      });

      const result = await ingestDocument({
        scopeType: "circle",
        scopeId: "group_1",
        type: "MEETING_NOTES",
        title: "Sept meeting",
        uploadedById: "user_1",
        content: "Only one short paragraph.",
      });

      expect(mockDb.knowledgeDocument.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          coopId: "cahootz",
          scopeType: "circle",
          scopeId: "group_1",
          title: "Sept meeting",
          uploadedById: "user_1",
        }),
      });
      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        model: "text-embedding-3-small",
        input: ["Only one short paragraph."],
      });
      expect(mockDb.knowledgeChunk.create).toHaveBeenCalledTimes(1);
      expect(mockDb.$executeRaw).toHaveBeenCalledTimes(1);
      expect(result.chunkCount).toBe(1);
      expect(result.document.id).toBe("doc_1");
    });

    it("skips embedding entirely for blank content", async () => {
      const result = await ingestDocument({
        scopeType: "commons",
        scopeId: "cahootz",
        type: "FAQ",
        title: "Empty",
        uploadedById: "user_1",
        content: "   ",
      });

      expect(mockEmbeddingsCreate).not.toHaveBeenCalled();
      expect(result.chunkCount).toBe(0);
    });
  });

  describe("searchKnowledgeBase", () => {
    it("embeds the query and runs a scoped similarity search", async () => {
      mockDb.$queryRaw.mockResolvedValue([
        { documentId: "doc_1", title: "Sept meeting", excerpt: "...", relevance: 0.92 },
      ]);

      const results = await searchKnowledgeBase({
        scopeType: "circle",
        scopeId: "group_1",
        query: "budget",
      });

      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        model: "text-embedding-3-small",
        input: "budget",
      });
      expect(mockDb.$queryRaw).toHaveBeenCalledTimes(1);
      expect(results).toEqual([
        { documentId: "doc_1", title: "Sept meeting", excerpt: "...", relevance: 0.92 },
      ]);
    });
  });
});
