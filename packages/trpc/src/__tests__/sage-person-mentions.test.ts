import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  coopConfig: { findFirst: vi.fn() },
  sagePersonMention: { findMany: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
  commonsAction: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  commonsActionReview: { findFirst: vi.fn(), update: vi.fn() },
  commonsActionAudit: { create: vi.fn() },
  userCoopMembership: { findMany: vi.fn(), findUnique: vi.fn() },
  commonsInvitation: { findMany: vi.fn() },
  $transaction: vi.fn(),
}));
const push = vi.hoisted(() => vi.fn().mockResolvedValue({ id: "n1" }));
const createInvitation = vi.hoisted(() => vi.fn());
vi.mock("@repo/db", () => ({ db }));
vi.mock("../services/push-notification-service.js", () => ({ createNotificationAndPush: push }));
vi.mock("../services/commons-invitations.js", () => ({ createCommonsInvitation: createInvitation }));

const {
  personKey, mayBeMember, alreadyInvited, recordPersonMentions, maybeSuggestPersonInvite, invitePersonFromReview, purgePersonMentions,
  MENTION_THRESHOLD, PERSON_INVITE_REVIEW,
} = await import("../services/sage-person-mentions.js");

const NOW = new Date("2026-10-07T12:00:00.000Z");
const DAY = 86_400_000;

function mention(mentionedById: string, daysAgo: number, sourceId = `post-${mentionedById}-${daysAgo}`) {
  return { id: sourceId, coopId: "fam", nameKey: "denise", displayName: "Aunt Denise", relation: "aunt", mentionedById, sourceType: "commons_post", sourceId, createdAt: new Date(NOW.getTime() - daysAgo * DAY) };
}
function member(userId: string, name: string, roles = ["member"]) {
  return { userId, roles, status: "ACTIVE", user: { name, handle: name.toLowerCase(), isBot: false } };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.coopConfig.findFirst.mockResolvedValue({ joinPolicy: "INVITE_ONLY", name: "The Carters" });
  db.sagePersonMention.findMany.mockResolvedValue([mention("kim", 1), mention("kim", 4), mention("lee", 9)]);
  db.commonsAction.findFirst.mockResolvedValue(null);
  db.commonsAction.create.mockResolvedValue({ id: "action-1" });
  db.userCoopMembership.findMany.mockResolvedValue([member("kim", "Kim Carter"), member("lee", "Lee Carter", ["member", "steward"])]);
  db.commonsInvitation.findMany.mockResolvedValue([]);
  db.commonsActionReview.findFirst.mockResolvedValue(null);
  db.sagePersonMention.createMany.mockResolvedValue({ count: 1 });
});

describe("recognizing the same person", () => {
  it("keys a proper name without the relation, so different members' mentions add up", () => {
    expect(personKey({ name: "Aunt Denise", relation: "aunt" }, "kim")).toEqual({ nameKey: "denise", displayName: "Aunt Denise", relation: "aunt" });
    expect(personKey({ name: "my cousin Ray Johnson", relation: "" }, "kim")).toMatchObject({ nameKey: "ray johnson", displayName: "cousin Ray Johnson", relation: "cousin" });
  });

  it("keeps a bare relation per member, since one member's Grandma isn't another's", () => {
    expect(personKey({ name: "Grandma", relation: "grandmother" }, "kim")?.nameKey).toBe("rel:grandma:kim");
    expect(personKey({ name: "Grandma", relation: "grandmother" }, "lee")?.nameKey).toBe("rel:grandma:lee");
  });

  it("ignores handles, numbers, and vague words", () => {
    expect(personKey({ name: "@denise", relation: "" }, "kim")).toBeNull();
    expect(personKey({ name: "555-1234", relation: "" }, "kim")).toBeNull();
    expect(personKey({ name: "a friend", relation: "friend" }, "kim")).toBeNull();
  });

  it("treats a name that matches a member's name or handle as possibly already here", () => {
    expect(mayBeMember("denise", [{ name: "Denise Carter", handle: null }])).toBe(true);
    expect(mayBeMember("denise", [{ name: "Kim Carter", handle: "kimc" }])).toBe(false);
    expect(mayBeMember("rel:grandma:kim", [{ name: "Grandma", handle: null }])).toBe(false);
  });

  it("spots an existing invitation by the name it was addressed to", () => {
    expect(alreadyInvited("denise", "Aunt Denise", ["Auntie Denise"])).toBe(true);
    expect(alreadyInvited("ray johnson", "Ray Johnson", ["Ray"])).toBe(false);
    expect(alreadyInvited("rel:grandma:kim", "Grandma", ["grandma"])).toBe(true);
  });
});

