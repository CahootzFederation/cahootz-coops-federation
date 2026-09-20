import { describe, expect, it, vi } from "vitest";
import { commonsActionsRouter } from "../routers/commons-actions.js";

function caller(updateCount: number, userId = "member-1") {
  const db = {
    session: { findUnique: vi.fn().mockResolvedValue({ id: "session-1", userId, isRevoked: false, expiresAt: new Date(Date.now() + 60_000) }), update: vi.fn().mockResolvedValue({}) },
    user: { findUnique: vi.fn().mockResolvedValue({ id: userId, email: "member@example.com", status: "ACTIVE", deletedAt: null }) },
    commonsResource: { updateMany: vi.fn().mockResolvedValue({ count: updateCount }) },
  };
  const api = commonsActionsRouter.createCaller({ db, req: { headers: { "x-session-token": "token" } } } as never);
  return { api, db };
}

describe("resource invitation ownership", () => {
  it("accepts only a pending invitation addressed to the signed-in member", async () => {
    const { api, db } = caller(1);
    await expect(api.respondToResourceInvitation({ resourceId: "resource-1", accept: true })).resolves.toEqual({ accepted: true });
    expect(db.commonsResource.updateMany).toHaveBeenCalledWith({
      where: { id: "resource-1", candidateUserId: "member-1", status: "INVITED" },
      data: { status: "ACCEPTED", respondedAt: expect.any(Date) },
    });
  });

  it("rejects an invitation that is not pending for the member", async () => {
    const { api } = caller(0);
    await expect(api.respondToResourceInvitation({ resourceId: "someone-elses", accept: false })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("records a decline for the invited member", async () => {
    const { api, db } = caller(1);
    await expect(api.respondToResourceInvitation({ resourceId: "resource-2", accept: false })).resolves.toEqual({ accepted: false });
    expect(db.commonsResource.updateMany).toHaveBeenCalledWith({
      where: { id: "resource-2", candidateUserId: "member-1", status: "INVITED" },
      data: { status: "DECLINED", respondedAt: expect.any(Date) },
    });
  });
});
