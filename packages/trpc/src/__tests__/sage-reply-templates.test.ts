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
