import { tool } from "@openai/agents";
import { z } from "zod";

import { queryObservations } from "../../services/ai-memory.js";
import type { AgentToolContext } from "./context.js";

// No corresponding "record_observation" tool is exposed here on purpose —
// see recordObservation()'s doc comment in services/ai-memory.ts. Writes to
// AI Working Memory stay application-code-triggered after an agent run
// completes, not agent-initiated, so a human/reviewer implicitly gates what
// becomes a stored "belief" other agents can later read via this tool.

export function buildQueryObservationsTool(ctx: AgentToolContext) {
  return tool({
    name: "query_observations",
    description:
      "Read prior AI-generated observations for a scope (a circle or commons) before generating a new one — use this to avoid re-flagging the same pattern every run, or to reference what was said last time.",
    parameters: z.object({
      scopeType: z.string().describe('"commons" or "circle"'),
      scopeId: z.string(),
    }),
    errorFunction: null,
    execute: async ({ scopeType, scopeId }) => {
      return queryObservations({
        scopeType,
        scopeId,
        requestingUserId: ctx.requestingUserId,
        coopId: ctx.coopId,
      });
    },
  });
}
