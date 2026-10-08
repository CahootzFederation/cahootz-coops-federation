import { beforeEach, describe, expect, it, vi } from "vitest";

const ingestDocument = vi.fn();
const createNotificationAndPush = vi.fn();
vi.mock("../services/knowledge-base.js", () => ({ ingestDocument: (...args: unknown[]) => ingestDocument(...args) }));
vi.mock("../services/push-notification-service.js", () => ({ createNotificationAndPush: (...args: unknown[]) => createNotificationAndPush(...args) }));

const { commonsActionsRouter } = await import("../routers/commons-actions.js");

const invited = {
  id: "resource-1", coopId: "family-robinson", actionId: "action-1", kind: "SERVICE", title: "Tree care and removal",
  description: "Master arborist with 17 years of experience and a crew.", sourceType: "commons_post", sourceId: "post-1",
  candidateUserId: "member-1", status: "INVITED",
};

function caller(options: {
  resource?: Record<string, unknown> | null; updateCount?: number; autoList?: boolean | null;
  membership?: { status: string; roles: string[] } | null; userId?: string;
} = {}) {
  const userId = options.userId ?? "member-1";
  const membership = options.membership === undefined ? { status: "ACTIVE", roles: ["member"] } : options.membership;
  const db = {
    session: { findUnique: vi.fn().mockResolvedValue({ id: "session-1", userId, isRevoked: false, expiresAt: new Date(Date.now() + 60_000) }), update: vi.fn().mockResolvedValue({}) },
    user: { findUnique: vi.fn().mockResolvedValue({ id: userId, email: "member@example.com", status: "ACTIVE", deletedAt: null }) },
    userCoopMembership: {
      findUnique: vi.fn().mockResolvedValue(membership ? { id: "m-1", ...membership } : null),
      findMany: vi.fn().mockResolvedValue([{ userId: "steward-1" }]),
    },
    commonsResource: {
      findFirst: vi.fn().mockImplementation(({ where }) => Promise.resolve(where.status === "PUBLISHED" ? null : options.resource === undefined ? invited : options.resource)),
      updateMany: vi.fn().mockResolvedValue({ count: options.updateCount ?? 1 }),
      update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...invited, ...data })),
    },
    commonsAgentSetting: {
      findUnique: vi.fn().mockResolvedValue(options.autoList === null || options.autoList === undefined ? null : { autoListResources: options.autoList }),
      upsert: vi.fn().mockResolvedValue({}),
    },
    commonsAction: { findUnique: vi.fn().mockResolvedValue({ sourceAuthorId: "member-1" }), update: vi.fn().mockResolvedValue({}) },
  };
  const api = commonsActionsRouter.createCaller({ db, req: { headers: { "x-session-token": "token" } } } as never);
  return { api, db };
}

beforeEach(() => {
  ingestDocument.mockReset().mockResolvedValue({ document: { id: "doc-1" } });
  createNotificationAndPush.mockReset().mockResolvedValue({});
});

