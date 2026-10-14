import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  commonsAction: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  commonsActionParticipant: { findMany: vi.fn() },
  commonsActionReview: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
  commonsActionAudit: { create: vi.fn().mockResolvedValue({}) },
  userCoopMembership: { findMany: vi.fn(), findUnique: vi.fn() },
  coopConfig: { findMany: vi.fn() },
  user: { findUnique: vi.fn() },
  commonsPost: { create: vi.fn() },
  groupComment: { findFirst: vi.fn() },
}));
const proactive = vi.hoisted(() => ({
  sageConversation: vi.fn(async (userId: string) => ({ sage: { id: "sage" }, group: { id: `dm-${userId}` } })),
  sendProactiveSageMessage: vi.fn().mockResolvedValue({ status: "SENT", groupId: "g" }),
}));
const dispatch = vi.hoisted(() => ({ enqueueSageActionExecute: vi.fn() }));
const tasks = vi.hoisted(() => ({ createSageTask: vi.fn().mockResolvedValue({ created: true, taskId: "t" }) }));
const memory = vi.hoisted(() => ({ recordObservation: vi.fn().mockResolvedValue({}) }));

vi.mock("@repo/db", () => ({ db }));
vi.mock("../lib/bot.js", () => ({ ensureSageBotUser: vi.fn().mockResolvedValue({ id: "sage" }) }));
vi.mock("../services/sage-proactive.js", () => proactive);
vi.mock("../services/sage-dispatch.js", () => dispatch);
vi.mock("../services/sage-tasks.js", () => tasks);
vi.mock("../services/ai-memory.js", () => memory);
vi.mock("../services/push-notification-service.js", () => ({ createNotificationAndPush: vi.fn().mockResolvedValue({}) }));
vi.mock("../services/sage-introductions.js", () => ({ createIntroductionSuggestion: vi.fn(), askIntroductionHelper: vi.fn() }));

import { executeSageAction } from "../services/commons-action-tools.js";
import { askWhetherIntroductionHelped, handleConversationConfirmation } from "../services/sage-member-actions.js";

