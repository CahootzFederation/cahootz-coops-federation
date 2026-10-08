import { describe, expect, it } from "vitest";
import type { CoopConfig } from "@repo/db";
import { AUTO_REPLY_MIN_CONFIDENCE, COMMONS_ACTION_MODEL, FOLLOW_THROUGH_ITEM_RULE, answersSageAsk, asksAgain, charterOnlyEvidenceRule, commonsActionPrompt, followThroughDraft, charterSnapshotKey, createCommonsActionAgent, hasExactGrounding, mayAutoReply, resourceCandidate } from "../services/commons-action-agent.js";
import { CHARTER_ONLY_ACTIONS } from "../services/sage-grounding.js";
import { SAGE_FOLLOW_THROUGH_RULE } from "../services/sage-reply-templates.js";
import { estimateAICost } from "../services/ai-cost.js";
import { isPlaceholderCharter, starterCharter } from "../services/starter-charter.js";

const config = {
  id: "config-1", version: 1, coopId: "harbor", charterText: "Members share tools and maintain a community workshop.",
  missionGoals: [{ label: "Share tools", description: "Make equipment available to members" }],
} as unknown as CoopConfig;
const item = {
  sourceType: "commons_post" as const, sourceId: "post-1", sourcePostId: "post-1", sourceAuthorId: "user-1",
  createdAt: new Date("2026-09-19T10:00:00.000Z"), title: "Tools", content: "I can share a drill.", context: "", coopId: "harbor",
};
const reply = {
  type: "RESPOND_RESOURCE_FOLLOWUP" as const, summary: "Ask about the drill", evidence: "Members share tools",
  confidence: 0.9, draftText: "Thanks. Is the drill available to borrow?", resourceKind: "" as const, resourceTitle: "", targetHandle: "",
};

describe("Commons action safeguards", () => {
  it("requires a real charter or goal excerpt", () => {
    expect(hasExactGrounding("Members share tools", config)).toBe(true);
    expect(hasExactGrounding("Make equipment available", config)).toBe(true);
    expect(hasExactGrounding("Members must pay a $50 fee", config)).toBe(false);
    expect(hasExactGrounding("tools", config)).toBe(false);
  });

  // A follow-through proposal built from a member's details used to quote those details as evidence, and
  // the grounding check then discarded every draft. The prompt must name each charter-only action type.
  it("tells the model which actions must quote the charter, and where a member's details go", () => {
    const instructions = String(createCommonsActionAgent().instructions);
    expect(instructions).toContain(charterOnlyEvidenceRule());
    for (const type of CHARTER_ONLY_ACTIONS) expect(charterOnlyEvidenceRule()).toContain(type);
    expect(charterOnlyEvidenceRule()).toMatch(/details in draftText, never in evidence/);
    expect(SAGE_FOLLOW_THROUGH_RULE).toMatch(/evidence is still the charter or goal passage/);
    // An unanswered question gets help, and a proposal waits for the details it needs.
    expect(instructions).toMatch(/A question to the Commons, or a post asking the group to choose between options, with no answer yet, is useful/);
    expect(instructions).toMatch(/gives none of the details a proposal needs yet/);
    expect(instructions).toMatch(/Once a member shares details after Sage offered, draft it from what they gave/);
  });

  it("auto-replies only within 48 hours and avoids Sage loops", () => {
    const now = new Date("2026-09-21T09:59:59.000Z");
    expect(mayAutoReply(reply, item, config, true, now)).toBe(true);
    expect(mayAutoReply(reply, item, config, true, new Date("2026-09-21T10:00:00.000Z"))).toBe(true);
    expect(mayAutoReply(reply, item, config, false, now)).toBe(false);
    expect(mayAutoReply(reply, item, config, true, new Date("2026-09-21T10:00:01.000Z"))).toBe(false);
    expect(mayAutoReply(reply, { ...item, content: "[@sage] I can share a drill." }, config, true, now)).toBe(false);
    expect(mayAutoReply({ ...reply, evidence: "Invented rule" }, item, config, true, now)).toBe(false);
  });

  it("does not publish a grounded reply below the confidence gate", () => {
    const now = new Date("2026-09-20T10:00:00.000Z");
    expect(mayAutoReply({ ...reply, confidence: AUTO_REPLY_MIN_CONFIDENCE }, item, config, true, now)).toBe(true);
    expect(mayAutoReply({ ...reply, confidence: AUTO_REPLY_MIN_CONFIDENCE - 0.01 }, item, config, true, now)).toBe(false);
  });

  it("changes the scan key when the charter changes", () => {
    expect(charterSnapshotKey(config)).not.toBe(charterSnapshotKey({ ...config, charterText: "A revised purpose." }));
  });

  it("builds purpose-only starter charters for placeholders", () => {
    expect(isPlaceholderCharter("harbor Co-op Charter", "harbor")).toBe(true);
    expect(isPlaceholderCharter(config.charterText, "harbor")).toBe(false);
    const text = starterCharter("Harbor", [{ label: "Share tools" }], "Help members work together.");
    expect(text).toContain("Help members work together.");
    expect(text).toContain("Share tools");
    expect(text).toContain("does not establish voting, financial, membership, or disciplinary rules");
  });
});

