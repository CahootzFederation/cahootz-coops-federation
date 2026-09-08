import { describe, expect, it, vi, beforeEach } from "vitest";

import { groupsRouter } from "../routers/groups.js";
import { validateSCBalance } from "../services/sc-validation-service.js";

vi.mock("../services/sc-validation-service.js", () => ({
  validateSCBalance: vi.fn().mockResolvedValue(0),
}));

const ACTIVE_USER = {
  id: "user_1",
  email: "alice@example.com",
  name: "Alice",
  phone: "+15555550123",
  roles: ["member"],
  status: "ACTIVE",
  deletedAt: null,
};

function makeDb(overrides: Record<string, Partial<Record<string, any>>> = {}) {
  const db: any = {
    coopConfig: {
      findFirst: vi.fn().mockResolvedValue(null),
      ...overrides.coopConfig,
    },
    group: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(({ data }: any) => ({
        id: "group_1",
        inviteCode: data.inviteCode,
        coopId: data.coopId,
        name: data.name,
        purpose: data.purpose,
        privacy: data.privacy,
        leaderId: data.leaderId,
        lastActivityAt: new Date("2026-09-08T00:00:00.000Z"),
        createdAt: new Date("2026-09-08T00:00:00.000Z"),
      })),
      update: vi.fn().mockResolvedValue({}),
      ...overrides.group,
    },
    groupMember: {
      findUnique: vi.fn().mockResolvedValue({ groupId: "group_1", userId: ACTIVE_USER.id }),
      create: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(3),
      ...overrides.groupMember,
    },
    groupComment: {
      create: vi.fn().mockImplementation(({ data }: any) => ({
        id: "comment_1",
        groupId: data.groupId,
        authorId: data.authorId,
        content: data.content,
        createdAt: new Date("2026-09-08T00:00:00.000Z"),
        author: { name: ACTIVE_USER.name, email: ACTIVE_USER.email },
      })),
      count: vi.fn().mockResolvedValue(7),
      ...overrides.groupComment,
    },
    session: {
      findUnique: vi.fn().mockResolvedValue({
        id: "session_1",
        userId: ACTIVE_USER.id,
        token: "token_1",
        isRevoked: false,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      }),
      update: vi.fn().mockResolvedValue({}),
      ...overrides.session,
    },
    user: {
      findUnique: vi.fn().mockResolvedValue(ACTIVE_USER),
      ...overrides.user,
    },
    $transaction: vi.fn(async (callback: any) => callback(db)),
  };

  return db;
}

function callerFor(db: any) {
  return groupsRouter.createCaller({
    db,
    req: { headers: { "x-session-token": "token_1" } } as any,
    res: {} as any,
    coopId: undefined,
  });
}

describe("groupsRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("create", () => {
    it("succeeds with no CoopConfig row (default, no gate)", async () => {
      const db = makeDb();

      const result = await callerFor(db).create({ name: "Block Club" });

      expect(result.group.name).toBe("Block Club");
      expect(validateSCBalance).not.toHaveBeenCalled();
      expect(db.group.create).toHaveBeenCalled();
    });

    it("succeeds when minScBalanceToCreateGroup is 0", async () => {
      const db = makeDb({
        coopConfig: { findFirst: vi.fn().mockResolvedValue({ minScBalanceToCreateGroup: 0 }) },
      });

      const result = await callerFor(db).create({ name: "Block Club" });

      expect(result.group.name).toBe("Block Club");
      expect(validateSCBalance).not.toHaveBeenCalled();
    });

    it("throws FORBIDDEN when the caller's SC balance is below the configured minimum", async () => {
      const db = makeDb({
        coopConfig: { findFirst: vi.fn().mockResolvedValue({ minScBalanceToCreateGroup: 10 }) },
      });
      vi.mocked(validateSCBalance).mockResolvedValueOnce(5);

      await expect(callerFor(db).create({ name: "Block Club" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(db.group.create).not.toHaveBeenCalled();
    });

    it("succeeds when the caller's SC balance meets the configured minimum", async () => {
      const db = makeDb({
        coopConfig: { findFirst: vi.fn().mockResolvedValue({ minScBalanceToCreateGroup: 10 }) },
      });
      vi.mocked(validateSCBalance).mockResolvedValueOnce(10);

      const result = await callerFor(db).create({ name: "Block Club" });

      expect(result.group.name).toBe("Block Club");
      expect(db.group.create).toHaveBeenCalled();
    });
  });

  describe("getCreateRequirements", () => {
    it("skips the on-chain balance check when no gate is configured", async () => {
      const db = makeDb();

      const result = await callerFor(db).getCreateRequirements({});

      expect(result).toEqual({ minScBalance: 0, currentScBalance: 0, canCreate: true });
      expect(validateSCBalance).not.toHaveBeenCalled();
    });

    it("reports canCreate: false when balance is short", async () => {
      const db = makeDb({
        coopConfig: { findFirst: vi.fn().mockResolvedValue({ minScBalanceToCreateGroup: 10 }) },
      });
      vi.mocked(validateSCBalance).mockResolvedValueOnce(4);

      const result = await callerFor(db).getCreateRequirements({});

      expect(result).toEqual({ minScBalance: 10, currentScBalance: 4, canCreate: false });
    });
  });

  describe("addComment", () => {
    it("bumps the group's lastActivityAt when a comment is posted", async () => {
      const db = makeDb({
        group: {
          findUnique: vi.fn().mockResolvedValue({ id: "group_1", leaderId: ACTIVE_USER.id }),
        },
      });

      await callerFor(db).addComment({ groupId: "group_1", content: "hello" });

      expect(db.group.update).toHaveBeenCalledWith({
        where: { id: "group_1" },
        data: { lastActivityAt: expect.any(Date) },
      });
    });
  });

  describe("getDigest", () => {
    it("returns aggregated member/comment counts and last activity", async () => {
      const db = makeDb({
        group: {
          findUnique: vi.fn().mockResolvedValue({
            id: "group_1",
            name: "Block Club",
            leaderId: ACTIVE_USER.id,
            lastActivityAt: new Date("2026-09-08T12:00:00.000Z"),
          }),
        },
      });

      const result = await callerFor(db).getDigest({ groupId: "group_1" });

      expect(result).toEqual({
        groupId: "group_1",
        groupName: "Block Club",
        lastActivityAt: "2026-09-08T12:00:00.000Z",
        memberCount: 3,
        commentCountSince: 7,
        since: null,
      });
    });
  });
});
