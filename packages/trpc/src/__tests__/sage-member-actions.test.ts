import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  userCoopMembership: { findMany: vi.fn() },
  coopConfig: { findMany: vi.fn() },
  commonsAction: { count: vi.fn(), create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn() },
  commonsActionReview: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  commonsActionAudit: { create: vi.fn(), findFirst: vi.fn() },
  commonsComment: { findUnique: vi.fn() },
  commonsPost: { findUnique: vi.fn() },
  groupComment: { findFirst: vi.fn() },
  group: { findUnique: vi.fn() },
}));
const dispatch = vi.hoisted(() => ({ enqueueSageActionExecute: vi.fn() }));
const intros = vi.hoisted(() => ({ createIntroductionSuggestion: vi.fn(), askIntroductionHelper: vi.fn() }));
const dm = vi.hoisted(() => ({ sendDirectCircleMessage: vi.fn() }));

vi.mock("@repo/db", () => ({ db }));
vi.mock("../services/sage-dispatch.js", () => dispatch);
vi.mock("../services/sage-introductions.js", () => intros);
vi.mock("../services/direct-circles.js", () => dm);
vi.mock("../lib/bot.js", () => ({ ensureSageBotUser: vi.fn().mockResolvedValue({ id: "sage", name: "Sage", email: "sage@x" }) }));

import {
  confirmationAnswer, handleConversationConfirmation, mentionsMember, proposeMemberPost, relayReplyToMember,
} from "../services/sage-member-actions.js";

const member = { id: "m1", name: "Jordan Rivers", email: "jrivers@example.com", handle: "jrivers" };

function memberOf(coops: Array<[string, string]>) {
  db.userCoopMembership.findMany.mockResolvedValue(coops.map(([coopId]) => ({ coopId })));
  db.coopConfig.findMany.mockResolvedValue(coops.map(([coopId, name]) => ({ coopId, name })));
}

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findUnique.mockResolvedValue(member);
  db.commonsAction.count.mockResolvedValue(0);
  db.commonsActionReview.findMany.mockResolvedValue([]);
  db.commonsAction.create.mockResolvedValue({ id: "a1" });
  memberOf([["market", "E2E Market Commons"]]);
});

describe("member confirmation", () => {
  it("only treats a short, plain answer as yes or no", () => {
    expect(confirmationAnswer("Yes!")).toBe("YES");
    expect(confirmationAnswer("  ok ")).toBe("YES");
    expect(confirmationAnswer("go ahead.")).toBe("YES");
    expect(confirmationAnswer("No thanks")).toBe("NO");
    expect(confirmationAnswer("yes but change the title")).toBeNull();
    expect(confirmationAnswer("I worked in fast food")).toBeNull();
  });
});

describe("anonymous posts", () => {
  it("detects the member's name, handle or email in a post", () => {
    expect(mentionsMember("A member is looking for weekly fast-food work", member)).toBe(false);
    expect(mentionsMember("Jordan is looking for work", member)).toBe(true);
    expect(mentionsMember("contact jrivers", member)).toBe(true);
    // A word that only contains a name fragment is fine.
    expect(mentionsMember("Riverside shifts wanted", member)).toBe(false);
  });

  it("proposes an anonymous post and returns the exact ask, without publishing", async () => {
    const result = await proposeMemberPost({
      memberId: "m1", conversationGroupId: "g1", coopId: "market", tag: "Ask",
      title: "Looking for weekly fast-food shifts", body: "A member with hospitality experience is looking for regular weekly fast-food work.",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ask).toContain("E2E Market Commons");
    expect(result.ask).toContain("without your name");
    expect(result.ask).toContain("Reply yes");
    const created = db.commonsAction.create.mock.calls[0]![0].data;
    expect(created).toMatchObject({ sourceType: "sage_member_post", type: "SUGGEST_ACTION", status: "PENDING", sourceAuthorId: "m1" });
    expect(created.payload).toMatchObject({ capability: "post_for_member", conversationGroupId: "g1" });
    expect(created.reviews.create).toMatchObject({ userId: "m1", reviewType: "APPROVE_SUGGESTION", status: "PENDING" });
    expect(dispatch.enqueueSageActionExecute).not.toHaveBeenCalled();
  });

  it("refuses posts that identify the member, include links, use another Commons, or exceed the daily limit", async () => {
    const base = { memberId: "m1", conversationGroupId: "g1", coopId: "market", tag: "Ask" as const, title: "Work wanted" };
    expect(await proposeMemberPost({ ...base, body: "Jordan Rivers is looking for weekly work." })).toMatchObject({ ok: false, reason: expect.stringMatching(/identify/) });
    expect(await proposeMemberPost({ ...base, body: "A member wants work, see https://example.com" })).toMatchObject({ ok: false });
    expect(await proposeMemberPost({ ...base, coopId: "elsewhere", body: "A member is looking for weekly work." })).toMatchObject({ ok: false, reason: expect.stringMatching(/isn't an active member/) });
    db.commonsAction.count.mockResolvedValue(1);
    expect(await proposeMemberPost({ ...base, body: "A member is looking for weekly work." })).toMatchObject({ ok: false, reason: expect.stringMatching(/last day/) });
    expect(db.commonsAction.create).not.toHaveBeenCalled();
  });
});

describe("answering Sage's ask in the conversation", () => {
  const review = {
    id: "r1", actionId: "a1", reviewType: "APPROVE_SUGGESTION", payloadHash: "h1", status: "PENDING",
    updatedAt: new Date("2026-10-13T10:00:00Z"), presentationData: { commonsName: "E2E Market Commons", conversationGroupId: "g1" },
  };
  const input = { conversationGroupId: "g1", memberId: "m1", sageId: "sage", now: new Date("2026-10-13T10:05:00Z") };

  beforeEach(() => {
    db.commonsActionReview.findFirst.mockResolvedValue(review);
    db.groupComment.findFirst.mockResolvedValue({ createdAt: new Date("2026-10-13T10:00:01Z") });
    db.commonsAction.findUnique.mockResolvedValue({ id: "a1", status: "PENDING", payloadHash: "h1", revision: 1 });
    db.commonsActionReview.updateMany.mockResolvedValue({ count: 1 });
  });

  it("a yes approves the post and queues it to publish, which announces itself", async () => {
    const result = await handleConversationConfirmation({ ...input, content: "yes" });
    expect(result?.reply).toBeUndefined();
    expect(db.commonsActionReview.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "APPROVED" }) }));
    expect(dispatch.enqueueSageActionExecute).not.toHaveBeenCalled();
    await result?.afterReply?.();
    expect(dispatch.enqueueSageActionExecute).toHaveBeenCalledWith("a1", 1);
  });

  it("a no dismisses it", async () => {
    const result = await handleConversationConfirmation({ ...input, content: "no" });
    expect(result?.reply).toBe("Okay, I won't post it.");
    expect(db.commonsAction.update).toHaveBeenCalledWith({ where: { id: "a1" }, data: { status: "DISMISSED" } });
    expect(dispatch.enqueueSageActionExecute).not.toHaveBeenCalled();
  });

  it("a yes to an introduction asks the other person next", async () => {
    db.commonsActionReview.findFirst.mockResolvedValue({ ...review, reviewType: "ACCEPT_INTRODUCTION" });
    const result = await handleConversationConfirmation({ ...input, content: "sure" });
    expect(result?.reply).toMatch(/asked them/);
    expect(intros.askIntroductionHelper).toHaveBeenCalledWith("a1");
  });

  it("ignores a yes when Sage's ask isn't its latest message, or the text changed", async () => {
    db.groupComment.findFirst.mockResolvedValue({ createdAt: new Date("2026-10-13T09:00:00Z") });
    expect(await handleConversationConfirmation({ ...input, content: "yes" })).toBeNull();
    db.groupComment.findFirst.mockResolvedValue({ createdAt: new Date("2026-10-13T10:00:01Z") });
    db.commonsAction.findUnique.mockResolvedValue({ id: "a1", status: "PENDING", payloadHash: "changed", revision: 2 });
    expect(await handleConversationConfirmation({ ...input, content: "yes" })).toBeNull();
    expect(dispatch.enqueueSageActionExecute).not.toHaveBeenCalled();
  });

  it("leaves anything other than a plain answer to the model", async () => {
    expect(await handleConversationConfirmation({ ...input, content: "Can you say evenings instead?" })).toBeNull();
    expect(db.commonsActionReview.findFirst).not.toHaveBeenCalled();
  });
});

