import { describe, expect, it, vi, beforeEach } from "vitest";
import { db } from "@repo/db";

import { recordObservation, queryObservations } from "../services/ai-memory.js";

const mockDb = db as any;

function observationRow(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: "obs_1",
    type: "pattern_detected",
    scopeType: "commons",
    scopeId: "cahootz",
    confidence: 0.8,
    summary: "Childcare has come up repeatedly.",
    details: null,
    visibility: "PUBLIC",
    status: "ACTIVE",
    createdAt: new Date("2026-09-08T00:00:00.000Z"),
    sources: [],
    ...overrides,
  };
}

describe("ai-memory service", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockDb.aIObservation = {
      create: vi.fn().mockImplementation(({ data }: any) => ({
        id: "obs_new",
        ...data,
        sources: [],
      })),
      findMany: vi.fn().mockResolvedValue([]),
    };
    mockDb.userCoopMembership = {
      findUnique: vi.fn().mockResolvedValue(null),
    };
    mockDb.adminRole = {
      findFirst: vi.fn().mockResolvedValue(null),
    };
    mockDb.group = {
      findUnique: vi.fn().mockResolvedValue({ id: "group_1", leaderId: "user_1" }),
    };
    mockDb.groupMember = {
      findUnique: vi.fn().mockResolvedValue(null),
    };
  });

  describe("recordObservation", () => {
    it("writes the observation with sources nested-created, defaulting visibility to COMMONS_ADMINS", async () => {
      await recordObservation({
        type: "pattern_detected",
        scopeType: "commons",
        scopeId: "cahootz",
        confidence: 0.8,
        summary: "Childcare need surfaced repeatedly.",
        sources: [{ type: "commons_post", id: "post_1" }],
      });

      expect(mockDb.aIObservation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: "pattern_detected",
          scopeType: "commons",
          scopeId: "cahootz",
          confidence: 0.8,
          visibility: "COMMONS_ADMINS",
          sources: { create: [{ sourceType: "commons_post", sourceId: "post_1" }] },
        }),
        include: { sources: true },
      });
    });
  });

  describe("queryObservations", () => {
    it("always includes PUBLIC observations, even for an anonymous caller", async () => {
      mockDb.aIObservation.findMany.mockResolvedValue([observationRow({ visibility: "PUBLIC" })]);

      const result = await queryObservations({
        scopeType: "commons",
        scopeId: "cahootz",
        requestingUserId: null,
        coopId: "cahootz",
      });

      expect(result).toHaveLength(1);
      expect(result[0].visibility).toBe("PUBLIC");
    });

    it("filters the base query to ACTIVE, non-expired rows for the given scope", async () => {
      await queryObservations({
        scopeType: "commons",
        scopeId: "cahootz",
        requestingUserId: null,
        coopId: "cahootz",
      });

      expect(mockDb.aIObservation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            scopeType: "commons",
            scopeId: "cahootz",
            status: "ACTIVE",
            OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
          }),
        }),
      );
    });

    it("includes COMMONS_MEMBERS observations only for an active commons member", async () => {
      mockDb.aIObservation.findMany.mockResolvedValue([
        observationRow({ id: "obs_members", visibility: "COMMONS_MEMBERS" }),
      ]);

      const asNonMember = await queryObservations({
        scopeType: "commons",
        scopeId: "cahootz",
        requestingUserId: "user_1",
        coopId: "cahootz",
      });
      expect(asNonMember).toHaveLength(0);

      mockDb.userCoopMembership.findUnique.mockResolvedValue({ status: "ACTIVE" });
      const asMember = await queryObservations({
        scopeType: "commons",
        scopeId: "cahootz",
        requestingUserId: "user_1",
        coopId: "cahootz",
      });
      expect(asMember).toHaveLength(1);
    });

    it("includes COMMONS_ADMINS observations only for a non-revoked AdminRole", async () => {
      mockDb.aIObservation.findMany.mockResolvedValue([
        observationRow({ id: "obs_admins", visibility: "COMMONS_ADMINS" }),
      ]);

      const asNonAdmin = await queryObservations({
        scopeType: "commons",
        scopeId: "cahootz",
        requestingUserId: "user_1",
        coopId: "cahootz",
      });
      expect(asNonAdmin).toHaveLength(0);

      mockDb.adminRole.findFirst.mockResolvedValue({ id: "role_1" });
      const asAdmin = await queryObservations({
        scopeType: "commons",
        scopeId: "cahootz",
        requestingUserId: "user_1",
        coopId: "cahootz",
      });
      expect(asAdmin).toHaveLength(1);
      expect(mockDb.adminRole.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: "user_1", coopId: "cahootz", revokedAt: null } }),
      );
    });

    it("includes CIRCLE observations only for a group member (reusing requireMembership)", async () => {
      mockDb.aIObservation.findMany.mockResolvedValue([
        observationRow({ id: "obs_circle", scopeType: "circle", scopeId: "group_1", visibility: "CIRCLE" }),
      ]);

      const asNonMember = await queryObservations({
        scopeType: "circle",
        scopeId: "group_1",
        requestingUserId: "user_1",
        coopId: "cahootz",
      });
      expect(asNonMember).toHaveLength(0);

      mockDb.groupMember.findUnique.mockResolvedValue({ groupId: "group_1", userId: "user_1" });
      const asMember = await queryObservations({
        scopeType: "circle",
        scopeId: "group_1",
        requestingUserId: "user_1",
        coopId: "cahootz",
      });
      expect(asMember).toHaveLength(1);
    });

    it("includes PRIVATE_TO_AUTHOR_SCOPE observations only for the matching member", async () => {
      mockDb.aIObservation.findMany.mockResolvedValue([
        observationRow({
          id: "obs_private",
          scopeType: "member",
          scopeId: "user_1",
          visibility: "PRIVATE_TO_AUTHOR_SCOPE",
        }),
      ]);

      const asSomeoneElse = await queryObservations({
        scopeType: "member",
        scopeId: "user_1",
        requestingUserId: "user_2",
        coopId: "cahootz",
      });
      expect(asSomeoneElse).toHaveLength(0);

      const asSelf = await queryObservations({
        scopeType: "member",
        scopeId: "user_1",
        requestingUserId: "user_1",
        coopId: "cahootz",
      });
      expect(asSelf).toHaveLength(1);
    });

    it("flattens sources to an array of source IDs", async () => {
      mockDb.aIObservation.findMany.mockResolvedValue([
        observationRow({
          sources: [
            { sourceId: "post_1", sourceType: "commons_post" },
            { sourceId: "post_2", sourceType: "commons_post" },
          ],
        }),
      ]);

      const result = await queryObservations({
        scopeType: "commons",
        scopeId: "cahootz",
        requestingUserId: null,
        coopId: "cahootz",
      });

      expect(result[0].sources).toEqual(["post_1", "post_2"]);
    });
  });
});
