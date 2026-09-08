import { describe, expect, it, vi } from "vitest";

import {
  buildGetUserProfileTool,
  buildGetGroupHistoryTool,
  buildQueryEventLogTool,
} from "../agents/tools/db-tools.js";
import type { AgentToolContext } from "../agents/tools/context.js";

function makeDb(overrides: Record<string, Partial<Record<string, any>>> = {}) {
  const db: any = {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        name: "Alice",
        selfDescription: null,
        shortTermGoals: null,
        longTermGoals: null,
        skills: [],
        interests: [],
        resourcesOffered: [],
        resourcesNeeded: [],
        businessSummary: null,
        locationSummary: null,
      }),
      ...overrides.user,
    },
    group: {
      findUnique: vi.fn().mockResolvedValue({ id: "group_1", leaderId: "user_1" }),
      ...overrides.group,
    },
    groupMember: {
      findUnique: vi.fn().mockResolvedValue({ groupId: "group_1", userId: "user_1" }),
      ...overrides.groupMember,
    },
    groupComment: {
      findMany: vi.fn().mockResolvedValue([
        {
          author: { name: "Alice" },
          content: "hello",
          createdAt: new Date("2026-09-08T00:00:00.000Z"),
        },
      ]),
      ...overrides.groupComment,
    },
    auditLog: {
      findMany: vi.fn().mockResolvedValue([
        {
          action: "GROUP_CREATED",
          resource: "Group",
          resourceId: "group_1",
          metadata: {},
          occurredAt: new Date("2026-09-08T00:00:00.000Z"),
        },
      ]),
      ...overrides.auditLog,
    },
  };
  return db;
}

// The @openai/agents tool() helper returns a FunctionTool whose `invoke`
// takes a JSON-string of arguments, not the parsed object directly — this
// mirrors how the SDK calls it when the model emits a tool call.
async function callTool(t: any, args: Record<string, unknown>) {
  return t.invoke({} as any, JSON.stringify(args));
}

function makeCtx(db: any, overrides: Partial<AgentToolContext> = {}): AgentToolContext {
  return { db, requestingUserId: "user_1", coopId: "cahootz", ...overrides };
}

describe("agent tools", () => {
  describe("get_user_profile", () => {
    it("returns the safe-field profile for a known user", async () => {
      const db = makeDb();
      const result = await callTool(buildGetUserProfileTool(makeCtx(db)), { userId: "user_1" });

      expect(db.user.findUnique).toHaveBeenCalledWith({
        where: { id: "user_1" },
        select: expect.objectContaining({ name: true, skills: true }),
      });
      expect(result).toMatchObject({ name: "Alice" });
    });

    it("returns null for an unknown user", async () => {
      const db = makeDb({ user: { findUnique: vi.fn().mockResolvedValue(null) } });
      const result = await callTool(buildGetUserProfileTool(makeCtx(db)), { userId: "nobody" });

      expect(result).toBeNull();
    });
  });

  describe("get_group_history", () => {
    it("returns scoped comments for a member", async () => {
      const db = makeDb();
      const result = await callTool(buildGetGroupHistoryTool(makeCtx(db)), {
        groupId: "group_1",
        limit: 20,
      });

      expect(db.groupMember.findUnique).toHaveBeenCalledWith({
        where: { groupId_userId: { groupId: "group_1", userId: "user_1" } },
      });
      expect(result).toEqual([
        { author: "Alice", content: "hello", createdAt: "2026-09-08T00:00:00.000Z" },
      ]);
    });

    it("throws FORBIDDEN for a non-member — same check the tRPC procedure uses", async () => {
      const db = makeDb({ groupMember: { findUnique: vi.fn().mockResolvedValue(null) } });

      await expect(
        callTool(buildGetGroupHistoryTool(makeCtx(db)), { groupId: "group_1", limit: 20 }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("query_event_log", () => {
    it("returns scoped events when resourceId is provided", async () => {
      const db = makeDb();
      const result = await callTool(buildQueryEventLogTool(makeCtx(db)), {
        resourceId: "group_1",
        limit: 20,
      });

      expect(db.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { resourceId: "group_1" } }),
      );
      expect(result).toEqual([
        {
          action: "GROUP_CREATED",
          resource: "Group",
          resourceId: "group_1",
          metadata: {},
          occurredAt: "2026-09-08T00:00:00.000Z",
        },
      ]);
    });

    it("rejects an unscoped query with neither actorId nor resourceId", async () => {
      const db = makeDb();

      await expect(
        callTool(buildQueryEventLogTool(makeCtx(db)), { limit: 20 }),
      ).rejects.toThrow(/requires actorId or resourceId/);
    });
  });
});
