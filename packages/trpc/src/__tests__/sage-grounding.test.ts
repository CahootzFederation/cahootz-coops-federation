import { describe, expect, it, vi } from "vitest";

vi.mock("@repo/db", () => ({ db: {} }));

const { checkRelevance, groundingCheck, isGroundedIn, needsCharterGrounding } = await import("../services/sage-grounding.js");
const { groundingSources, mayAutoReply, replyPolicyChecks } = await import("../services/commons-action-agent.js");

const config = {
  id: "config-1", version: 1, coopId: "harbor", charterText: "Spending over $500 needs a member proposal and a vote.",
  missionGoals: [{ label: "Share tools", description: "Make equipment available to members" }],
} as never;
const item = {
  sourceType: "commons_post" as const, sourceId: "post-1", sourcePostId: "post-1", sourceAuthorId: "user-1",
  createdAt: new Date("2026-10-06T10:00:00.000Z"), title: "Potluck spot",
  content: "Library or rotating homes? The library is free but closes at 7, and homes mean the same two families host.",
  context: "", coopId: "harbor",
};
const tradeOff = {
  type: "ANSWER_QUESTION" as const, summary: "Lay out the potluck options", evidenceSource: "thread" as const,
  evidence: "the library is free but closes at 7", confidence: 0.9,
  draftText: "We're choosing between the library and homes.\n• Library: free, closes at 7.\n• Homes: later, same hosts.\n\nHow many of us need to leave before 7?",
  resourceKind: "" as const, resourceTitle: "", targetHandle: "",
};
const now = new Date("2026-10-06T12:00:00.000Z");

describe("Sage evidence sources", () => {
  const sources = groundingSources(config, item, ["3 members list something matching \"hosting\": cooking, hosting."]);

  it("accepts an exact quote only from the source it names", () => {
    expect(isGroundedIn("the library is free but closes at 7", "thread", sources)).toBe(true);
    expect(isGroundedIn("the library is free but closes at 7", "checked", sources)).toBe(false);
    expect(isGroundedIn("3 members list something matching", "checked", sources)).toBe(true);
    expect(isGroundedIn("Make equipment available", "charter", sources)).toBe(true);
    expect(isGroundedIn("the library is open until 10", "thread", sources)).toBe(false);
    expect(isGroundedIn("library", "thread", sources)).toBe(false); // too short to be a real quote
  });

  it("requires the charter for rules, votes, membership and the Commons' money, but not everyday decisions", () => {
    expect(needsCharterGrounding("ANSWER_QUESTION", "Library: free, closes at 7. How many of us need to leave early?")).toBe(false);
    expect(needsCharterGrounding("ANSWER_QUESTION", "It costs $40 a month; we could split it four ways.")).toBe(false);
    expect(needsCharterGrounding("ANSWER_QUESTION", "This needs a vote before we buy it.")).toBe(true);
    expect(needsCharterGrounding("ANSWER_QUESTION", "We could pay for it from the Commons' funds.")).toBe(true);
    expect(needsCharterGrounding("MAKE_PROPOSAL", "Let's get a van.")).toBe(true);
    expect(needsCharterGrounding("RESPOND_CHARTER_CORRECTION", "Anything.")).toBe(true);
  });

  it("rejects a thread quote for a reply that talks about rules", () => {
    const check = groundingCheck({ ...tradeOff, draftText: "Under our rules this needs a vote first." }, sources);
    expect(check).toMatchObject({ charterRequired: true, grounded: false });
    expect(groundingCheck({ ...tradeOff, draftText: "This needs a vote.", evidence: "needs a member proposal and a vote" }, sources).grounded).toBe(true);
  });

  it("lets a thread-grounded reply to an everyday decision publish without a charter quote", () => {
    expect(mayAutoReply(tradeOff, item, config, true, now, [], sources)).toBe(true);
    expect(mayAutoReply({ ...tradeOff, evidence: "the library stays open late" }, item, config, true, now, [], sources)).toBe(false);
    const grounding = replyPolicyChecks(tradeOff, item, config, true, now, [], sources).find((check) => check.label.startsWith("Its evidence"));
    expect(grounding).toMatchObject({ passed: true, detail: 'Quotes the post or its thread exactly: "the library is free but closes at 7"' });
  });
});

describe("the relevance check", () => {
  it("asks the judge even when the evidence is a quote from the post itself", async () => {
    const judge = vi.fn().mockResolvedValue({ relevant: false, reason: "The reply answers a different question." });
    const input = { post: "Library or homes for the potluck?", reply: "Votes stay open 7 days.", evidence: "Library or homes for the potluck" };
    await expect(checkRelevance(input, judge)).resolves.toMatchObject({ relevant: false });
    expect(judge).toHaveBeenCalledWith(input);
  });

  it("reports the source the excerpt was really found in", () => {
    const sources = groundingSources(config, item);
    expect(groundingCheck({ ...tradeOff, evidenceSource: "thread", evidence: "Make equipment available to members" }, sources))
      .toMatchObject({ grounded: true, source: "charter" });
  });

  it("asks the judge about charter and checked evidence, and fails closed", async () => {
    const offTopic = vi.fn().mockResolvedValue({ relevant: false, reason: "A rule about proposals doesn't answer a request to borrow a ladder." });
    await expect(checkRelevance({ post: "Can I borrow a ladder?", reply: "Proposals need a vote.", evidence: "needs a member proposal" }, offTopic))
      .resolves.toEqual({ relevant: false, reason: "A rule about proposals doesn't answer a request to borrow a ladder." });
    const broken = vi.fn().mockRejectedValue(new Error("timeout"));
    await expect(checkRelevance({ post: "p", reply: "r", evidence: "e" }, broken)).resolves.toMatchObject({ relevant: false });
  });
});
