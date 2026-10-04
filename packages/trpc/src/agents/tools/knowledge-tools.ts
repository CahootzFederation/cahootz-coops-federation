import { tool } from "@openai/agents";
import { z } from "zod";

import { requireMembership } from "../../routers/groups.js";
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
      // Only this Commons, and only circles the requesting member belongs to (or, for a system job,
      // circles in this Commons).
      if (scopeType === "commons" && scopeId !== ctx.coopId) throw new Error("FORBIDDEN: another Commons.");
      if (scopeType === "circle") {
        if (ctx.requestingUserId) await requireMembership(ctx.db, scopeId, ctx.requestingUserId);
        else {
          const group = await ctx.db.group.findUnique({ where: { id: scopeId }, select: { coopId: true } });
          if (group?.coopId !== ctx.coopId) throw new Error("FORBIDDEN: that circle isn't in this Commons.");
        }
      }
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
