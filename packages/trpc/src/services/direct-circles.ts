import { randomBytes } from 'node:crypto';

import { TRPCError } from '@trpc/server';

import type { AccountAuthenticatedContext } from '../context.js';
import { getAgent } from '../agents/registry.js';
import { auditLogEntry } from '../lib/audit.js';
import { isSageUser } from '../lib/bot.js';
import { COMMONS_COOP_ID, ensureCommonsMembership } from '../lib/commons.js';
import { encodeMentions } from '../lib/mentions.js';
import { createNotificationAndPush } from './push-notification-service.js';

// A direct message is a private circle with exactly two members. It reuses
// circle membership for access control and GroupComment for messages, but
// never appears in circle lists, never accepts invites or codes, and is never
// mirrored into the commons feed or handed to the circle-window AI agents.
export const DIRECT_KIND = 'DIRECT';

type Db = AccountAuthenticatedContext['db'];
type Person = { id: string; name: string | null; email: string; handle: string | null };

const personSelect = { id: true, name: true, email: true, handle: true } as const;

function displayName(user: { name: string | null; email: string }) {
  return user.name || user.email.split('@')[0] || 'Member';
}

function personSummary(user: Person) {
  return { id: user.id, name: displayName(user), handle: user.handle };
}

export function directKeyFor(coopId: string, userIdA: string, userIdB: string) {
  const [first, second] = [userIdA, userIdB].sort();
  return `${coopId}:${first}:${second}`;
}

function participantIds(directKey: string) {
  const parts = directKey.split(':');
  return parts.slice(-2);
}

export function isDirectCircle(group: { kind: string }) {
  return group.kind === DIRECT_KIND;
}

export function rejectDirectCircle(group: { kind: string }, message: string) {
  if (isDirectCircle(group)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message });
  }
}

async function requireCommonsAccess(db: Db, userId: string, coopId: string) {
  if (coopId === COMMONS_COOP_ID) {
    await ensureCommonsMembership(db, userId);
    return;
  }
  const membership = await db.userCoopMembership.findUnique({
    where: { userId_coopId: { userId, coopId } },
    select: { status: true },
  });
  if (membership?.status !== 'ACTIVE') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Join this commons before messaging its members.' });
  }
}

async function isCommonsMember(db: Db, userId: string, coopId: string) {
  if (coopId === COMMONS_COOP_ID) return true;
  const membership = await db.userCoopMembership.findUnique({
    where: { userId_coopId: { userId, coopId } },
    select: { status: true },
  });
  return membership?.status === 'ACTIVE';
}

/** Loads a DIRECT circle the user belongs to, or throws. */
export async function requireDirectMembership(db: Db, groupId: string, userId: string) {
  const group = await db.group.findUnique({ where: { id: groupId } });
  if (!group || !isDirectCircle(group)) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Conversation not found.' });
  }
  const membership = await db.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
  });
  if (!membership) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Conversation not found.' });
  }
  return group;
}

/**
 * Finds or creates the one private circle shared by `userId` and
 * `otherUserId` in a commons. Re-adds either person if they had left it, so
 * a conversation is never silently one-sided.
 */
export async function openDirectCircle(
  db: Db,
  input: { coopId: string; userId: string; otherUserId: string },
) {
  const { coopId, userId, otherUserId } = input;
  if (userId === otherUserId) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Pick another member to message.' });
  }

  const other = await db.user.findUnique({
    where: { id: otherUserId },
    select: { ...personSelect, deletedAt: true, isBot: true, roles: true },
  });
  if (!other || other.deletedAt || (other.isBot && !isSageUser(other))) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Member not found.' });
  }

  await requireCommonsAccess(db, userId, coopId);
  if (!(await isCommonsMember(db, other.id, coopId))) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'That person is not a member of this commons.' });
  }

  const directKey = directKeyFor(coopId, userId, other.id);
  let group = await db.group.findUnique({ where: { directKey } });

  if (!group) {
    try {
      group = await db.$transaction(async (tx) => {
        const created = await tx.group.create({
          data: {
            coopId,
            name: 'Direct message',
            privacy: 'private',
            kind: DIRECT_KIND,
            directKey,
            // Lowercase, and joinByCode upper-cases input, so this can never
            // be redeemed as an invite code.
            inviteCode: `dm-${randomBytes(12).toString('hex')}`,
            leaderId: userId,
            members: {
              create: [
                { userId, lastReadAt: new Date() },
                { userId: other.id },
              ],
            },
          },
        });
        await tx.auditLog.create({
          data: auditLogEntry({
            actorId: userId,
            action: 'DIRECT_CIRCLE_CREATED',
            resource: 'Group',
            resourceId: created.id,
            metadata: { coopId, otherUserId: other.id },
          }),
        });
        return created;
      });
    } catch (error: any) {
      // Both people opened the conversation at the same moment.
      if (error?.code !== 'P2002') throw error;
      group = await db.group.findUnique({ where: { directKey } });
      if (!group) throw error;
    }
  }

  await ensureParticipants(db, group.id, directKey);
  return { group, other: personSummary(other), otherIsSage: isSageUser(other) };
}

async function ensureParticipants(db: Db, groupId: string, directKey: string) {
  await Promise.all(
    participantIds(directKey).map((participantId) =>
      db.groupMember.upsert({
        where: { groupId_userId: { groupId, userId: participantId } },
        create: { groupId, userId: participantId },
        update: {},
      }),
    ),
  );
}

