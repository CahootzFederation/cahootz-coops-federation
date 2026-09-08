import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { db } from "@repo/db";

import { groupsRouter } from "../routers/groups.js";
import { validateSCBalance } from "../services/sc-validation-service.js";

const mockDb = db as any;

vi.mock("../services/sc-validation-service.js", () => ({
  validateSCBalance: vi.fn().mockResolvedValue(0),
}));

// Real class for Agent (per project convention), real-enough run() for the
// shared Community Observer agent used by getAiDigest.
vi.mock("@openai/agents", () => {
  class MockAgent {
    constructor(_opts: any) {}
  }
  return {
    Agent: MockAgent,
    run: vi.fn().mockResolvedValue({
      finalOutput: {
        type: "circle_digest_summary",
        confidence: 0.75,
        summary: "Two members joined and leadership transferred since last digest.",
        details: {},
      },
    }),
    webSearchTool: vi.fn().mockReturnValue({}),
    // getAiDigest passes a toolCtx, so runCommunityObserver actually calls
    // buildDbTools()/buildQueryObservationsTool()/buildSearchKnowledgeBaseTool(),
    // each of which calls tool() from this module - unlike commons.ts's
    // createPost, which runs tool-less.
    tool: vi.fn().mockReturnValue({}),
  };
});

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
      delete: vi.fn().mockResolvedValue({}),
      ...overrides.group,
    },
    groupMember: {
      findUnique: vi.fn().mockResolvedValue({ groupId: "group_1", userId: ACTIVE_USER.id }),
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
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
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
      ...overrides.auditLog,
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
    // Supports both the callback form (`$transaction(async (tx) => ...)`) and
    // the array form (`$transaction([promise, promise])`) used by the audit-log
    // write sites in groups.ts.
    $transaction: vi.fn(async (arg: any) => {
      if (Array.isArray(arg)) {
        return Promise.all(arg);
      }
      return arg(db);
    }),
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

  describe("listMine", () => {
    it("returns every group the caller is a member of when no coopId is given", async () => {
      const db = makeDb({
        groupMember: {
          findMany: vi.fn().mockResolvedValue([
            {
              group: {
                id: "group_1",
                name: "Block Club",
                purpose: null,
                privacy: "invite-only",
                leaderId: ACTIVE_USER.id,
                createdAt: new Date("2026-09-08T00:00:00.000Z"),
                _count: { members: 3 },
              },
            },
          ]),
        },
      });

      const result = await callerFor(db).listMine();

      expect(db.groupMember.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: ACTIVE_USER.id } }),
      );
      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].id).toBe("group_1");
    });

    it("scopes the query to a single commons when coopId is given", async () => {
      const db = makeDb();

      await callerFor(db).listMine({ coopId: "artists" });

      expect(db.groupMember.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: ACTIVE_USER.id, group: { coopId: "artists" } },
        }),
      );
    });
  });

  describe("create", () => {
    it("succeeds with no CoopConfig row (default, no gate)", async () => {
      const db = makeDb();

      const result = await callerFor(db).create({ name: "Block Club" });

      expect(result.group.name).toBe("Block Club");
      expect(validateSCBalance).not.toHaveBeenCalled();
      expect(db.group.create).toHaveBeenCalled();
      expect(db.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorId: ACTIVE_USER.id,
          action: "GROUP_CREATED",
          resource: "Group",
          resourceId: "group_1",
        }),
      });
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

  describe("getDetail", () => {
    it("includes the commons this circle belongs to", async () => {
      const db = makeDb({
        group: {
          findUnique: vi.fn().mockResolvedValue({
            id: "group_1",
            name: "Block Club",
            purpose: null,
            privacy: "invite-only",
            leaderId: ACTIVE_USER.id,
            coopId: "artists",
            createdAt: new Date("2026-09-08T00:00:00.000Z"),
          }),
        },
        coopConfig: {
          findFirst: vi.fn().mockResolvedValue({ name: "Artists Commons", slug: "artists" }),
        },
        groupMember: {
          findUnique: vi.fn().mockResolvedValue({ groupId: "group_1", userId: ACTIVE_USER.id }),
          findMany: vi.fn().mockResolvedValue([]),
        },
      });

      const result = await callerFor(db).getDetail({ groupId: "group_1" });

      expect(result.group.coopId).toBe("artists");
      expect(result.group.coopName).toBe("Artists Commons");
    });

    it("falls back to the raw coopId when no CoopConfig name is published", async () => {
      const db = makeDb({
        group: {
          findUnique: vi.fn().mockResolvedValue({
            id: "group_1",
            name: "Block Club",
            purpose: null,
            privacy: "invite-only",
            leaderId: ACTIVE_USER.id,
            coopId: "artists",
            createdAt: new Date("2026-09-08T00:00:00.000Z"),
          }),
        },
        coopConfig: { findFirst: vi.fn().mockResolvedValue(null) },
        groupMember: {
          findUnique: vi.fn().mockResolvedValue({ groupId: "group_1", userId: ACTIVE_USER.id }),
          findMany: vi.fn().mockResolvedValue([]),
        },
      });

      const result = await callerFor(db).getDetail({ groupId: "group_1" });

      expect(result.group.coopName).toBe("artists");
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
      expect(db.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorId: ACTIVE_USER.id,
          action: "GROUP_COMMENT_ADDED",
          resource: "GroupComment",
          resourceId: "comment_1",
        }),
      });
    });
  });

  describe("joinByCode", () => {
    it("adds the caller as a member and logs GROUP_JOINED", async () => {
      const db = makeDb({
        group: {
          findUnique: vi.fn().mockResolvedValue({ id: "group_1", name: "Block Club", inviteCode: "ABCD1234" }),
        },
      });

      const result = await callerFor(db).joinByCode({ inviteCode: "abcd1234" });

      expect(result).toEqual({ groupId: "group_1", name: "Block Club" });
      expect(db.groupMember.upsert).toHaveBeenCalled();
      expect(db.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorId: ACTIVE_USER.id,
          action: "GROUP_JOINED",
          resource: "GroupMember",
          resourceId: "group_1",
        }),
      });
    });

    it("joins when the invite code's group matches the given coopId", async () => {
      const db = makeDb({
        group: {
          findUnique: vi.fn().mockResolvedValue({
            id: "group_1",
            name: "Block Club",
            coopId: "cahootz",
            inviteCode: "ABCD1234",
          }),
        },
      });

      const result = await callerFor(db).joinByCode({ inviteCode: "abcd1234", coopId: "cahootz" });

      expect(result).toEqual({ groupId: "group_1", name: "Block Club" });
      expect(db.groupMember.upsert).toHaveBeenCalled();
    });

    it("rejects a code for a circle in a different commons than the given coopId", async () => {
      const db = makeDb({
        group: {
          findUnique: vi.fn().mockResolvedValue({
            id: "group_1",
            name: "Block Club",
            coopId: "cahootz",
            inviteCode: "ABCD1234",
          }),
        },
      });

      await expect(
        callerFor(db).joinByCode({ inviteCode: "abcd1234", coopId: "artists" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });

      expect(db.groupMember.upsert).not.toHaveBeenCalled();
    });
  });

  describe("regenerateInviteCode", () => {
    it("regenerates the code and logs GROUP_INVITE_CODE_REGENERATED", async () => {
      const db = makeDb({
        group: {
          findUnique: vi
            .fn()
            .mockResolvedValueOnce({ id: "group_1", leaderId: ACTIVE_USER.id }) // requireMembership
            .mockResolvedValueOnce(null), // uniqueness check for the new code
          update: vi.fn().mockResolvedValue({ inviteCode: "NEWCODE1" }),
        },
      });

      const result = await callerFor(db).regenerateInviteCode({ groupId: "group_1" });

      expect(result).toEqual({ inviteCode: "NEWCODE1" });
      expect(db.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorId: ACTIVE_USER.id,
          action: "GROUP_INVITE_CODE_REGENERATED",
          resource: "Group",
          resourceId: "group_1",
        }),
      });
    });
  });

  describe("transferLeadership", () => {
    it("transfers leadership and logs GROUP_LEADERSHIP_TRANSFERRED", async () => {
      const db = makeDb({
        group: {
          findUnique: vi.fn().mockResolvedValue({ id: "group_1", leaderId: ACTIVE_USER.id }),
        },
        groupMember: {
          findUnique: vi.fn().mockResolvedValue({ groupId: "group_1", userId: "user_2" }),
        },
      });

      const result = await callerFor(db).transferLeadership({
        groupId: "group_1",
        newLeaderUserId: "user_2",
      });

      expect(result).toEqual({ success: true });
      expect(db.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorId: ACTIVE_USER.id,
          action: "GROUP_LEADERSHIP_TRANSFERRED",
          resource: "Group",
          resourceId: "group_1",
          metadata: { previousLeaderId: ACTIVE_USER.id, newLeaderId: "user_2" },
        }),
      });
    });
  });

  describe("leave", () => {
    it("removes the membership and logs GROUP_LEFT when the caller isn't the leader", async () => {
      const db = makeDb({
        group: {
          findUnique: vi.fn().mockResolvedValue({ id: "group_1", leaderId: "user_2" }),
        },
      });

      const result = await callerFor(db).leave({ groupId: "group_1" });

      expect(result).toEqual({ success: true, groupDeleted: false });
      expect(db.groupMember.delete).toHaveBeenCalled();
      expect(db.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorId: ACTIVE_USER.id,
          action: "GROUP_LEFT",
          resource: "GroupMember",
          resourceId: "group_1",
        }),
      });
    });

    it("deletes the group and logs GROUP_DELETED when the leader is the sole member", async () => {
      const db = makeDb({
        group: {
          findUnique: vi.fn().mockResolvedValue({ id: "group_1", leaderId: ACTIVE_USER.id }),
        },
        groupMember: {
          count: vi.fn().mockResolvedValue(1),
        },
      });

      const result = await callerFor(db).leave({ groupId: "group_1" });

      expect(result).toEqual({ success: true, groupDeleted: true });
      expect(db.group.delete).toHaveBeenCalledWith({ where: { id: "group_1" } });
      expect(db.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorId: ACTIVE_USER.id,
          action: "GROUP_DELETED",
          resource: "Group",
          resourceId: "group_1",
          metadata: { reason: "leader_left_as_sole_member" },
        }),
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

  describe("getAiDigest", () => {
    const originalKey = process.env.OPENAI_API_KEY;

    beforeEach(() => {
      process.env.OPENAI_API_KEY = "test-key";
      // ai-memory.ts's queryObservations()/recordObservation() import `db`
      // module-level from @repo/db (the globally-mocked singleton), separate
      // from the per-test `db` object passed via ctx below.
      mockDb.group = {
        findUnique: vi.fn().mockResolvedValue({ id: "group_1", leaderId: ACTIVE_USER.id }),
      };
      mockDb.groupMember = {
        findUnique: vi.fn().mockResolvedValue({ groupId: "group_1", userId: ACTIVE_USER.id }),
      };
      mockDb.aIObservation = {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockImplementation(({ data }: any) => ({
          id: "obs_1",
          ...data,
          createdAt: new Date("2026-09-08T12:00:00.000Z"),
        })),
      };
    });

    afterEach(() => {
      process.env.OPENAI_API_KEY = originalKey;
    });

    it("generates a digest via the shared Community Observer agent and records an AIObservation", async () => {
      const db = makeDb({
        group: {
          findUnique: vi.fn().mockResolvedValue({
            id: "group_1",
            name: "Block Club",
            coopId: "cahootz",
            leaderId: ACTIVE_USER.id,
          }),
        },
        groupComment: {
          findMany: vi.fn().mockResolvedValue([
            { id: "comment_1", content: "hello", author: { name: "Alice", email: ACTIVE_USER.email } },
          ]),
        },
        auditLog: {
          findMany: vi.fn().mockResolvedValue([
            { id: "audit_1", action: "GROUP_CREATED", occurredAt: new Date("2026-09-08T00:00:00.000Z") },
          ]),
        },
      });

      const result = await callerFor(db).getAiDigest({ groupId: "group_1" });

      expect(result.digest.summary).toBe(
        "Two members joined and leadership transferred since last digest.",
      );
      expect(mockDb.aIObservation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: "circle_digest_summary",
            scopeType: "circle",
            scopeId: "group_1",
            visibility: "CIRCLE",
            generatedByAgentKey: "community-observer",
          }),
        }),
      );
    });

    it("throws PRECONDITION_FAILED when OPENAI_API_KEY is unset", async () => {
      delete process.env.OPENAI_API_KEY;
      const db = makeDb({
        group: {
          findUnique: vi.fn().mockResolvedValue({
            id: "group_1",
            name: "Block Club",
            coopId: "cahootz",
            leaderId: ACTIVE_USER.id,
          }),
        },
      });

      await expect(callerFor(db).getAiDigest({ groupId: "group_1" })).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
    });
  });
});