describe("resource invitation ownership", () => {
  it("accepts only a pending invitation addressed to the signed-in member", async () => {
    const { api, db } = caller();
    await expect(api.respondToResourceInvitation({ resourceId: "resource-1", accept: true })).resolves.toMatchObject({ accepted: true });
    expect(db.commonsResource.findFirst).toHaveBeenCalledWith({ where: { id: "resource-1", candidateUserId: "member-1", status: "INVITED" } });
    expect(db.commonsResource.updateMany).toHaveBeenCalledWith({
      where: { id: "resource-1", candidateUserId: "member-1", status: "INVITED" },
      data: { status: "ACCEPTED", respondedAt: expect.any(Date) },
    });
  });

  it("rejects an invitation that is not pending for the member", async () => {
    const { api } = caller({ resource: null });
    await expect(api.respondToResourceInvitation({ resourceId: "someone-elses", accept: false })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("records a decline for the invited member without listing anything", async () => {
    const { api, db } = caller();
    await expect(api.respondToResourceInvitation({ resourceId: "resource-1", accept: false })).resolves.toEqual({ accepted: false, listed: false });
    expect(db.commonsResource.updateMany).toHaveBeenCalledWith({
      where: { id: "resource-1", candidateUserId: "member-1", status: "INVITED" },
      data: { status: "DECLINED", respondedAt: expect.any(Date) },
    });
    expect(db.commonsResource.update).not.toHaveBeenCalled();
  });

  it("won't list an offer for someone who has left the commons", async () => {
    const { api, db } = caller({ membership: { status: "REMOVED", roles: [] } });
    await expect(api.respondToResourceInvitation({ resourceId: "resource-1", accept: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.commonsResource.updateMany).not.toHaveBeenCalled();
  });
});

describe("listing an accepted offer", () => {
  it("lists it right away by default", async () => {
    const { api, db } = caller({ autoList: null });
    await expect(api.respondToResourceInvitation({ resourceId: "resource-1", accept: true })).resolves.toEqual({ accepted: true, listed: true });
    expect(db.commonsResource.update).toHaveBeenCalledWith({ where: { id: "resource-1" }, data: expect.objectContaining({
      status: "PUBLISHED", verifiedBy: "auto-list:member-1", knowledgeDocId: "doc-1" }) });
    expect(createNotificationAndPush).not.toHaveBeenCalled();
  });

  it("still lists it when the knowledge-base copy fails", async () => {
    ingestDocument.mockRejectedValue(new Error("embeddings down"));
    const { api, db } = caller();
    await expect(api.respondToResourceInvitation({ resourceId: "resource-1", accept: true })).resolves.toEqual({ accepted: true, listed: true });
    expect(db.commonsResource.update).toHaveBeenCalledWith({ where: { id: "resource-1" }, data: expect.objectContaining({ status: "PUBLISHED", knowledgeDocId: null }) });
  });

  it("sends it to the stewards when they turned auto-listing off", async () => {
    const { api, db } = caller({ autoList: false });
    await expect(api.respondToResourceInvitation({ resourceId: "resource-1", accept: true })).resolves.toEqual({ accepted: true, listed: false });
    expect(db.commonsResource.update).not.toHaveBeenCalled();
    expect(createNotificationAndPush).toHaveBeenCalledWith(db, expect.objectContaining({
      userId: "steward-1", coopId: "family-robinson", type: "RESOURCE_REVIEW", data: expect.objectContaining({ resourceId: "resource-1" }) }));
  });
});

describe("steward listing controls", () => {
  const steward = { status: "ACTIVE", roles: ["member", "steward"] };

  it("tells members the rule and whether they can change it", async () => {
    await expect(caller({ autoList: false }).api.resourceSettings({ coopId: "family-robinson" })).resolves.toEqual({ autoListResources: false, isSteward: false });
    await expect(caller({ membership: steward }).api.resourceSettings({ coopId: "family-robinson" })).resolves.toEqual({ autoListResources: true, isSteward: true });
  });

  it("lets only stewards turn auto-listing off", async () => {
    await expect(caller().api.setResourceAutoList({ coopId: "family-robinson", enabled: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const { api, db } = caller({ membership: steward, userId: "steward-1" });
    await expect(api.setResourceAutoList({ coopId: "family-robinson", enabled: false })).resolves.toEqual({ autoListResources: false });
    expect(db.commonsAgentSetting.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { autoListResources: false, updatedBy: "steward-1" } }));
  });

  it("lets only stewards approve or turn down a waiting offer", async () => {
    const waiting = { ...invited, status: "ACCEPTED" };
    await expect(caller({ resource: waiting }).api.reviewResource({ resourceId: "resource-1", publish: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller({ resource: waiting }).api.resourcesAwaitingReview({ coopId: "family-robinson" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const approve = caller({ resource: waiting, membership: steward, userId: "steward-1" });
    await expect(approve.api.reviewResource({ resourceId: "resource-1", publish: true })).resolves.toEqual({ listed: true });
    expect(approve.db.commonsResource.update).toHaveBeenCalledWith({ where: { id: "resource-1" }, data: expect.objectContaining({ status: "PUBLISHED", verifiedBy: "steward:steward-1" }) });

    const decline = caller({ resource: waiting, membership: steward, userId: "steward-1" });
    await expect(decline.api.reviewResource({ resourceId: "resource-1", publish: false })).resolves.toEqual({ listed: false });
    expect(decline.db.commonsResource.update).toHaveBeenCalledWith({ where: { id: "resource-1" }, data: expect.objectContaining({ status: "NOT_LISTED" }) });
  });
});
