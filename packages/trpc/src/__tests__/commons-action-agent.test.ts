import { describe, expect, it } from "vitest";
import type { CoopConfig } from "@repo/db";
import { AUTO_REPLY_MIN_CONFIDENCE, COMMONS_ACTION_MODEL, charterSnapshotKey, createCommonsActionAgent, hasExactGrounding, mayAutoReply, resourceCandidate } from "../services/commons-action-agent.js";
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
