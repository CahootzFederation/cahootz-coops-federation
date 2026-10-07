import { describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ commonsComment: { findMany: vi.fn() } }));
vi.mock("@repo/db", () => ({ db }));

const { sageReplyStyleInstructions, SAGE_REPLY_TEMPLATES, SAGE_CAN_OFFER } = await import("../services/sage-reply-templates.js");
const { createCommonsActionAgent, withThreadContext } = await import("../services/commons-action-agent.js");

describe("Sage reply templates", () => {
  it("offers the action-plan template as a suggestion, never a required format", () => {
    const text = sageReplyStyleInstructions();
    expect(text).toContain('Template "Action plan"');
    expect(text).toContain("Here's what we can do:");
    expect(text).toContain("They are suggestions: if no template matches, write a short direct reply");
    expect(text).toContain("Never force a post that doesn't match into a template");
  });

  it("only lets templates promise what Sage can do", () => {
    for (const template of SAGE_REPLY_TEMPLATES) {
      const offer = template.example.split("I can ")[1] ?? "";
      expect(offer === "" || SAGE_CAN_OFFER.some((action) => offer.startsWith(action.split(" ").slice(0, 2).join(" "))), template.key).toBe(true);
    }
  });

  it("is part of the Commons reply agent's instructions, with the follow-through rule", () => {
    const agent = createCommonsActionAgent() as unknown as { instructions: string };
    expect(agent.instructions).toContain('Template "Action plan"');
    expect(agent.instructions).toContain("follow through now");
    expect(agent.instructions).toContain("don't start a second round of questions");
  });
});

describe("thread context for comments", () => {
  it("includes the post and earlier comments, labeling Sage's own", async () => {
    db.commonsComment.findMany.mockResolvedValue([
      { content: "Reply with your delivery days. Once you've done that, I can draft a small proposal.", author: { name: "Sage", handle: "sage", isBot: true } },
      { content: "Has anyone pooled drivers before?", author: { name: "Maya", handle: "maya", isBot: false } },
    ]);
    const [comment] = await withThreadContext([{
      sourceType: "commons_comment", sourceId: "c3", sourcePostId: "p1", sourceAuthorId: "u1", createdAt: new Date(),
      title: "Shared drivers", content: "Mon/Wed/Fri, 40 stops, $600 a month.", context: "What's the best way to share delivery drivers?", coopId: "harbor",
    }]);
    expect(comment!.context).toBe([
      "Original post: Shared drivers: What's the best way to share delivery drivers?",
      "Earlier in the thread:",
      "Maya: Has anyone pooled drivers before?",
      "Sage: Reply with your delivery days. Once you've done that, I can draft a small proposal.",
    ].join("\n"));
    expect(db.commonsComment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ postId: "p1", id: { not: "c3" } }), take: 10 }));
  });
});

describe("rendering a chosen template", () => {
  it("builds the action plan from its parts, exactly", async () => {
    const { renderTemplatedReply } = await import("../services/sage-reply-templates.js");
    const rendered = renderTemplatedReply({
      draftText: "fallback",
      templateKey: "action-plan",
      templateLead: "Pooling drivers is exactly the kind of cost we should be sharing.",
      templateSteps: ["Post in the Commons asking who else runs deliveries.", "• Reply here with your delivery days and what you pay now."],
      templateOffer: "I can draft a small proposal so members can vote on it.",
    });
    expect(rendered).toEqual({
      templateKey: "action-plan",
      text: [
        "Pooling drivers is exactly the kind of cost we should be sharing. Here's what we can do:",
        "• Post in the Commons asking who else runs deliveries.",
        "• Reply here with your delivery days and what you pay now.",
        "",
        "Once you've done that, I can draft a small proposal so members can vote on it.",
      ].join("\n"),
    });
  });

  it("falls back to the plain draft when no template was chosen or the parts are incomplete", async () => {
    const { renderTemplatedReply } = await import("../services/sage-reply-templates.js");
    expect(renderTemplatedReply({ draftText: "Votes stay open 7 days.", templateKey: "", templateLead: "", templateSteps: [], templateOffer: "" }).text).toBe("Votes stay open 7 days.");
    expect(renderTemplatedReply({ draftText: "plain", templateKey: "action-plan", templateLead: "Lead.", templateSteps: [], templateOffer: "I can help." }).text).toBe("plain");
    expect(renderTemplatedReply({ draftText: "plain", templateKey: "no-such-template", templateLead: "Lead.", templateSteps: ["Do it."], templateOffer: "I can help." }).text).toBe("plain");
  });
});

describe("decision-moment templates", () => {
  it("are offered alongside the action plan, each with its own use", () => {
    const text = sageReplyStyleInstructions();
    for (const name of ["Where we are", "Trade-off", "Missing piece", "Before we decide"]) expect(text).toContain(`Template "${name}"`);
    expect(SAGE_REPLY_TEMPLATES.map((template) => template.key)).toEqual(["action-plan", "where-we-are", "trade-off", "missing-piece", "before-we-decide"]);
    expect(text).toContain("When members disagree with each other, don't pick a side");
    expect(text).toContain("Stay quiet when members are already answering each other well; a question or choice nobody has answered yet is not that");
  });

  it("renders a trade-off evenly, from its parts", async () => {
    const { renderTemplatedReply } = await import("../services/sage-reply-templates.js");
    expect(renderTemplatedReply({
      draftText: "fallback", templateKey: "trade-off", templateLead: "We're choosing between the library room and rotating homes.",
      templateSteps: ["Library: free, but it closes at 7.", "Homes: we can stay late, but the same two members host."],
      templateOffer: "How many of us need to leave before 7?",
    }).text).toBe([
      "We're choosing between the library room and rotating homes.",
      "• Library: free, but it closes at 7.",
      "• Homes: we can stay late, but the same two members host.",
      "",
      "How many of us need to leave before 7?",
    ].join("\n"));
  });

  it("starts a missing-piece close with \"Once we have that,\" exactly once", async () => {
    const { renderTemplatedReply } = await import("../services/sage-reply-templates.js");
    const parts = { draftText: "fallback", templateKey: "missing-piece", templateLead: "We can't compare the vans yet.", templateSteps: ["You: each monthly payment."] };
    expect(renderTemplatedReply({ ...parts, templateOffer: "I can summarize where we've landed." }).text.endsWith("Once we have that, I can summarize where we've landed.")).toBe(true);
    expect(renderTemplatedReply({ ...parts, templateOffer: "Once we have that, I can summarize where we've landed." }).text.endsWith("\nOnce we have that, I can summarize where we've landed.")).toBe(true);
  });
});

describe("follow-ups after a templated reply", () => {
  it("treats only an action plan's bullets as asks; a trade-off's options are not tasks", async () => {
    const { followUpExpectation } = await import("../services/sage-reply-templates.js");
    expect(followUpExpectation({ templateKey: "action-plan", templateSteps: ["Reply with your delivery days.", "Post in the Commons."] }))
      .toBe("Reply with your delivery days.; Post in the Commons.");
    expect(followUpExpectation({ templateKey: "trade-off", templateSteps: ["Library: free, closes at 7.", "Homes: later, same hosts."] })).toBe("");
    expect(followUpExpectation({ templateKey: "trade-off", templateSteps: ["Library: free."], followUpDays: 2, followUpExpect: "say how many need to leave by 7" }))
      .toBe("say how many need to leave by 7");
    expect(followUpExpectation({ templateKey: "", templateSteps: [], followUpDays: 0, followUpExpect: "" })).toBe("");
  });
});
