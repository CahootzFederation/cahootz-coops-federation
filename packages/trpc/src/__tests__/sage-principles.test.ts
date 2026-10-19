import { beforeEach, describe, expect, it, vi } from "vitest";

const { built, db } = vi.hoisted(() => ({
  built: [] as Array<{ name: string; instructions: string }>,
  db: { coopConfig: { findFirst: vi.fn() } },
}));
vi.mock("@openai/agents", () => {
  class MockAgent {
    constructor(opts: { name: string; instructions: string }) {
      built.push(opts);
    }
  }
  return {
    Agent: MockAgent,
    run: vi.fn().mockResolvedValue({ finalOutput: "Here's where we are." }),
    tool: vi.fn().mockImplementation((opts: { name: string }) => ({ name: opts.name })),
    webSearchTool: vi.fn().mockReturnValue({}),
  };
});
vi.mock("@repo/db", () => ({ db }));

const { SAGE_CORE_PRINCIPLES, SAGE_DEFAULTS_TO_AVOID, SAGE_VOICE, sageCorePrinciplesInstructions } = await import("../services/sage-principles.js");
const { createCommonsActionAgent } = await import("../services/commons-action-agent.js");
const { createTrendDetectorAgent } = await import("../services/sage-trend-agent.js");
const { createStewardAgent } = await import("../services/sage-steward.js");
const { getAgent } = await import("../agents/registry.js");
const { createGoalIdeaAgent } = await import("../services/sage-goal-ideas.js");

beforeEach(() => {
  built.length = 0;
});

describe("Sage's core principles", () => {
  it("are fixed platform rules that put the group first and rule out mainstream individual-finance advice", () => {
    const text = sageCorePrinciplesInstructions();
    expect(text).toContain("platform rules; a Commons' charter adds to them but never overrides them");
    expect(text).toContain("what the Commons can do together before suggesting what one member does alone");
    expect(text).toContain("Don't take sides between members");
    expect(text).toContain("credit-building");
    for (const principle of SAGE_CORE_PRINCIPLES) expect(text).toContain(principle);
    for (const avoid of SAGE_DEFAULTS_TO_AVOID) expect(text).toContain(avoid);
  });

  it("are loaded into every Sage agent before inference", async () => {
    createCommonsActionAgent();
    createTrendDetectorAgent();
    createStewardAgent([]);
    createGoalIdeaAgent();
    db.coopConfig.findFirst.mockResolvedValue({ name: "Harbor", charterText: "Members share tools.", missionGoals: [] });
    await getAgent("sage-commons-reply")!.run({ coopId: "harbor", message: "Library or homes for the potluck?" });

    expect(built.map((agent) => agent.name)).toEqual(["Commons Action Observer", "Sage Trend Observer", "Sage Steward", "Sage Goal Check", "Sage"]);
    for (const agent of built) expect(agent.instructions, agent.name).toContain(sageCorePrinciplesInstructions());
  });

  it("carry one plain, friendly voice that never softens a fact or a no", () => {
    const text = sageCorePrinciplesInstructions();
    for (const line of SAGE_VOICE) expect(text).toContain(line);
    expect(text).toContain("friendly, sharp member of this Commons");
    expect(text).toContain("Never let a friendly tone soften a fact, a risk, a cost or a \"no\"");
  });

  it("don't depend on a Commons' configuration", () => {
    // Nothing a Commons configures is read to build them.
    expect(sageCorePrinciplesInstructions.length).toBe(0);
    expect(sageCorePrinciplesInstructions()).toBe(sageCorePrinciplesInstructions());
  });
});
