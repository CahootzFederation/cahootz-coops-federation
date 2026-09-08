import { describe, expect, it, vi, beforeEach } from "vitest";

import { buildQueryObservationsTool } from "../agents/tools/memory-tools.js";
import { queryObservations } from "../services/ai-memory.js";
import type { AgentToolContext } from "../agents/tools/context.js";

vi.mock("../services/ai-memory.js", () => ({
  queryObservations: vi.fn(),
}));

async function callTool(t: any, args: Record<string, unknown>) {
  return t.invoke({} as any, JSON.stringify(args));
}

function makeCtx(overrides: Partial<AgentToolContext> = {}): AgentToolContext {
  return { db: {} as any, requestingUserId: "user_1", coopId: "cahootz", ...overrides };
}

describe("query_observations tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards the tool's scope params plus the bound requesting user/coop to queryObservations()", async () => {
    vi.mocked(queryObservations).mockResolvedValue([
      {
        id: "obs_1",
        type: "circle_digest_summary",
        scopeType: "circle",
        scopeId: "group_1",
        confidence: 0.8,
        summary: "Last digest summary.",
        details: null,
        sources: [],
        visibility: "CIRCLE",
        status: "ACTIVE",
        createdAt: "2026-09-08T00:00:00.000Z",
      },
    ]);

    const result = await callTool(buildQueryObservationsTool(makeCtx()), {
      scopeType: "circle",
      scopeId: "group_1",
    });

    expect(queryObservations).toHaveBeenCalledWith({
      scopeType: "circle",
      scopeId: "group_1",
      requestingUserId: "user_1",
      coopId: "cahootz",
    });
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("circle_digest_summary");
  });

  it("uses null as the requesting user for a system/background toolCtx", async () => {
    vi.mocked(queryObservations).mockResolvedValue([]);

    await callTool(buildQueryObservationsTool(makeCtx({ requestingUserId: null })), {
      scopeType: "commons",
      scopeId: "cahootz",
    });

    expect(queryObservations).toHaveBeenCalledWith(
      expect.objectContaining({ requestingUserId: null }),
    );
  });
});
