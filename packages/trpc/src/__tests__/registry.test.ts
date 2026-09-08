import { describe, expect, it, vi, beforeEach } from "vitest";

const { agentConstructorCalls } = vi.hoisted(() => ({
  agentConstructorCalls: [] as any[],
}));

// Real class for Agent (per project convention — a generic vi.fn() mock
// returning a plain object breaks `new Agent(...)`); constructor opts are
// captured via a hoisted array so tests can assert what registry.ts builds
// (instructions, tools, modelSettings) without needing a live model call.
vi.mock("@openai/agents", () => {
  class MockAgent {
    constructor(opts: any) {
      agentConstructorCalls.push(opts);
    }
  }
  return {
    Agent: MockAgent,
    run: vi.fn().mockResolvedValue({
      finalOutput: { type: "test_type", confidence: 0.5, summary: "ok", details: {} },
    }),
    webSearchTool: vi.fn().mockReturnValue({}),
    tool: vi.fn().mockImplementation((opts: any) => ({ __toolName: opts.name })),
  };
});

import { agentRegistry, getAgent, listAgentMetadata } from "../agents/registry.js";
import { run } from "@openai/agents";
import type { AgentToolContext } from "../agents/tools/index.js";

describe("agent registry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentConstructorCalls.length = 0;
  });

  it("keeps all 6 registry entries with unique keys", () => {
    expect(agentRegistry).toHaveLength(6);
    const keys = agentRegistry.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("registers the shared agent as community-observer (generalized from the old post-classifier slot)", () => {
    expect(getAgent("community-observer")).toBeDefined();
    expect(getAgent("post-classifier")).toBeUndefined();
  });

  it("exposes valid JSON-schema-convertible metadata for every registered agent", () => {
    const metadata = listAgentMetadata();
    expect(metadata).toHaveLength(6);
    for (const m of metadata) {
      expect(m.inputSchema).toBeTruthy();
      expect(m.outputSchema).toBeTruthy();
    }
  });

  describe("community-observer run()", () => {
    it("builds an Agent with no tools when called without a toolCtx", async () => {
      const agent = getAgent("community-observer")!;

      const output = await agent.run({
        task: "Classify this single community post.",
        content: "Need help with weekend food support.",
        allowedTypes: ["need", "social"],
      });

      expect(output).toEqual({ type: "test_type", confidence: 0.5, summary: "ok", details: {} });
      expect(agentConstructorCalls).toHaveLength(1);
      expect(agentConstructorCalls[0].tools).toEqual([]);
      expect(agentConstructorCalls[0].modelSettings).toBeUndefined();
    });

    it("builds an Agent with DB/knowledge/memory tools + toolChoice:auto when called with a toolCtx", async () => {
      const agent = getAgent("community-observer")!;
      const toolCtx: AgentToolContext = { db: {} as any, requestingUserId: "user_1", coopId: "cahootz" };

      await agent.run(
        {
          task: "Summarize recent circle activity.",
          content: "...",
          allowedTypes: ["circle_digest_summary"],
        },
        toolCtx,
      );

      expect(agentConstructorCalls).toHaveLength(1);
      expect(agentConstructorCalls[0].tools).toHaveLength(5); // 3 db tools + knowledge search + query_observations
      expect(agentConstructorCalls[0].modelSettings).toEqual({ toolChoice: "auto" });
    });

    it("passes the task/allowedTypes/content into the prompt given to run()", async () => {
      const agent = getAgent("community-observer")!;

      await agent.run({
        task: "Classify this single community post.",
        content: "Need help with weekend food support.",
        allowedTypes: ["need", "social"],
      });

      const [, prompt] = vi.mocked(run).mock.calls[0];
      expect(prompt).toContain("Classify this single community post.");
      expect(prompt).toContain("need, social");
      expect(prompt).toContain("Need help with weekend food support.");
    });

    it("falls back to a zero-confidence 'unknown' observation when the agent returns no output", async () => {
      vi.mocked(run).mockResolvedValueOnce({} as any);
      const agent = getAgent("community-observer")!;

      const output = await agent.run({ task: "t", content: "c" });

      expect(output).toEqual({ type: "unknown", confidence: 0, summary: "The agent returned no output." });
    });
  });
});