describe("who Sage may invite to list an offer", () => {
  const cousin = "I'm a master arborist 17 years experiecne let me and my team work for you!";
  const offer = { resourceKind: "SERVICE" as const, targetHandle: "", selfOffer: true };

  it("invites the author of a self-offer the model flagged, whatever the wording", () => {
    expect(resourceCandidate(offer, { content: cousin })).toEqual({ type: "SELF" });
    expect(resourceCandidate({ ...offer, resourceKind: "SKILL" }, { content: "Licensed electrician here." })).toEqual({ type: "SELF" });
  });

  it("falls back to the wording when the model misses the flag", () => {
    expect(resourceCandidate({ ...offer, selfOffer: false }, { content: cousin })).toEqual({ type: "SELF" });
    expect(resourceCandidate({ ...offer, selfOffer: false }, { content: "Does anyone know a tree service?" })).toBeNull();
  });

  it("never invites anyone for a money offer", () => {
    expect(resourceCandidate({ ...offer, resourceKind: "FUNDING" }, { content: "I have $500 I can lend." })).toBeNull();
    expect(resourceCandidate({ ...offer, resourceKind: "" }, { content: cousin })).toBeNull();
  });

  it("invites someone else only by an exact @mention of a person", () => {
    const mentioned = "[@treeguy] does great work";
    expect(resourceCandidate({ resourceKind: "PERSON", targetHandle: "@treeguy", selfOffer: false }, { content: mentioned })).toEqual({ type: "MENTION", handle: "treeguy" });
    expect(resourceCandidate({ resourceKind: "PERSON", targetHandle: "otherguy", selfOffer: false }, { content: mentioned })).toBeNull();
    expect(resourceCandidate({ resourceKind: "SERVICE", targetHandle: "treeguy", selfOffer: true }, { content: mentioned })).toBeNull();
  });
});

// Sage's first replies to the same shared-drivers post in the CI runs where the follow-through journey
// failed. Only some offered a proposal, and every time the model asked again instead of drafting.
const SAGE_ASKS = [
  "Shared delivery drivers could help us keep this work inside the Commons. Here's what we can do:\n• Share your delivery days, rough weekly stops, and current costs.\n\nOnce you've done that, I can draft a concrete proposal for members to review.",
  "We can't assess shared drivers yet because the deliveries, workload, and costs are not specified.\n• You: share what each business pays now for delivery driving.\n\nOnce we have that, I can help compare the shared option with the current setup.",
  "Shared delivery could keep costs and work within the Commons. Here's what we can do:\n• Share what you currently pay and any timing requirements.\n\nOnce you've done that, I can summarize the options.",
  "Sharing drivers could keep this work and cost inside the Commons. What delivery days, routes, number of stops, current costs, and participating businesses should we compare?",
];
const DETAILS = "We deliver Mon/Wed/Fri, about 40 stops a week downtown, and pay a part-time driver $650 a month.";

describe("Sage follow-through", () => {
  it("treats a member's concrete details as the answer to Sage's ask, however Sage worded it", () => {
    for (const ask of SAGE_ASKS) expect(answersSageAsk(ask, DETAILS)).toBe(true);
    // No concrete details yet: Sage doesn't draft from "sounds good".
    expect(answersSageAsk(SAGE_ASKS[0], "Sounds good, I'll get back to you.")).toBe(false);
    // An ask about something other than a proposal or a cost isn't a proposal matter.
    expect(answersSageAsk("Book the community room by Thursday; it fills up on weekends.", "Booked it for Thursday at 6.")).toBe(false);
  });

  it("drafts from the post and the member's own words, without stating rules", () => {
    const draft = followThroughDraft({ postTitle: "Shared drivers", postContent: "Could we share delivery drivers?" }, DETAILS);
    expect(draft.title).toBe("Shared drivers");
    expect(draft.body).toContain("Could we share delivery drivers?");
    expect(draft.body).toContain(DETAILS);
    expect(draft.body).not.toMatch(/charter|vote|quorum/i);
  });

  it("holds a reply that asks the member again, but not a plain acknowledgment", () => {
    const base = { templateKey: "", templateSteps: [], followUpDays: 0, followUpExpect: "" };
    expect(asksAgain({ ...base, type: "CLARIFY_NEED" })).toBe(true);
    expect(asksAgain({ ...base, type: "ANSWER_QUESTION", followUpDays: 3, followUpExpect: "share the other shops' costs" })).toBe(true);
    expect(asksAgain({ ...base, type: "ANSWER_QUESTION", templateKey: "action-plan", templateSteps: ["Share your routes"] })).toBe(true);
    expect(asksAgain({ ...base, type: "RESPOND_RESOURCE_FOLLOWUP" })).toBe(false);
  });

  it("tells the model which items answer Sage's ask", () => {
    expect(String(createCommonsActionAgent().instructions)).toContain(FOLLOW_THROUGH_ITEM_RULE);
    const marked = { ...item, sourceType: "commons_comment" as const, followThrough: { sageReply: SAGE_ASKS[0], postTitle: "Tools", postContent: "" } };
    expect(JSON.parse(commonsActionPrompt(config, [marked, item])).items.map((entry: { answersSage?: boolean }) => entry.answersSage)).toEqual([true, undefined]);
  });
});

describe("AI cost estimates", () => {
  it("counts cached input at the cached rate and preserves unknown prices", () => {
    expect(estimateAICost("gpt-5-nano", { inputTokens: 1_000_000, cachedInputTokens: 500_000, outputTokens: 1_000_000 })).toBeCloseTo(0.4275);
    expect(estimateAICost("gpt-5.6-luna", { inputTokens: 1_000_000, cachedInputTokens: 500_000, outputTokens: 1_000_000 })).toBeCloseTo(1.31);
    expect(estimateAICost("unpriced-model", { inputTokens: 100, outputTokens: 100 })).toBeNull();
    expect(estimateAICost("gpt-5-nano", {})).toBeNull();
  });

  it("uses the configured Commons action model", () => {
    expect(COMMONS_ACTION_MODEL).toBe("gpt-5.6-luna");
    expect(createCommonsActionAgent().model).toBe(COMMONS_ACTION_MODEL);
  });
});