describe("recording mentions", () => {
  it("stores up to three distinct people per item, idempotently", async () => {
    const keys = await recordPersonMentions({
      coopId: "fam", mentionedById: "kim", sourceType: "commons_post", sourceId: "p1",
      people: [{ name: "Aunt Denise", relation: "aunt" }, { name: "Denise", relation: "" }, { name: "Ray", relation: "cousin" }, { name: "Tia", relation: "" }, { name: "Bo", relation: "" }],
    });
    expect(keys).toEqual(["denise", "ray", "tia"]);
    expect(db.sagePersonMention.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
  });
});

describe("deciding whether to ask", () => {
  it(`asks the member who mentioned them most once they've come up ${MENTION_THRESHOLD} times`, async () => {
    const result = await maybeSuggestPersonInvite("fam", "denise", NOW);
    expect(result).toMatchObject({ created: true, askedUserId: "kim" });
    const data = db.commonsAction.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({ sourceType: "sage_person_invite", sourceId: "denise@2026-10-07", type: "SUGGEST_ACTION", sourceAuthorId: "kim" });
    expect(data.reviews.create).toMatchObject({ userId: "kim", reviewType: PERSON_INVITE_REVIEW, presentationData: { name: "Aunt Denise", direct: false } });
    expect(data.reviews.create.presentationData.body).toContain("a steward can send the invitation");
    expect(push).toHaveBeenCalledWith(db, expect.objectContaining({ userId: "kim", type: "SAGE_SUGGESTION_NEEDS_YOU", data: { actionId: "action-1" } }));
  });

  it("tells a steward the invitation goes out right away", async () => {
    db.sagePersonMention.findMany.mockResolvedValue([mention("lee", 1), mention("lee", 2), mention("kim", 3)]);
    await maybeSuggestPersonInvite("fam", "denise", NOW);
    expect(db.commonsAction.create.mock.calls[0]![0].data.reviews.create.presentationData).toMatchObject({ direct: true });
  });

  it("only works in families", async () => {
    db.coopConfig.findFirst.mockResolvedValue({ joinPolicy: "APPLICATION_REQUIRED", name: "Harbor" });
    expect(await maybeSuggestPersonInvite("harbor", "denise", NOW)).toMatchObject({ created: false, reason: "Only families get invite suggestions" });
    expect(db.commonsAction.create).not.toHaveBeenCalled();
  });

  it("waits until the threshold, counting only the last 30 days", async () => {
    db.sagePersonMention.findMany.mockResolvedValue([mention("kim", 1), mention("kim", 2)]);
    expect(await maybeSuggestPersonInvite("fam", "denise", NOW)).toMatchObject({ created: false });
    expect(db.sagePersonMention.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { coopId: "fam", nameKey: "denise", createdAt: { gte: new Date(NOW.getTime() - 30 * DAY) } },
    }));
  });

  it("doesn't ask again about the same person within 90 days, whatever the answer was", async () => {
    db.commonsAction.findFirst.mockResolvedValue({ id: "earlier" });
    expect(await maybeSuggestPersonInvite("fam", "denise", NOW)).toMatchObject({ created: false, actionId: "earlier" });
    expect(db.commonsAction.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ sourceId: { startsWith: "denise@" }, createdAt: { gte: new Date(NOW.getTime() - 90 * DAY) } }),
    }));
  });

  it("skips someone who may already be a member or already has an invitation", async () => {
    db.userCoopMembership.findMany.mockResolvedValueOnce([member("kim", "Kim Carter"), member("d", "Denise Carter")]);
    expect(await maybeSuggestPersonInvite("fam", "denise", NOW)).toMatchObject({ created: false, reason: expect.stringContaining("member") });
    db.commonsInvitation.findMany.mockResolvedValueOnce([{ recipientName: "Aunt Denise" }]);
    expect(await maybeSuggestPersonInvite("fam", "denise", NOW)).toMatchObject({ created: false, reason: expect.stringContaining("already invited") });
    expect(db.commonsAction.create).not.toHaveBeenCalled();
  });

  it("asks the next member when the top one already has an open ask or was asked this week", async () => {
    db.commonsActionReview.findFirst.mockResolvedValueOnce({ id: "busy" }).mockResolvedValueOnce(null);
    expect(await maybeSuggestPersonInvite("fam", "denise", NOW)).toMatchObject({ created: true, askedUserId: "lee" });
  });

  it("never asks someone who left", async () => {
    db.userCoopMembership.findMany.mockResolvedValue([member("other", "Pat Smith")]);
    expect(await maybeSuggestPersonInvite("fam", "denise", NOW)).toMatchObject({ created: false });
  });
});

describe("saying yes", () => {
  const action = { id: "action-1", coopId: "fam", payload: { name: "Aunt Denise", mentions: 4 } };
  const user = { id: "kim", email: "kim@example.com", name: "Kim", handle: "kim", phone: null };

  beforeEach(() => {
    db.userCoopMembership.findUnique.mockResolvedValue({ id: "m", status: "ACTIVE", roles: ["member"] });
    db.$transaction.mockResolvedValue([]);
    createInvitation.mockResolvedValue({ invitationId: "inv-1", status: "PENDING_APPROVAL", alreadyInvited: false, channels: [] });
  });

  it("creates a normal invitation with a note for the stewards, then records the outcome", async () => {
    const result = await invitePersonFromReview(db as never, { action, review: { id: "r1" }, user, input: { name: "Denise Carter", phone: "(555) 010-2000", email: "" } });
    expect(createInvitation).toHaveBeenCalledWith(db, {
      coopId: "fam", inviter: user, email: undefined, phone: "(555) 010-2000", recipientName: "Denise Carter",
      stewardNote: "Sage noticed Denise Carter came up 4 times in the family feed.",
    });
    expect(result).toEqual({ invitationStatus: "PENDING_APPROVAL", alreadyInvited: false, sentDirectly: false });
    expect(db.commonsActionAudit.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      eventType: "ACTION_EXECUTED", metadata: expect.objectContaining({ kind: "person_invite", resultEntityId: "inv-1" }),
    }) });
  });

  it("leaves the question open when the details are wrong", async () => {
    await expect(invitePersonFromReview(db as never, { action, review: { id: "r1" }, user, input: { name: "" } })).rejects.toThrow("Add their name.");
    createInvitation.mockRejectedValueOnce(new Error("Enter a valid phone number."));
    await expect(invitePersonFromReview(db as never, { action, review: { id: "r1" }, user, input: { name: "Denise", phone: "x" } })).rejects.toThrow("valid phone");
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe("retention", () => {
  it("purges mentions older than 60 days", async () => {
    await purgePersonMentions("fam", NOW);
    expect(db.sagePersonMention.deleteMany).toHaveBeenCalledWith({ where: { coopId: "fam", createdAt: { lt: new Date(NOW.getTime() - 60 * DAY) } } });
  });
});