describe("relaying replies to the member", () => {
  beforeEach(() => {
    db.commonsComment.findUnique.mockResolvedValue({ id: "c1", postId: "p1", content: "My restaurant is hiring weekend shifts", authorId: "helper", author: { isBot: false } });
    db.commonsPost.findUnique.mockResolvedValue({ id: "p1", coopId: "market", title: "Weekly fast-food work", classificationSignals: { source: "sage_member_post", actionId: "a1" } });
    db.commonsAction.findUnique.mockResolvedValue({ id: "a1", payload: { conversationGroupId: "g1" }, participants: [{ userId: "m1" }] });
    db.commonsActionAudit.findFirst.mockResolvedValue(null);
    db.group.findUnique.mockResolvedValue({ id: "g1", coopId: "cahootz", directKey: "k" });
    intros.createIntroductionSuggestion.mockResolvedValue({ created: true, actionId: "intro1" });
    db.commonsActionReview.findFirst.mockResolvedValue({ id: "r9", presentationData: {} });
  });

  it("quotes the reply to the member privately and offers the two-sided introduction", async () => {
    expect(await relayReplyToMember("c1")).toBe("RELAYED");
    expect(intros.createIntroductionSuggestion).toHaveBeenCalledWith(expect.objectContaining({ needUserId: "m1", helperUserId: "helper", coopId: "market" }));
    const sent = dm.sendDirectCircleMessage.mock.calls[0]![1];
    expect(sent.content).toContain("My restaurant is hiring weekend shifts");
    expect(sent.content).toContain("Nothing is shared until you both say yes");
    expect(db.commonsActionReview.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ presentationData: expect.objectContaining({ conversationGroupId: "g1" }) }),
    }));
  });

  it("skips the member's own comment, bots, repeat commenters and ordinary posts", async () => {
    db.commonsComment.findUnique.mockResolvedValueOnce({ id: "c2", postId: "p1", content: "thanks", authorId: "m1", author: { isBot: false } });
    expect(await relayReplyToMember("c2")).toBe("SKIPPED");
    db.commonsComment.findUnique.mockResolvedValueOnce({ id: "c3", postId: "p1", content: "hi", authorId: "sage", author: { isBot: true } });
    expect(await relayReplyToMember("c3")).toBe("SKIPPED");
    db.commonsActionAudit.findFirst.mockResolvedValueOnce({ id: "already" });
    expect(await relayReplyToMember("c1")).toBe("SKIPPED");
    db.commonsPost.findUnique.mockResolvedValueOnce({ id: "p1", coopId: "market", title: "x", classificationSignals: { source: "member" } });
    expect(await relayReplyToMember("c1")).toBe("SKIPPED");
    expect(dm.sendDirectCircleMessage).not.toHaveBeenCalled();
  });
});
