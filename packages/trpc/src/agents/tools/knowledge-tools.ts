import { tool } from "@openai/agents";
import { z } from "zod";

import { searchKnowledgeBase } from "../../services/knowledge-base.js";
import type { AgentToolContext } from "./context.js";

export function buildSearchKnowledgeBaseTool(ctx: AgentToolContext) {
  return tool({
    name: "search_knowledge_base",
    description:
      "Search indexed documents (meeting notes, charters, FAQs, etc.) for a given scope by semantic similarity. Returns document titles and excerpts — cite the document title inline when you use a result.",
    parameters: z.object({
      scopeType: z.string().describe('"commons" or "circle"'),
      scopeId: z.string(),
      query: z.string(),
      limit: z.number().min(1).max(20).default(5),
    }),
    errorFunction: null,
    execute: async ({ scopeType, scopeId, query, limit }) => {
      const results = await searchKnowledgeBase({
        coopId: ctx.coopId,
        scopeType,
        scopeId,
        query,
        limit,
      });
      return results;
    },
  });
}
