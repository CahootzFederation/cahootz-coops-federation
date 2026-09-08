import { describe, expect, it, vi, beforeEach } from "vitest";

import { knowledgeBaseRouter } from "../routers/knowledge-base.js";
import { ingestDocument } from "../services/knowledge-base.js";

vi.mock("../services/knowledge-base.js", () => ({
  ingestDocument: vi.fn(),
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
    group: {
      findUnique: vi.fn().mockResolvedValue({ id: "group_1", leaderId: ACTIVE_USER.id }),
      ...overrides.group,
    },
    groupMember: {
      findUnique: vi.fn().mockResolvedValue({ groupId: "group_1", userId: ACTIVE_USER.id }),
      ...overrides.groupMember,
    },
    userCoopMembership: {
      findUnique: vi.fn().mockResolvedValue({ status: "ACTIVE" }),
      upsert: vi.fn().mockResolvedValue({ status: "ACTIVE" }),
      ...overrides.userCoopMembership,
    },
    knowledgeDocument: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      ...overrides.knowledgeDocument,
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
  };
  return db;
}

function callerFor(db: any) {
  return knowledgeBaseRouter.createCaller({
    db,
    req: { headers: { "x-session-token": "token_1" } } as any,
    res: {} as any,
    coopId: undefined,
  });
}

describe("knowledgeBaseRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("uploadDocument", () => {
    it("uploads for a circle the caller is a member of", async () => {
      vi.mocked(ingestDocument).mockResolvedValue({
        document: {
          id: "doc_1",
          title: "Sept meeting",
          type: "MEETING_NOTES",
          visibility: "COMMONS",
          createdAt: new Date("2026-09-08T00:00:00.000Z"),
        } as any,
        chunkCount: 2,
      });
      const db = makeDb();

      const result = await callerFor(db).uploadDocument({
        scopeType: "circle",
        scopeId: "group_1",
        type: "MEETING_NOTES",
        title: "Sept meeting",
        content: "We discussed the budget.",
      });

      expect(db.groupMember.findUnique).toHaveBeenCalledWith({
        where: { groupId_userId: { groupId: "group_1", userId: ACTIVE_USER.id } },
      });
      expect(ingestDocument).toHaveBeenCalledWith(
        expect.objectContaining({ scopeType: "circle", scopeId: "group_1", uploadedById: ACTIVE_USER.id }),
      );
      expect(result.document.id).toBe("doc_1");
      expect(result.chunkCount).toBe(2);
    });

    it("rejects a circle upload from a non-member", async () => {
      const db = makeDb({ groupMember: { findUnique: vi.fn().mockResolvedValue(null) } });

      await expect(
        callerFor(db).uploadDocument({
          scopeType: "circle",
          scopeId: "group_1",
          type: "MEETING_NOTES",
          title: "Sept meeting",
          content: "We discussed the budget.",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      expect(ingestDocument).not.toHaveBeenCalled();
    });

    it("rejects a non-default commons upload when the caller isn't an active member", async () => {
      const db = makeDb({ userCoopMembership: { findUnique: vi.fn().mockResolvedValue(null) } });

      await expect(
        callerFor(db).uploadDocument({
          scopeType: "commons",
          scopeId: "artists",
          type: "FAQ",
          title: "FAQ",
          content: "Some content.",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      expect(ingestDocument).not.toHaveBeenCalled();
    });

    it("auto-joins the default commons (cahootz) rather than rejecting", async () => {
      vi.mocked(ingestDocument).mockResolvedValue({
        document: {
          id: "doc_2",
          title: "FAQ",
          type: "FAQ",
          visibility: "COMMONS",
          createdAt: new Date("2026-09-08T00:00:00.000Z"),
        } as any,
        chunkCount: 1,
      });
      const db = makeDb({ userCoopMembership: { findUnique: vi.fn().mockResolvedValue(null) } });

      const result = await callerFor(db).uploadDocument({
        scopeType: "commons",
        scopeId: "cahootz",
        type: "FAQ",
        title: "FAQ",
        content: "Some content.",
      });

      expect(db.userCoopMembership.upsert).toHaveBeenCalled();
      expect(result.document.id).toBe("doc_2");
    });
  });

  describe("listDocuments", () => {
    it("scopes the query to non-private docs plus the caller's own private drafts", async () => {
      const db = makeDb({
        knowledgeDocument: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: "doc_1",
              title: "Charter",
              type: "CHARTER",
              visibility: "COMMONS",
              createdAt: new Date("2026-09-08T00:00:00.000Z"),
            },
          ]),
        },
      });

      const result = await callerFor(db).listDocuments({ scopeType: "circle", scopeId: "group_1" });

      expect(db.knowledgeDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            scopeType: "circle",
            scopeId: "group_1",
            OR: [
              { visibility: { in: ["PUBLIC", "COMMONS", "CIRCLE"] } },
              { visibility: "PRIVATE", uploadedById: ACTIVE_USER.id },
            ],
          },
        }),
      );
      expect(result.documents).toEqual([
        { id: "doc_1", title: "Charter", type: "CHARTER", visibility: "COMMONS", createdAt: "2026-09-08T00:00:00.000Z" },
      ]);
    });

    it("rejects listing for a circle the caller isn't a member of", async () => {
      const db = makeDb({ groupMember: { findUnique: vi.fn().mockResolvedValue(null) } });

      await expect(
        callerFor(db).listDocuments({ scopeType: "circle", scopeId: "group_1" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("getDocument", () => {
    it("returns the document once scope access and visibility checks pass", async () => {
      const db = makeDb({
        knowledgeDocument: {
          findUnique: vi.fn().mockResolvedValue({
            id: "doc_1",
            title: "Charter",
            type: "CHARTER",
            visibility: "COMMONS",
            content: "Full text",
            sourceUrl: null,
            scopeType: "circle",
            scopeId: "group_1",
            uploadedById: "user_2",
            createdAt: new Date("2026-09-08T00:00:00.000Z"),
          }),
        },
      });

      const result = await callerFor(db).getDocument({ documentId: "doc_1" });

      expect(result.document.content).toBe("Full text");
    });

    it("throws NOT_FOUND for a missing document", async () => {
      const db = makeDb({ knowledgeDocument: { findUnique: vi.fn().mockResolvedValue(null) } });

      await expect(callerFor(db).getDocument({ documentId: "missing" })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("throws FORBIDDEN for a private document the caller didn't upload", async () => {
      const db = makeDb({
        knowledgeDocument: {
          findUnique: vi.fn().mockResolvedValue({
            id: "doc_1",
            title: "Draft",
            type: "OTHER",
            visibility: "PRIVATE",
            content: "Draft text",
            sourceUrl: null,
            scopeType: "circle",
            scopeId: "group_1",
            uploadedById: "user_2",
            createdAt: new Date("2026-09-08T00:00:00.000Z"),
          }),
        },
      });

      await expect(callerFor(db).getDocument({ documentId: "doc_1" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("allows the uploader to read their own private document", async () => {
      const db = makeDb({
        knowledgeDocument: {
          findUnique: vi.fn().mockResolvedValue({
            id: "doc_1",
            title: "Draft",
            type: "OTHER",
            visibility: "PRIVATE",
            content: "Draft text",
            sourceUrl: null,
            scopeType: "circle",
            scopeId: "group_1",
            uploadedById: ACTIVE_USER.id,
            createdAt: new Date("2026-09-08T00:00:00.000Z"),
          }),
        },
      });

      const result = await callerFor(db).getDocument({ documentId: "doc_1" });

      expect(result.document.content).toBe("Draft text");
    });

    it("rejects reading a document scoped to a circle the caller isn't a member of", async () => {
      const db = makeDb({
        groupMember: { findUnique: vi.fn().mockResolvedValue(null) },
        knowledgeDocument: {
          findUnique: vi.fn().mockResolvedValue({
            id: "doc_1",
            title: "Charter",
            type: "CHARTER",
            visibility: "COMMONS",
            content: "Full text",
            sourceUrl: null,
            scopeType: "circle",
            scopeId: "group_1",
            uploadedById: "user_2",
            createdAt: new Date("2026-09-08T00:00:00.000Z"),
          }),
        },
      });

      await expect(callerFor(db).getDocument({ documentId: "doc_1" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
  });
});
