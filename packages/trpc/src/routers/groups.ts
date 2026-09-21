import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import type { AgentToolContext } from '../agents/tools/index.js';
import type { AccountAuthenticatedContext } from '../context.js';
import { getAgent } from '../agents/registry.js';
import { auditLogEntry } from '../lib/audit.js';
import { hashToColorKey } from '../lib/circle-color.js';
import { generateInviteCode } from '../lib/invite-code.js';
import { accountAuthenticatedProcedure } from '../procedures/index.js';
import { queryObservations, recordObservation } from '../services/ai-memory.js';
import { validateSCBalance } from '../services/sc-validation-service.js';
import { enterChat, getChattingCounts, leaveChat, refreshChatPresence } from '../services/circle-presence.js';
import { assignWelcomeTable, getNewcomerCounts } from '../services/welcome-tables.js';
import { router } from '../trpc.js';

function displayName(user: { name: string | null; email: string }) {
  return user.name || user.email.split('@')[0] || 'Member';
}

export async function requireMembership(
  db: AccountAuthenticatedContext['db'],
  groupId: string,
  userId: string,
) {
  const group = await db.group.findUnique({ where: { id: groupId } });

  if (!group) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Group not found.' });
  }

  const membership = await db.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
  });

  if (!membership) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: "You're not a member of this group.",
    });
  }

  return group;
}

const privacySchema = z.enum(['public', 'private', 'invite-only']);

type GroupWithMemberCount = {
  id: string;
  name: string;
  purpose: string | null;
  privacy: string;
  leaderId: string;
  createdAt: Date;
  kind: string;
  welcomeTableNumber: number | null;
  welcomeTableStatus: string | null;
  capacity: number | null;
  _count: { members: number };
};

function mapCircleSummary(
  group: GroupWithMemberCount,
  userId: string,
  isMember: boolean,
  chattingCounts: Map<string, number>,
  newcomerCounts: Map<string, number>,
) {
  return {
    id: group.id,
    name: group.name,
    purpose: group.purpose,
    privacy: group.privacy,
    memberCount: group._count.members,
    isLeader: group.leaderId === userId,
    isMember,
    createdAt: group.createdAt.toISOString(),
    kind: group.kind,
    colorKey: hashToColorKey(group.id),
    chattingCount: chattingCounts.get(group.id) ?? 0,
    welcomeTableNumber: group.welcomeTableNumber,
    welcomeTableStatus: group.welcomeTableStatus,
    capacity: group.capacity,
    newcomerCount: group.kind === 'WELCOME_TABLE' ? newcomerCounts.get(group.id) ?? 0 : null,
  };
}

