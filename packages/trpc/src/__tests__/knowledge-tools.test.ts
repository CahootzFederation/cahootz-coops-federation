import { describe, expect, it, vi, beforeEach } from "vitest";

import { buildSearchKnowledgeBaseTool } from "../agents/tools/knowledge-tools.js";
import { searchKnowledgeBase } from "../services/knowledge-base.js";
import type { AgentToolContext } from "../agents/tools/context.js";

vi.mock("../services/knowledge-base.js", () => ({
  searchKnowledgeBase: vi.fn(),
}));

async function callTool(t: any, args: Record<string, unknown>) {
  return t.invoke({} as any, JSON.stringify(args));
}

function makeCtx(overrides: Partial<AgentToolContext> = {}): AgentToolContext {
  return { db: {} as any, requestingUserId: "user_1", coopId: "cahootz", ...overrides };
}

describe("search_knowledge_base tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("embeds the tool's query params into a searchKnowledgeBase() call and returns its results", async () => {
    vi.mocked(searchKnowledgeBase).mockResolvedValue([
      { documentId: "doc_1", title: "Circle Charter", excerpt: "...", relevance: 0.9 },
    ]);

    const result = await callTool(buildSearchKnowledgeBaseTool(makeCtx()), {
      scopeType: "circle",
      scopeId: "group_1",
      query: "budget",
      limit: 5,
    });

    expect(searchKnowledgeBase).toHaveBeenCalledWith({
      coopId: "cahootz",
      scopeType: "circle",
      scopeId: "group_1",
      query: "budget",
      limit: 5,
    });
    expect(result).toEqual([
      { documentId: "doc_1", title: "Circle Charter", excerpt: "...", relevance: 0.9 },
    ]);
  });

  it("propagates a search failure as a rejection rather than a swallowed string", async () => {
    vi.mocked(searchKnowledgeBase).mockRejectedValue(new Error("embedding provider unavailable"));

    await expect(
      callTool(buildSearchKnowledgeBaseTool(makeCtx()), {
        scopeType: "commons",
        scopeId: "cahootz",
        query: "childcare",
        limit: 5,
      }),
    ).rejects.toThrow("embedding provider unavailable");
  });
});
