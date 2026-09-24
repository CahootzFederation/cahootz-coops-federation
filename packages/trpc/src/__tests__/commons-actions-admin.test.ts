import { afterAll, describe, expect, it, vi } from "vitest";

const saved = vi.hoisted(() => {
  const previous = { emails: process.env.PLATFORM_ADMIN_EMAILS, secret: process.env.SESSION_SECRET };
  process.env.PLATFORM_ADMIN_EMAILS = "platform@example.com";
  process.env.SESSION_SECRET = "test-secret-for-commons-admin-api-long-enough";
  return previous;
});

import { issueCommonsAdminToken, verifyCommonsAdminToken } from "../lib/commons-admin-token.js";
import { commonsActionsAdminRouter } from "../routers/commons-actions-admin.js";

afterAll(() => {
  if (saved.emails === undefined) delete process.env.PLATFORM_ADMIN_EMAILS;
  else process.env.PLATFORM_ADMIN_EMAILS = saved.emails;
  if (saved.secret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = saved.secret;
});

describe("Commons admin API authentication", () => {
  it("accepts an issued platform-admin token and rejects tampering", () => {
    const token = issueCommonsAdminToken({ userId: "platform-user", email: "platform@example.com" });
    expect(verifyCommonsAdminToken(token)).toMatchObject({ sub: "platform-user", email: "platform@example.com" });
    expect(verifyCommonsAdminToken(`${token}x`)).toBeNull();
    vi.useFakeTimers({ now: new Date(Date.now() + 3 * 60 * 60 * 1000) });
    try { expect(verifyCommonsAdminToken(token)).toBeNull(); }
    finally { vi.useRealTimers(); }
    expect(() => issueCommonsAdminToken({ email: "commons-admin@example.com" })).toThrow("Platform admin access required");
  });

  it("rejects a wallet header without a signed bearer token", async () => {
    const db = { user: { findUnique: vi.fn() } };
    const caller = commonsActionsAdminRouter.createCaller({ db, req: { headers: { "x-wallet-address": "0x0000000000000000000000000000000000000001" } } } as never);
    await expect(caller.command({ coopId: "harbor", command: "auto-reply", enabled: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it("lets a signed platform admin change the per-Commons setting", async () => {
    const token = issueCommonsAdminToken({ userId: "platform-user", email: "platform@example.com" });
    const db = {
      user: { findUnique: vi.fn().mockResolvedValue({ deletedAt: null, status: "ACTIVE" }) },
      coopConfig: { findFirst: vi.fn().mockResolvedValue({ id: "config-1" }) },
      commonsAgentSetting: { upsert: vi.fn().mockResolvedValue({ autoReply: false }) },
    };
    const caller = commonsActionsAdminRouter.createCaller({ db, req: { headers: { authorization: `Bearer ${token}` } } } as never);
    await expect(caller.command({ coopId: "harbor", command: "auto-reply", enabled: false })).resolves.toEqual({ autoReply: false });
    expect(db.commonsAgentSetting.upsert).toHaveBeenCalledWith({
      where: { coopId: "harbor" },
      create: { coopId: "harbor", autoReply: false, updatedBy: "platform@example.com" },
      update: { autoReply: false, updatedBy: "platform@example.com" },
    });
  });

  it("includes the original comment and its parent post in review actions", async () => {
    const token = issueCommonsAdminToken({ userId: "platform-user", email: "platform@example.com" });
    const now = new Date("2026-09-20T12:00:00Z");
    const db = {
      user: { findUnique: vi.fn().mockResolvedValue({ deletedAt: null, status: "ACTIVE" }) },
      coopConfig: { findFirst: vi.fn().mockResolvedValue({ id: "config-1" }) },
      commonsAgentSetting: { findUnique: vi.fn().mockResolvedValue(null) },
      commonsAction: { findMany: vi.fn().mockResolvedValue([
        { id: "action-1", sourceType: "commons_comment", sourceId: "comment-1", sourcePostId: "post-1", reviews: [] },
      ]) },
      commonsActionFeedback: { findMany: vi.fn().mockResolvedValue([]) },
      commonsActionAudit: { findMany: vi.fn().mockResolvedValue([]) },
      commonsResource: { findMany: vi.fn().mockResolvedValue([]) },
      aICostEvent: { findMany: vi.fn().mockResolvedValue([]) },
      $queryRaw: vi.fn().mockResolvedValue([]),
      commonsPost: { findMany: vi.fn().mockResolvedValue([
        { id: "post-1", title: "Neighborhood garden", content: "We need tools.", createdAt: now, author: { name: "Avery", handle: "avery" } },
      ]) },
      commonsComment: { findMany: vi.fn().mockResolvedValue([
        { id: "comment-1", content: "I can bring shovels.", createdAt: now, author: { name: "Jordan", handle: "jordan" } },
      ]) },
    };
    const caller = commonsActionsAdminRouter.createCaller({ db, req: { headers: { authorization: `Bearer ${token}` } } } as never);
    const dashboard = await caller.dashboard({ coopId: "harbor" });
    expect(dashboard.actions[0]).toMatchObject({
      source: { content: "I can bring shovels.", author: { name: "Jordan" } },
      parentPost: { title: "Neighborhood garden", content: "We need tools.", author: { name: "Avery" } },
    });
    expect(db.commonsPost.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["post-1"] }, coopId: "harbor" } }));
  });

  it("lets only a platform admin rate a reply without changing the action", async () => {
    const token = issueCommonsAdminToken({ userId: "platform-user", email: "platform@example.com" });
    const db = {
      user: { findUnique: vi.fn().mockResolvedValue({ deletedAt: null, status: "ACTIVE" }) },
      coopConfig: { findFirst: vi.fn().mockResolvedValue({ id: "config-1" }) },
      commonsAction: { findFirst: vi.fn().mockResolvedValue({ id: "action-1", type: "ANSWER_QUESTION", status: "PUBLISHED" }), update: vi.fn() },
      commonsActionFeedback: { upsert: vi.fn().mockResolvedValue({ id: "feedback-1" }) },
    };
    const input = { coopId: "harbor", command: "rate-response" as const, actionId: "action-1", rating: "NEEDS_WORK" as const,
      reasons: ["MISSED_CONTEXT" as const], notes: "Missed the request for a date", correctedText: "We meet Tuesday." };
    const caller = commonsActionsAdminRouter.createCaller({ db, req: { headers: { authorization: `Bearer ${token}` } } } as never);
    await expect(caller.command(input)).resolves.toEqual({ success: true });
    expect(db.commonsActionFeedback.upsert).toHaveBeenCalledWith({ where: { actionId: "action-1" },
      create: { actionId: "action-1", coopId: "harbor", rating: "NEEDS_WORK", reasons: ["MISSED_CONTEXT"], notes: input.notes,
        correctedText: input.correctedText, reviewedBy: "platform@example.com" },
      update: { rating: "NEEDS_WORK", reasons: ["MISSED_CONTEXT"], notes: input.notes,
        correctedText: input.correctedText, reviewedBy: "platform@example.com" } });
    expect(db.commonsAction.update).not.toHaveBeenCalled();
    await expect(caller.command({ ...input, reasons: [] })).rejects.toMatchObject({ code: "CONFLICT" });
    const unauthorized = commonsActionsAdminRouter.createCaller({ db, req: { headers: { "x-wallet-address": "0x0000000000000000000000000000000000000001" } } } as never);
    await expect(unauthorized.command(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
