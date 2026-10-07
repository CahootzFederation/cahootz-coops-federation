import { describe, expect, it, vi } from "vitest";

const { search } = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock("../services/knowledge-base.js", () => ({ searchKnowledgeBase: search }));

const { buildCommentTools } = await import("../agents/tools/comment-tools.js");

// The @openai/agents tool() helper returns a FunctionTool; invoke it the way the runner does.
function call(tools: ReturnType<typeof buildCommentTools>, name: string, args: unknown) {
  const found = tools.find((candidate) => candidate.name === name) as unknown as { invoke: (ctx: unknown, input: string) => Promise<unknown> };
  return found.invoke({}, JSON.stringify(args));
}

function member(skills: string[], resourcesOffered: string[] = []) {
  return { user: { skills, resourcesOffered, interests: [] } };
}

function toolsWith(members: unknown[], resources: unknown[] = []) {
  const db = {
    userCoopMembership: { findMany: vi.fn().mockResolvedValue(members) },
    commonsResource: { findMany: vi.fn().mockResolvedValue(resources) },
  };
  const checked: string[] = [];
  const log = vi.fn();
  const tools = buildCommentTools({ db: db as never, requestingUserId: null, coopId: "harbor", circleId: "circle-1" }, checked, log);
  return { tools, checked, db, log };
}

describe("Sage's comment tools", () => {
  it("counts members who could help without naming anyone, and hides terms only one member lists", async () => {
    const { tools, checked, db } = toolsWith([member(["Carpentry", "Beekeeping"]), member(["carpentry"]), member(["Cooking"])]);
    const result = await call(tools, "count_members_offering", { need: "carpentry help for the shed" });
    expect(result).toEqual({ summary: '2 members list something matching "carpentry help for the shed": carpentry.' });
    expect(JSON.stringify(result)).not.toMatch(/beekeeping/i);
    expect(checked).toEqual([(result as { summary: string }).summary]);
    expect(db.userCoopMembership.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ coopId: "harbor", status: "ACTIVE" }),
      select: { user: { select: { skills: true, resourcesOffered: true, interests: true } } },
    }));
  });

  it("reports a single match as fewer than two, so it can't point at one person", async () => {
    const { tools } = toolsWith([member(["Plumbing"]), member(["Cooking"])]);
    await expect(call(tools, "count_members_offering", { need: "plumbing" })).resolves.toEqual({ summary: 'Fewer than 2 members list something matching "plumbing".' });
  });

  it("searches only this Commons and the given circle, and records excerpts as checkable evidence", async () => {
    search.mockResolvedValue([{ title: "Utility help", excerpt: "The county pays up to $300 toward a winter heating bill." }]);
    const { tools, checked } = toolsWith([]);
    await call(tools, "search_commons_documents", { query: "heating bill help", limit: 1 });
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ coopId: "harbor", scopeType: "commons", scopeId: "harbor" }));
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ coopId: "harbor", scopeType: "circle", scopeId: "circle-1" }));
    expect(checked).toContain("The county pays up to $300 toward a winter heating bill.");
  });

  it("lists only this Commons' published resources", async () => {
    const { tools, checked, db } = toolsWith([], [{ kind: "EQUIPMENT", title: "Shared ladder", description: "A 12-foot ladder at the workshop." }]);
    await call(tools, "list_commons_resources", { limit: 5 });
    expect(db.commonsResource.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { coopId: "harbor", status: "PUBLISHED" } }));
    expect(checked).toContain("A 12-foot ladder at the workshop.");
  });
});
