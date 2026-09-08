import { randomBytes } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

import type { AccountAuthenticatedContext } from "../context.js";
import { accountAuthenticatedProcedure } from "../procedures/index.js";
import { validateSCBalance } from "../services/sc-validation-service.js";
import { router } from "../trpc.js";

// Unambiguous alphabet (no 0/O/1/I) for invite codes people type in by hand.
const INVITE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateInviteCode(length = 8) {
  const bytes = randomBytes(length);
  let code = "";
  for (let i = 0; i < length; i++) {
    code += INVITE_CODE_ALPHABET[bytes[i] % INVITE_CODE_ALPHABET.length];
  }
  return code;
}

function displayName(user: { name: string | null; email: string }) {
  return user.name || user.email.split("@")[0] || "Member";
}

async function requireMembership(
  db: AccountAuthenticatedContext["db"],
  groupId: string,
  userId: string,
) {
  const group = await db.group.findUnique({ where: { id: groupId } });

  if (!group) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Group not found." });
  }

  const membership = await db.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
  });

  if (!membership) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You're not a member of this group.",
    });
  }

  return group;
}

const privacySchema = z.enum(["private", "invite-only"]);

export const groupsRouter = router({
  listMine: accountAuthenticatedProcedure.query(async ({ ctx }) => {
    const context = ctx as AccountAuthenticatedContext;
    const userId = context.accountUser.id;

    const memberships = await context.db.groupMember.findMany({
      where: { userId },
      include: {
        group: { include: { _count: { select: { members: true } } } },
      },
      orderBy: { joinedAt: "desc" },
    });

    return {
      groups: memberships.map(({ group }) => ({
        id: group.id,
        name: group.name,
        purpose: group.purpose,
        privacy: group.privacy,
        memberCount: group._count.members,
        isLeader: group.leaderId === userId,
        createdAt: group.createdAt.toISOString(),
      })),
    };
  }),

  create: accountAuthenticatedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(120),
        purpose: z.string().trim().max(2000).optional(),
        privacy: privacySchema.default("invite-only"),
        coopId: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      const userId = context.accountUser.id;
      const coopId = input.coopId || "cahootz";

      const config = await context.db.coopConfig.findFirst({
        where: { coopId, isActive: true },
        orderBy: { version: "desc" },
        select: { minScBalanceToCreateGroup: true },
      });
      const minScBalance = config?.minScBalanceToCreateGroup ?? 0;

      if (minScBalance > 0) {
        const currentBalance = await validateSCBalance(userId, coopId);
        if (currentBalance < minScBalance) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `You need at least ${minScBalance} SC to create a space (current balance: ${currentBalance.toFixed(2)} SC).`,
          });
        }
      }

      let inviteCode = generateInviteCode();
      for (let attempt = 0; attempt < 5; attempt++) {
        const existing = await context.db.group.findUnique({ where: { inviteCode } });
        if (!existing) break;
        inviteCode = generateInviteCode();
      }

      const group = await context.db.$transaction(async (tx) => {
        const created = await tx.group.create({
          data: {
            coopId,
            name: input.name,
            purpose: input.purpose || null,
            privacy: input.privacy,
            inviteCode,
            leaderId: userId,
          },
        });

        await tx.groupMember.create({
          data: { groupId: created.id, userId },
        });

        return created;
      });

      return {
        group: {
          id: group.id,
          name: group.name,
          purpose: group.purpose,
          privacy: group.privacy,
          inviteCode: group.inviteCode,
          memberCount: 1,
          isLeader: true,
          createdAt: group.createdAt.toISOString(),
        },
      };
    }),

  getCreateRequirements: accountAuthenticatedProcedure
    .input(z.object({ coopId: z.string().min(1).optional() }))
    .query(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      const userId = context.accountUser.id;
      const coopId = input.coopId || "cahootz";

      const config = await context.db.coopConfig.findFirst({
        where: { coopId, isActive: true },
        orderBy: { version: "desc" },
        select: { minScBalanceToCreateGroup: true },
      });
      const minScBalance = config?.minScBalanceToCreateGroup ?? 0;

      const currentScBalance = minScBalance > 0 ? await validateSCBalance(userId, coopId) : 0;

      return {
        minScBalance,
        currentScBalance,
        canCreate: minScBalance === 0 || currentScBalance >= minScBalance,
      };
    }),

  getDetail: accountAuthenticatedProcedure
    .input(z.object({ groupId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      const userId = context.accountUser.id;

      const group = await requireMembership(context.db, input.groupId, userId);
      const isLeader = group.leaderId === userId;

      const members = await context.db.groupMember.findMany({
        where: { groupId: group.id },
        include: { user: { select: { name: true, email: true } } },
        orderBy: { joinedAt: "asc" },
      });

      return {
        group: {
          id: group.id,
          name: group.name,
          purpose: group.purpose,
          privacy: group.privacy,
          inviteCode: isLeader ? group.inviteCode : null,
          isLeader,
          createdAt: group.createdAt.toISOString(),
        },
        members: members.map((member) => ({
          userId: member.userId,
          name: displayName(member.user),
          isLeader: member.userId === group.leaderId,
          joinedAt: member.joinedAt.toISOString(),
        })),
      };
    }),

  joinByCode: accountAuthenticatedProcedure
    .input(z.object({ inviteCode: z.string().trim().min(1).max(32) }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      const userId = context.accountUser.id;

      const group = await context.db.group.findUnique({
        where: { inviteCode: input.inviteCode.toUpperCase() },
      });

      if (!group) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invalid invite code." });
      }

      await context.db.groupMember.upsert({
        where: { groupId_userId: { groupId: group.id, userId } },
        create: { groupId: group.id, userId },
        update: {},
      });

      return { groupId: group.id, name: group.name };
    }),

  regenerateInviteCode: accountAuthenticatedProcedure
    .input(z.object({ groupId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      const userId = context.accountUser.id;

      const group = await requireMembership(context.db, input.groupId, userId);
      if (group.leaderId !== userId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the group leader can regenerate the invite code.",
        });
      }

      let inviteCode = generateInviteCode();
      for (let attempt = 0; attempt < 5; attempt++) {
        const existing = await context.db.group.findUnique({ where: { inviteCode } });
        if (!existing) break;
        inviteCode = generateInviteCode();
      }

      const updated = await context.db.group.update({
        where: { id: group.id },
        data: { inviteCode },
      });

      return { inviteCode: updated.inviteCode };
    }),

  transferLeadership: accountAuthenticatedProcedure
    .input(
      z.object({
        groupId: z.string().min(1),
        newLeaderUserId: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      const userId = context.accountUser.id;

      const group = await requireMembership(context.db, input.groupId, userId);
      if (group.leaderId !== userId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the group leader can transfer leadership.",
        });
      }

      const newLeaderMembership = await context.db.groupMember.findUnique({
        where: { groupId_userId: { groupId: group.id, userId: input.newLeaderUserId } },
      });

      if (!newLeaderMembership) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That person must be a member of the group first.",
        });
      }

      await context.db.group.update({
        where: { id: group.id },
        data: { leaderId: input.newLeaderUserId },
      });

      return { success: true };
    }),

  leave: accountAuthenticatedProcedure
    .input(z.object({ groupId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      const userId = context.accountUser.id;

      const group = await requireMembership(context.db, input.groupId, userId);

      if (group.leaderId === userId) {
        const memberCount = await context.db.groupMember.count({ where: { groupId: group.id } });

        if (memberCount > 1) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Transfer leadership to someone else before leaving.",
          });
        }

        await context.db.group.delete({ where: { id: group.id } });
        return { success: true, groupDeleted: true };
      }

      await context.db.groupMember.delete({
        where: { groupId_userId: { groupId: group.id, userId } },
      });

      return { success: true, groupDeleted: false };
    }),

  listComments: accountAuthenticatedProcedure
    .input(
      z.object({
        groupId: z.string().min(1),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(30),
      }),
    )
    .query(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      const userId = context.accountUser.id;

      await requireMembership(context.db, input.groupId, userId);

      const comments = await context.db.groupComment.findMany({
        where: { groupId: input.groupId },
        orderBy: { createdAt: "asc" },
        include: { author: { select: { name: true, email: true } } },
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        take: input.limit,
      });

      const hasMore = comments.length === input.limit;

      return {
        comments: comments.map((comment) => ({
          id: comment.id,
          authorId: comment.authorId,
          author: displayName(comment.author),
          content: comment.content,
          createdAt: comment.createdAt.toISOString(),
        })),
        nextCursor: hasMore ? comments[comments.length - 1].id : null,
      };
    }),

  addComment: accountAuthenticatedProcedure
    .input(
      z.object({
        groupId: z.string().min(1),
        content: z.string().trim().min(1).max(4000),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      const userId = context.accountUser.id;

      await requireMembership(context.db, input.groupId, userId);

      const comment = await context.db.$transaction(async (tx) => {
        const created = await tx.groupComment.create({
          data: {
            groupId: input.groupId,
            authorId: userId,
            content: input.content,
          },
          include: { author: { select: { name: true, email: true } } },
        });

        await tx.group.update({
          where: { id: input.groupId },
          data: { lastActivityAt: new Date() },
        });

        return created;
      });

      return {
        comment: {
          id: comment.id,
          authorId: comment.authorId,
          author: displayName(comment.author),
          content: comment.content,
          createdAt: comment.createdAt.toISOString(),
        },
      };
    }),

  getDigest: accountAuthenticatedProcedure
    .input(
      z.object({
        groupId: z.string().min(1),
        since: z.string().datetime().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      const userId = context.accountUser.id;

      const group = await requireMembership(context.db, input.groupId, userId);
      const since = input.since ? new Date(input.since) : undefined;

      const [memberCount, commentCountSince] = await Promise.all([
        context.db.groupMember.count({ where: { groupId: input.groupId } }),
        context.db.groupComment.count({
          where: {
            groupId: input.groupId,
            ...(since ? { createdAt: { gte: since } } : {}),
          },
        }),
      ]);

      return {
        groupId: group.id,
        groupName: group.name,
        lastActivityAt: group.lastActivityAt.toISOString(),
        memberCount,
        commentCountSince,
        since: since ? since.toISOString() : null,
      };
    }),
});
