import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  commonsAction: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  commonsActionAudit: { create: vi.fn() },
  commonsPost: { create: vi.fn(), findUnique: vi.fn() },
}));
vi.mock("@repo/db", () => ({ db }));
vi.mock("../lib/bot.js", () => ({ ensureSageBotUser: vi.fn().mockResolvedValue({ id: "sage-bot" }) }));

const {
  askCommonsAboutHypothesis, communityQuestionText, countQuestionResponders, pickCommunityQuestion,
  COMMUNITY_QUESTION_COMMONS_COOLDOWN_DAYS, COMMUNITY_QUESTION_THEME_COOLDOWN_DAYS,
} = await import("../services/sage-community-question.js");
const { checkSageOutput } = await import("../services/untrusted-input.js");

const NOW = new Date("2026-10-14T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);
const hypothesis = (id: string, themeKey: string, confidence: number) => ({ id, themeKey, confidence, goalLabels: [] as string[] });
const THEMES = ["transportation_access", "food_access", "housing_stability", "belonging_connection", "time_and_workload", "safety_access", "shared_resources", "skills_and_help"];

beforeEach(() => {
  vi.clearAllMocks();
  db.commonsAction.findMany.mockResolvedValue([]);
  db.commonsAction.create.mockResolvedValue({ id: "action-1" });
  db.commonsAction.update.mockResolvedValue({});
  db.commonsActionAudit.create.mockResolvedValue({});
  db.commonsPost.create.mockResolvedValue({ id: "post-1" });
});

describe("the question's text", () => {
  it("asks what the group could do together, with no counts, quotes or hint of private check-ins", () => {
    for (const theme of THEMES) {
      const text = communityQuestionText(theme)!;
      expect(text, theme).not.toBeNull();
      const all = `${text.title}\n${text.body}`;
      expect(checkSageOutput(all).ok, theme).toBe(true);
      expect(all, theme).not.toMatch(/\d/);
      expect(all.toLowerCase(), theme).not.toMatch(/check-?in|told me|private|members (said|reported|mentioned)|struggl/);
    }
    expect(communityQuestionText("unknown_theme")).toBeNull();
  });

  it("names the matching mission goal, and drops it if it fails the output check", () => {
    expect(communityQuestionText("transportation_access", ["Transportation access"])!.body).toContain("This connects to our goal: Transportation access.");
    expect(communityQuestionText("transportation_access", ["see https://example.com"])!.body).not.toContain("goal");
  });
});

describe("which hypothesis Sage asks about", () => {
  const hypotheses = [hypothesis("h-food", "food_access", 0.6), hypothesis("h-ride", "transportation_access", 0.8), hypothesis("h-x", "unknown_theme", 0.95)];

  it("picks the most confident theme that has a question", () => {
    expect(pickCommunityQuestion(hypotheses, [], NOW)?.id).toBe("h-ride");
  });

  it("asks a Commons at most once per cooldown, and a theme at most once in 90 days", () => {
    expect(pickCommunityQuestion(hypotheses, [{ themeKey: "food_access", createdAt: daysAgo(COMMUNITY_QUESTION_COMMONS_COOLDOWN_DAYS - 1) }], NOW)).toBeNull();
    expect(pickCommunityQuestion(hypotheses, [{ themeKey: "transportation_access", createdAt: daysAgo(30) }], NOW)?.id).toBe("h-food");
    expect(pickCommunityQuestion(hypotheses, [{ themeKey: "transportation_access", createdAt: daysAgo(COMMUNITY_QUESTION_THEME_COOLDOWN_DAYS + 1) }], NOW)?.id).toBe("h-ride");
  });
});

describe("posting the question", () => {
  it("records an ASK_COMMONS action linked to the hypothesis, then posts from Sage in the Commons feed", async () => {
    const result = await askCommonsAboutHypothesis("harbor", [hypothesis("h-ride", "transportation_access", 0.8)], NOW);
    expect(result).toEqual({ asked: true, actionId: "action-1", postId: "post-1" });
    expect(db.commonsAction.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      coopId: "harbor", type: "ASK_COMMONS", sourceType: "community_question", sourceId: "h-ride", originObservationId: "h-ride",
      payload: expect.objectContaining({ themeKey: "transportation_access" }),
    }) }));
    expect(db.commonsPost.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      coopId: "harbor", circleId: "general:harbor", authorId: "sage-bot", classification: "sage_community_question",
    }) }));
    expect(db.commonsAction.update).toHaveBeenCalledWith({ where: { id: "action-1" }, data: { status: "PUBLISHED", sourcePostId: "post-1" } });
    expect(db.commonsActionAudit.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ eventType: "QUESTION_POSTED" }) }));
  });

  it("does nothing when the Commons was asked recently or the hypothesis was already asked about", async () => {
    db.commonsAction.findMany.mockResolvedValueOnce([{ createdAt: daysAgo(3), payload: { themeKey: "food_access" } }]);
    expect(await askCommonsAboutHypothesis("harbor", [hypothesis("h-ride", "transportation_access", 0.8)], NOW)).toMatchObject({ asked: false });
    expect(db.commonsAction.create).not.toHaveBeenCalled();

    db.commonsAction.create.mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002" }));
    expect(await askCommonsAboutHypothesis("harbor", [hypothesis("h-ride", "transportation_access", 0.8)], NOW)).toEqual({ asked: false, reason: "Already asked about this pattern" });
    expect(db.commonsPost.create).not.toHaveBeenCalled();
  });

  it("marks the action failed if the post can't be created", async () => {
    db.commonsPost.create.mockRejectedValueOnce(new Error("db down"));
    await expect(askCommonsAboutHypothesis("harbor", [hypothesis("h-ride", "transportation_access", 0.8)], NOW)).rejects.toThrow("db down");
    expect(db.commonsAction.update).toHaveBeenCalledWith({ where: { id: "action-1" }, data: { status: "FAILED" } });
  });
});

describe("counting answers", () => {
  it("counts distinct members who replied, reacted or supported, and reports a removed post", async () => {
    db.commonsPost.findUnique.mockResolvedValueOnce({
      comments: [{ authorId: "a" }, { authorId: "a" }], reactions: [{ userId: "b" }, { userId: "a" }], supports: [{ userId: "c" }],
    });
    expect(await countQuestionResponders("post-1")).toBe(3);
    db.commonsPost.findUnique.mockResolvedValueOnce(null);
    expect(await countQuestionResponders("post-1")).toBeNull();
  });
});