const intro = {
  id: "intro1", coopId: "harbor", status: "APPROVED", payload: { needSummary: "a ride to the clinic" },
  participants: [{ userId: "needer", role: "SUBJECT" }, { userId: "helper", role: "HELPER" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  db.userCoopMembership.findMany.mockResolvedValue([{ coopId: "harbor" }]);
  db.coopConfig.findMany.mockResolvedValue([{ coopId: "harbor", name: "Harbor Commons" }]);
  db.commonsActionReview.findMany.mockResolvedValue([]);
  db.commonsActionReview.findFirst.mockResolvedValue(null);
  db.commonsAction.upsert.mockResolvedValue({ id: "ask1", status: "PENDING" });
});

describe("did the introduction help?", () => {
  it("asks the person who needed help, through the outreach limit", async () => {
    db.commonsAction.findUnique.mockResolvedValue(intro);
    expect(await askWhetherIntroductionHelped("intro1", "needer")).toBe("SENT");
    expect(db.commonsAction.upsert.mock.calls[0]![0].create).toMatchObject({ sourceType: "sage_conversation_ask", sourceId: "intro1", sourceAuthorId: "needer" });
    expect(db.commonsActionReview.create.mock.calls[0]![0].data).toMatchObject({ userId: "needer", reviewType: "APPROVE_SUGGESTION", status: "PENDING" });
    expect(db.commonsActionReview.create.mock.calls[0]![0].data.presentationData).toMatchObject({ capability: "thank_helper", conversationGroupId: "dm-needer" });
    const sent = proactive.sendProactiveSageMessage.mock.calls[0]![0];
    expect(sent).toMatchObject({ userId: "needer", kind: "thanks-ask", key: "intro1" });
    expect(sent.content).toBe("Did connecting with the member I introduced you to help with a ride to the clinic? Reply yes or no.");
  });

  it("waits when the member is at the weekly limit, and skips introductions that didn't happen", async () => {
    db.commonsAction.findUnique.mockResolvedValue(intro);
    proactive.sendProactiveSageMessage.mockResolvedValueOnce({ status: "LIMITED" });
    expect(await askWhetherIntroductionHelped("intro1", "needer")).toBe("LIMITED");
    db.commonsAction.findUnique.mockResolvedValue({ ...intro, status: "DISMISSED" });
    expect(await askWhetherIntroductionHelped("intro1", "needer")).toBe("SKIPPED");
  });

  it("doesn't ask again once they answered", async () => {
    db.commonsAction.findUnique.mockResolvedValue(intro);
    db.commonsActionReview.findFirst.mockResolvedValueOnce({ id: "answered" });
    expect(await askWhetherIntroductionHelped("intro1", "needer")).toBe("SKIPPED");
    expect(proactive.sendProactiveSageMessage).not.toHaveBeenCalled();
  });
});

describe("answering in the conversation", () => {
  const review = {
    id: "r1", actionId: "ask1", reviewType: "APPROVE_SUGGESTION", payloadHash: "h", updatedAt: new Date("2026-10-13T10:00:00Z"),
    presentationData: { conversationGroupId: "dm-needer" },
  };
  beforeEach(() => {
    db.commonsActionReview.findFirst.mockResolvedValue(review);
    db.groupComment.findFirst.mockResolvedValue({ createdAt: new Date("2026-10-13T10:00:01Z") });
    db.commonsActionReview.updateMany.mockResolvedValue({ count: 1 });
  });
  const input = { conversationGroupId: "dm-needer", memberId: "needer", sageId: "sage", now: new Date("2026-10-13T11:00:00Z") };

  it("yes to 'did it help' thanks them and runs the thank-you", async () => {
    db.commonsAction.findUnique.mockResolvedValue({ id: "ask1", status: "PENDING", payloadHash: "h", revision: 1, payload: { capability: "thank_helper", introActionId: "intro1" } });
    const result = await handleConversationConfirmation({ ...input, content: "yes" });
    expect(result?.reply).toBe("Thank you for telling me. I'll pass on your thanks.");
    await result?.afterReply?.();
    expect(dispatch.enqueueSageActionExecute).toHaveBeenCalledWith("ask1", 1);
  });

  it("no records that it didn't help and messages nobody", async () => {
    db.commonsAction.findUnique.mockResolvedValue({ id: "ask1", status: "PENDING", payloadHash: "h", revision: 1, payload: { capability: "thank_helper", introActionId: "intro1" } });
    const result = await handleConversationConfirmation({ ...input, content: "no" });
    expect(result?.reply).toBe("Thanks for letting me know.");
    expect(db.commonsActionAudit.create.mock.calls.map(([arg]) => arg.data.eventType)).toContain("HELP_NOT_CONFIRMED");
    expect(dispatch.enqueueSageActionExecute).not.toHaveBeenCalled();
  });
});

describe("thanking and sharing", () => {
  function approved(action: object, participants: object[]) {
    db.commonsAction.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => (where.id === "intro1" ? intro : action));
    db.commonsActionParticipant.findMany.mockResolvedValue(participants);
    db.commonsActionReview.findFirst.mockResolvedValue({ id: "r", status: "APPROVED", payloadHash: "h" });
  }

  it("thank_helper records the outcome, then thanks the helper and asks to share", async () => {
    approved({ id: "ask1", coopId: "harbor", type: "SUGGEST_ACTION", status: "PENDING", payloadHash: "h", summary: "s", payload: { capability: "thank_helper", introActionId: "intro1" } },
      [{ userId: "needer", role: "SUBJECT" }]);
    db.commonsActionReview.findFirst.mockResolvedValueOnce({ id: "r", status: "APPROVED", payloadHash: "h" }).mockResolvedValue(null);
    db.commonsAction.upsert.mockResolvedValue({ id: "share1", status: "PENDING" });
    await executeSageAction("ask1");
    expect(db.commonsActionAudit.create.mock.calls.map(([arg]) => arg.data.eventType)).toContain("HELP_CONFIRMED");
    expect(memory.recordObservation.mock.calls[0]![0]).toMatchObject({ type: "member_help_outcome", scopeType: "commons", scopeId: "harbor" });
    const sent = proactive.sendProactiveSageMessage.mock.calls[0]![0];
    expect(sent).toMatchObject({ userId: "helper", kind: "thanks", key: "intro1" });
    expect(sent.content).toContain("Can I share a short shout-out in Harbor Commons naming you? They stay anonymous.");
  });

  it("share_win posts a Win naming only the helper", async () => {
    approved({ id: "share1", coopId: "harbor", type: "SUGGEST_ACTION", status: "PENDING", payloadHash: "h", summary: "s", payload: { capability: "share_win", introActionId: "intro1" } },
      [{ userId: "helper", role: "SUBJECT" }]);
    db.userCoopMembership.findUnique.mockResolvedValue({ status: "ACTIVE" });
    db.user.findUnique.mockResolvedValue({ name: "Pat Lee", handle: "pat" });
    db.commonsPost.create.mockResolvedValue({ id: "post1" });
    await executeSageAction("share1");
    const post = db.commonsPost.create.mock.calls[0]![0].data;
    expect(post).toMatchObject({ coopId: "harbor", authorId: "sage", tag: "Win", title: "Thank you, Pat Lee" });
    expect(post.content).toBe("Shout-out to Pat Lee for showing up for another member through Sage. This is what the Commons is for.");
    expect(post.content).not.toContain("clinic");
  });

  it("asks whether it helped five days after both people accept a Sage introduction, and only then", async () => {
    const { scheduleIntroductionOutcome } = await import("../services/commons-action-tools.js");
    const participants = [{ userId: "needer", role: "SUBJECT" }, { userId: "helper", role: "HELPER" }];
    await scheduleIntroductionOutcome({ id: "intro1", coopId: "harbor", type: "CONNECT_MEMBERS", sourceType: "sage_introduction" }, participants);
    expect(tasks.createSageTask.mock.calls[0]![0]).toMatchObject({ ownerUserId: "needer", subjectType: "introduction_outcome", subjectId: "intro1", dueInDays: 5 });
    expect(await scheduleIntroductionOutcome({ id: "s1", coopId: "harbor", type: "SUGGEST_ACTION", sourceType: "circle_trend" }, participants)).toBeNull();
    expect(tasks.createSageTask).toHaveBeenCalledTimes(1);
  });
});