export const groupsRouter = router({
  listVisible: accountAuthenticatedProcedure
    .input(z.object({ coopId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      const userId = context.accountUser.id;
      if (input.coopId !== 'cahootz') {
        const membership = await context.db.userCoopMembership.findUnique({
          where: { userId_coopId: { userId, coopId: input.coopId } },
          select: { status: true },
        });
        if (membership?.status !== 'ACTIVE') {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Join this common to see its circles.' });
        }
      }

      const [memberships, publicGroups] = await Promise.all([
        context.db.groupMember.findMany({
          where: { userId, group: { coopId: input.coopId } },
          include: { group: { include: { _count: { select: { members: true } } } } },
          orderBy: { joinedAt: 'desc' },
        }),
        context.db.group.findMany({
          where: { coopId: input.coopId, privacy: 'public' },
          include: { _count: { select: { members: true } } },
          orderBy: { lastActivityAt: 'desc' },
        }),
      ]);

      const visible = new Map<string, { group: (typeof publicGroups)[number]; isMember: boolean }>();
      for (const membership of memberships) {
        visible.set(membership.group.id, { group: membership.group, isMember: true });
      }
      for (const group of publicGroups) {
        if (!visible.has(group.id)) visible.set(group.id, { group, isMember: false });
      }

      const groupIds = [...visible.keys()];
      const [chattingCounts, newcomerCounts] = await Promise.all([
        getChattingCounts(context.db, groupIds),
        getNewcomerCounts(context.db, groupIds),
      ]);

      return {
        groups: [...visible.values()].map(({ group, isMember }) =>
          mapCircleSummary(group, userId, isMember, chattingCounts, newcomerCounts),
        ),
      };
    }),

  // coopId is optional so existing "all my spaces across every commons"
  // callers (the standalone Spaces screen opened from the drawer) keep
  // working unchanged; passing it scopes the list to one commons (e.g. the
  // Circles section on a commons detail page).
  listMine: accountAuthenticatedProcedure
    .input(z.object({ coopId: z.string().min(1).optional() }).optional())
    .query(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      const userId = context.accountUser.id;
      const coopId = input?.coopId;

      const memberships = await context.db.groupMember.findMany({
        where: { userId, ...(coopId ? { group: { coopId } } : {}) },
        include: {
          group: { include: { _count: { select: { members: true } } } },
        },
        orderBy: { joinedAt: 'desc' },
      });

      const groupIds = memberships.map((m) => m.group.id);
      const [chattingCounts, newcomerCounts] = await Promise.all([
        getChattingCounts(context.db, groupIds),
        getNewcomerCounts(context.db, groupIds),
      ]);

      return {
        groups: memberships.map(({ group }) =>
          mapCircleSummary(group, userId, true, chattingCounts, newcomerCounts),
        ),
      };
    }),

  create: accountAuthenticatedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(120),
        purpose: z.string().trim().max(2000).optional(),
        privacy: privacySchema.default('invite-only'),
        coopId: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      const userId = context.accountUser.id;
      const coopId = input.coopId || 'cahootz';

      const config = await context.db.coopConfig.findFirst({
        where: { coopId, isActive: true },
        orderBy: { version: 'desc' },
        select: { minScBalanceToCreateGroup: true },
      });
      const minScBalance = config?.minScBalanceToCreateGroup ?? 0;

      if (minScBalance > 0) {
        const currentBalance = await validateSCBalance(userId, coopId);
        if (currentBalance < minScBalance) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `You need at least ${minScBalance} SC to create a space (current balance: ${currentBalance.toFixed(2)} SC).`,
          });
        }
      }

      let inviteCode = generateInviteCode();
      for (let attempt = 0; attempt < 5; attempt++) {
        const existing = await context.db.group.findUnique({
          where: { inviteCode },
        });
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

        await tx.auditLog.create({
          data: auditLogEntry({
            actorId: userId,
            action: 'GROUP_CREATED',
            resource: 'Group',
            resourceId: created.id,
            metadata: { name: created.name, privacy: created.privacy, coopId },
          }),
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
      const coopId = input.coopId || 'cahootz';

      const config = await context.db.coopConfig.findFirst({
        where: { coopId, isActive: true },
        orderBy: { version: 'desc' },
        select: { minScBalanceToCreateGroup: true },
      });
      const minScBalance = config?.minScBalanceToCreateGroup ?? 0;

      const currentScBalance =
        minScBalance > 0 ? await validateSCBalance(userId, coopId) : 0;

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

      const [members, coopConfig] = await Promise.all([
        context.db.groupMember.findMany({
          where: { groupId: group.id },
          include: { user: { select: { name: true, email: true } } },
          orderBy: { joinedAt: 'asc' },
        }),
        context.db.coopConfig.findFirst({
          where: { coopId: group.coopId, isActive: true },
          orderBy: { version: 'desc' },
          select: { name: true, slug: true },
        }),
      ]);

      return {
        group: {
          id: group.id,
          name: group.name,
          purpose: group.purpose,
          privacy: group.privacy,
          inviteCode: isLeader ? group.inviteCode : null,
          isLeader,
          createdAt: group.createdAt.toISOString(),
          coopId: group.coopId,
          coopName: coopConfig?.name || coopConfig?.slug || group.coopId,
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
    .input(
      z.object({
        inviteCode: z.string().trim().min(1).max(32),
        // Optional — set when the caller is on a commons-scoped screen (e.g.
        // "Circles in X"), so a code for a circle under a different commons
        // is rejected instead of silently joining the wrong commons.
        coopId: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      const userId = context.accountUser.id;

      const group = await context.db.group.findUnique({
        where: { inviteCode: input.inviteCode.toUpperCase() },
      });

      if (!group) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Invalid invite code.',
        });
      }

      if (group.kind === 'WELCOME_TABLE') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Welcome tables can only be joined through the welcome-table flow.',
        });
      }

      if (input.coopId && group.coopId !== input.coopId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'This invite code belongs to a circle in a different commons.',
        });
      }

      await context.db.$transaction([
        context.db.groupMember.upsert({
          where: { groupId_userId: { groupId: group.id, userId } },
          create: { groupId: group.id, userId },
          update: {},
        }),
        context.db.auditLog.create({
          data: auditLogEntry({
            actorId: userId,
            action: 'GROUP_JOINED',
            resource: 'GroupMember',
            resourceId: group.id,
          }),
        }),
      ]);

      return { groupId: group.id, name: group.name };
    }),

  joinPublic: accountAuthenticatedProcedure
    .input(z.object({ groupId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      const userId = context.accountUser.id;
      const group = await context.db.group.findUnique({ where: { id: input.groupId } });
      if (!group || group.privacy !== 'public') {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Public circle not found.' });
      }
      if (group.coopId !== 'cahootz') {
        const commonMembership = await context.db.userCoopMembership.findUnique({
          where: { userId_coopId: { userId, coopId: group.coopId } },
          select: { status: true },
        });
        if (commonMembership?.status !== 'ACTIVE') {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Join this common first.' });
        }
      }
      const existing = await context.db.groupMember.findUnique({
        where: { groupId_userId: { groupId: group.id, userId } },
      });
      if (!existing) {
        await context.db.$transaction([
          context.db.groupMember.upsert({
            where: { groupId_userId: { groupId: group.id, userId } },
            create: { groupId: group.id, userId },
            update: {},
          }),
          context.db.auditLog.create({
            data: auditLogEntry({
              actorId: userId,
              action: 'GROUP_JOINED',
              resource: 'GroupMember',
              resourceId: group.id,
              metadata: { method: 'public' },
            }),
          }),
        ]);
      }
      return { groupId: group.id, name: group.name, joined: true };
    }),

  updatePrivacy: accountAuthenticatedProcedure
    .input(z.object({
      groupId: z.string().min(1),
      privacy: z.enum(['public', 'private']),
      confirmExposeHistory: z.boolean().default(false),
    }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      const userId = context.accountUser.id;
      const group = await requireMembership(context.db, input.groupId, userId);
      if (group.kind === 'WELCOME_TABLE') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Welcome tables are managed from admin controls.' });
      }
      if (group.leaderId !== userId) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the circle leader can change privacy.' });
      }
      if (group.privacy === input.privacy) return { privacy: group.privacy };
      if (input.privacy === 'public' && !input.confirmExposeHistory) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Confirm that existing circle posts will become visible to common members.',
        });
      }
      await context.db.$transaction([
        context.db.group.update({
          where: { id: group.id },
          data: { privacy: input.privacy },
        }),
        context.db.auditLog.create({
          data: auditLogEntry({
            actorId: userId,
            action: 'GROUP_PRIVACY_CHANGED',
            resource: 'Group',
            resourceId: group.id,
            metadata: { from: group.privacy, to: input.privacy },
          }),
        }),
      ]);
      return { privacy: input.privacy };
    }),

  regenerateInviteCode: accountAuthenticatedProcedure
    .input(z.object({ groupId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      const userId = context.accountUser.id;

      const group = await requireMembership(context.db, input.groupId, userId);
      if (group.kind === 'WELCOME_TABLE') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Welcome tables are managed from admin controls.' });
      }
      if (group.leaderId !== userId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the group leader can regenerate the invite code.',
        });
      }

      let inviteCode = generateInviteCode();
      for (let attempt = 0; attempt < 5; attempt++) {
        const existing = await context.db.group.findUnique({
          where: { inviteCode },
        });
        if (!existing) break;
        inviteCode = generateInviteCode();
      }

      const [updated] = await context.db.$transaction([
        context.db.group.update({
          where: { id: group.id },
          data: { inviteCode },
        }),
        context.db.auditLog.create({
          data: auditLogEntry({
            actorId: userId,
            action: 'GROUP_INVITE_CODE_REGENERATED',
            resource: 'Group',
            resourceId: group.id,
          }),
        }),
      ]);

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
      if (group.kind === 'WELCOME_TABLE') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Welcome tables are managed from admin controls.' });
      }
      if (group.leaderId !== userId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the group leader can transfer leadership.',
        });
      }

      const newLeaderMembership = await context.db.groupMember.findUnique({
        where: {
          groupId_userId: { groupId: group.id, userId: input.newLeaderUserId },
        },
      });

      if (!newLeaderMembership) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'That person must be a member of the group first.',
        });
      }

      await context.db.$transaction([
        context.db.group.update({
          where: { id: group.id },
          data: { leaderId: input.newLeaderUserId },
        }),
        context.db.auditLog.create({
          data: auditLogEntry({
            actorId: userId,
            action: 'GROUP_LEADERSHIP_TRANSFERRED',
            resource: 'Group',
            resourceId: group.id,
            metadata: {
              previousLeaderId: userId,
              newLeaderId: input.newLeaderUserId,
            },
          }),
        }),
      ]);

      return { success: true };
    }),

  leave: accountAuthenticatedProcedure
    .input(z.object({ groupId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      const userId = context.accountUser.id;

      const group = await requireMembership(context.db, input.groupId, userId);

      if (group.kind === 'WELCOME_TABLE') {
        // leaderId isn't necessarily the guide here - when no guide is
        // configured yet, the newcomer who triggered auto-creation holds
        // that slot as a placeholder (see services/welcome-tables.ts) and
        // must still be able to leave normally. Only an actual GUIDE-role
        // member is blocked from self-service leaving.
        const membership = await context.db.groupMember.findUnique({
          where: { groupId_userId: { groupId: group.id, userId } },
        });
        if (membership?.role === 'GUIDE') {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Welcome tables are retired from admin controls, not by the guide leaving.',
          });
        }

        await context.db.$transaction([
          context.db.groupMember.delete({
            where: { groupId_userId: { groupId: group.id, userId } },
          }),
          context.db.auditLog.create({
            data: auditLogEntry({
              actorId: userId,
              action: 'GROUP_LEFT',
              resource: 'GroupMember',
              resourceId: group.id,
            }),
          }),
        ]);

        return { success: true, groupDeleted: false };
      }

      if (group.leaderId === userId) {
        const memberCount = await context.db.groupMember.count({
          where: { groupId: group.id },
        });

        if (memberCount > 1) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Transfer leadership to someone else before leaving.',
          });
        }

        await context.db.$transaction([
          context.db.auditLog.create({
            data: auditLogEntry({
              actorId: userId,
              action: 'GROUP_DELETED',
              resource: 'Group',
              resourceId: group.id,
              metadata: { reason: 'leader_left_as_sole_member' },
            }),
          }),
          context.db.group.delete({ where: { id: group.id } }),
        ]);
        return { success: true, groupDeleted: true };
      }

      await context.db.$transaction([
        context.db.groupMember.delete({
          where: { groupId_userId: { groupId: group.id, userId } },
        }),
        context.db.auditLog.create({
          data: auditLogEntry({
            actorId: userId,
            action: 'GROUP_LEFT',
            resource: 'GroupMember',
            resourceId: group.id,
          }),
        }),
      ]);

      return { success: true, groupDeleted: false };
    }),

  assignWelcomeTable: accountAuthenticatedProcedure
    .input(z.object({ coopId: z.string().min(1).default('cahootz') }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      const userId = context.accountUser.id;

      const group = await assignWelcomeTable(context.db, input.coopId, userId);

      return {
        groupId: group.id,
        name: group.name,
        welcomeTableNumber: group.welcomeTableNumber,
      };
    }),

  enterChat: accountAuthenticatedProcedure
    .input(z.object({ groupId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      const userId = context.accountUser.id;

      await requireMembership(context.db, input.groupId, userId);
      await enterChat(context.db, input.groupId, userId);

      return { success: true };
    }),

  refreshChatPresence: accountAuthenticatedProcedure
    .input(z.object({ groupId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      const userId = context.accountUser.id;

      await refreshChatPresence(context.db, input.groupId, userId);

      return { success: true };
    }),

  leaveChat: accountAuthenticatedProcedure
    .input(z.object({ groupId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      const userId = context.accountUser.id;

      await leaveChat(context.db, input.groupId, userId);

      return { success: true };
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
        orderBy: { createdAt: 'asc' },
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

      const group = await requireMembership(context.db, input.groupId, userId);

      const comment = await context.db.$transaction(async (tx) => {
        const created = await tx.groupComment.create({
          data: {
            groupId: input.groupId,
            authorId: userId,
            content: input.content,
          },
          include: { author: { select: { name: true, email: true } } },
        });

        // Older app versions still write circle messages here. Mirror them into
        // the unified feed so they remain visible alongside new circle posts.
        await tx.commonsPost.create({
          data: {
            id: `circle:${created.id}`,
            coopId: group.coopId,
            circleId: input.groupId,
            authorId: userId,
            title: input.content.slice(0, 120),
            content: input.content,
            tag: 'Social',
            classification: 'social',
            createdAt: created.createdAt,
          },
        });

        await tx.group.update({
          where: { id: input.groupId },
          data: { lastActivityAt: new Date() },
        });

        await tx.auditLog.create({
          data: auditLogEntry({
            actorId: userId,
            action: 'GROUP_COMMENT_ADDED',
            resource: 'GroupComment',
            resourceId: created.id,
            metadata: { groupId: input.groupId },
          }),
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

  // AI-generated companion to getDigest above - touches all four memory
  // layers: Group/GroupComment (Layer 1, already read elsewhere), AuditLog
  // (Layer 2, populated by the mutations above), KnowledgeDocument search +
  // the previous digest's AIObservation (Layers 3/4, via tools bound below),
  // then writes a new AIObservation (Layer 4). Uses the exact same shared
  // Community Observer agent as commons.ts's post classification - just a
  // different `task`/`content`/`allowedTypes`.
  getAiDigest: accountAuthenticatedProcedure
    .input(z.object({ groupId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      const userId = context.accountUser.id;

      const group = await requireMembership(context.db, input.groupId, userId);

      const agent = getAgent('community-observer');
      if (!agent || !process.env.OPENAI_API_KEY) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'AI digest is not available right now.',
        });
      }

      const priorObservations = await queryObservations({
        scopeType: 'circle',
        scopeId: group.id,
        requestingUserId: userId,
        coopId: group.coopId,
      });
      const priorDigest = priorObservations.find(
        (o) => o.type === 'circle_digest_summary',
      );

      const [recentComments, recentEvents] = await Promise.all([
        context.db.groupComment.findMany({
          where: { groupId: group.id },
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: { author: { select: { name: true, email: true } } },
        }),
        context.db.auditLog.findMany({
          where: { resourceId: group.id },
          orderBy: { occurredAt: 'desc' },
          take: 20,
        }),
      ]);

      const content = [
        `Circle: ${group.name}`,
        priorDigest
          ? `Previous digest (${priorDigest.createdAt}): ${priorDigest.summary}`
          : 'No previous digest exists for this circle yet.',
        'Recent events (most recent first):',
        recentEvents
          .map((e) => `- ${e.occurredAt.toISOString()}: ${e.action}`)
          .join('\n') || '(none)',
        'Recent comments (most recent first):',
        recentComments
          .map((c) => `- ${displayName(c.author)}: ${c.content}`)
          .join('\n') || '(none)',
      ].join('\n\n');

      const toolCtx: AgentToolContext = {
        db: context.db,
        requestingUserId: userId,
        coopId: group.coopId,
      };

      const output = await agent.run(
        {
          coopId: group.coopId,
          task: priorDigest
            ? "Summarize what's changed in this circle since the previous digest - reference it explicitly rather than restating everything."
            : 'Summarize recent activity in this circle for a first digest.',
          content,
          allowedTypes: ['circle_digest_summary'],
        },
        toolCtx,
      );

      const observation = await recordObservation({
        type: 'circle_digest_summary',
        scopeType: 'circle',
        scopeId: group.id,
        confidence: output.confidence,
        summary: output.summary,
        details: {},
        sources: [
          ...recentEvents.map((e) => ({ type: 'audit_log', id: e.id })),
          ...recentComments.map((c) => ({ type: 'group_comment', id: c.id })),
        ],
        visibility: 'CIRCLE',
        generatedByAgentKey: 'community-observer',
      });

      return {
        digest: {
          id: observation.id,
          summary: observation.summary,
          confidence: observation.confidence,
          createdAt: observation.createdAt.toISOString(),
        },
      };
    }),
});