/** Posts a message into a DIRECT circle the sender already belongs to. */
export async function sendDirectCircleMessage(
  db: Db,
  input: {
    group: { id: string; coopId: string; directKey: string | null };
    sender: { id: string; name: string | null; email: string };
    content: string;
  },
) {
  const { group, sender } = input;
  if (!group.directKey) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Conversation not found.' });
  }
  await ensureParticipants(db, group.id, group.directKey);

  const otherId = participantIds(group.directKey).find((id) => id !== sender.id)!;
  const other = await db.user.findUnique({
    where: { id: otherId },
    select: { ...personSelect, deletedAt: true, isBot: true, roles: true },
  });
  if (!other || other.deletedAt) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Member not found.' });
  }

  const { content } = await encodeMentions(db, input.content, { coopId: group.coopId });
  const now = new Date();

  const message = await db.$transaction(async (tx) => {
    const created = await tx.groupComment.create({
      data: { groupId: group.id, authorId: sender.id, content },
    });
    await tx.group.update({ where: { id: group.id }, data: { lastActivityAt: now } });
    await tx.groupMember.update({
      where: { groupId_userId: { groupId: group.id, userId: sender.id } },
      data: { lastReadAt: now },
    });
    await tx.auditLog.create({
      data: auditLogEntry({
        actorId: sender.id,
        action: 'DIRECT_MESSAGE_SENT',
        resource: 'GroupComment',
        resourceId: created.id,
        metadata: { groupId: group.id },
      }),
    });
    return created;
  });

  if (isSageUser(other)) {
    await replyAsSage(db, { group, sender, sage: other, message });
  } else if (!other.isBot) {
    void createNotificationAndPush(db, {
      userId: other.id,
      coopId: group.coopId,
      type: 'DIRECT_MESSAGE',
      title: displayName(sender),
      body: `${displayName(sender)} sent you a private message.`,
      data: { groupId: group.id, coopId: group.coopId },
    }).catch((error) => console.error('Could not send direct message notification', error));
  }

  return mapMessage(message, sender.id);
}

async function replyAsSage(
  db: Db,
  input: {
    group: { id: string; coopId: string };
    sender: { id: string; name: string | null; email: string };
    sage: { id: string };
    message: { id: string; content: string };
  },
) {
  const { group, sender, sage, message } = input;
  try {
    const agent = getAgent('sage-commons-reply');
    if (!agent) return;
    const prior = await db.groupComment.findMany({
      where: { groupId: group.id, id: { not: message.id } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    const threadContext = prior
      .reverse()
      .map((m) => `${m.authorId === sender.id ? displayName(sender) : 'Sage'}: ${m.content}`)
      .join('\n');
    const { reply } = await agent.run({
      coopId: group.coopId,
      message: message.content,
      threadContext,
    });
    await db.groupComment.create({
      data: { groupId: group.id, authorId: sage.id, content: reply },
    });
    await db.group.update({ where: { id: group.id }, data: { lastActivityAt: new Date() } });
  } catch (error) {
    console.error('Sage DM auto-reply failed:', error);
  }
}

function mapMessage(
  message: { id: string; authorId: string; content: string; createdAt: Date },
  viewerId: string,
) {
  return {
    id: message.id,
    authorId: message.authorId,
    fromMe: message.authorId === viewerId,
    body: message.content,
    createdAt: message.createdAt.toISOString(),
  };
}

/** The viewer's DM circles, newest activity first, with unread counts. */
export async function listDirectCircles(db: Db, userId: string, coopId?: string) {
  const memberships = await db.groupMember.findMany({
    where: {
      userId,
      group: { kind: DIRECT_KIND, ...(coopId ? { coopId } : {}) },
    },
    include: {
      group: {
        include: {
          members: { include: { user: { select: { ...personSelect, deletedAt: true } } } },
          comments: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      },
    },
    orderBy: { group: { lastActivityAt: 'desc' } },
    take: 50,
  });

  const threads = await Promise.all(
    memberships.map(async (membership) => {
      const { group } = membership;
      const otherMember = group.members.find((member) => member.userId !== userId);
      if (!otherMember || otherMember.user.deletedAt) return null;
      const last = group.comments[0];
      const unreadCount = await db.groupComment.count({
        where: {
          groupId: group.id,
          authorId: { not: userId },
          ...(membership.lastReadAt ? { createdAt: { gt: membership.lastReadAt } } : {}),
        },
      });
      return {
        groupId: group.id,
        coopId: group.coopId,
        person: personSummary(otherMember.user),
        preview: last?.content ?? null,
        lastMessageAt: last ? last.createdAt.toISOString() : null,
        lastMessageFromMe: last ? last.authorId === userId : false,
        unreadCount,
      };
    }),
  );

  return threads.filter((thread): thread is NonNullable<typeof thread> => thread !== null);
}

/** Latest messages in a DM circle, oldest first. */
export async function listDirectCircleMessages(
  db: Db,
  input: { groupId: string; userId: string; limit: number; before?: string },
) {
  const group = await requireDirectMembership(db, input.groupId, input.userId);
  const records = await db.groupComment.findMany({
    where: { groupId: group.id },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: input.limit + 1,
    ...(input.before ? { cursor: { id: input.before }, skip: 1 } : {}),
  });
  const hasMore = records.length > input.limit;
  const page = (hasMore ? records.slice(0, input.limit) : records).reverse();

  const members = await db.groupMember.findMany({
    where: { groupId: group.id },
    include: { user: { select: personSelect } },
  });
  const other = members.find((member) => member.userId !== input.userId);

  return {
    groupId: group.id,
    coopId: group.coopId,
    person: other ? personSummary(other.user) : null,
    messages: page.map((message) => mapMessage(message, input.userId)),
    olderCursor: hasMore ? page[0].id : null,
  };
}

export async function markDirectCircleRead(db: Db, groupId: string, userId: string) {
  await requireDirectMembership(db, groupId, userId);
  await db.groupMember.update({
    where: { groupId_userId: { groupId, userId } },
    data: { lastReadAt: new Date() },
  });
}
