import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@repo/db';

import { groupsRouter } from '../routers/groups.js';
import { createNotificationAndPush } from '../services/push-notification-service.js';
import { validateSCBalance } from '../services/sc-validation-service.js';

const mockDb = db as any;

vi.mock('../services/sc-validation-service.js', () => ({
  validateSCBalance: vi.fn().mockResolvedValue(0),
}));

vi.mock('../services/push-notification-service.js', () => ({
  createNotificationAndPush: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/bot.js', () => ({
  ensureSageBotUser: vi.fn().mockResolvedValue({ id: 'sage_1' }),
}));

vi.mock('../services/push-notification-service.js', () => ({
  createNotificationAndPush: vi.fn().mockResolvedValue({}),
}));

// Real class for Agent (per project convention), real-enough run() for the
// shared Community Observer agent used by getAiDigest.
vi.mock('@openai/agents', () => {
  class MockAgent {
    constructor(_opts: any) {}
  }
  return {
    Agent: MockAgent,
    run: vi.fn().mockResolvedValue({
      finalOutput: {
        type: 'circle_digest_summary',
        confidence: 0.75,
        summary:
          'Two members joined and leadership transferred since last digest.',
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
  id: 'user_1',
  email: 'alice@example.com',
  name: 'Alice',
  phone: '+15555550123',
  roles: ['member'],
  status: 'ACTIVE',
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
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockImplementation(({ data }: any) => ({
        id: 'group_1',
        inviteCode: data.inviteCode,
        coopId: data.coopId,
        name: data.name,
        purpose: data.purpose,
        privacy: data.privacy,
        leaderId: data.leaderId,
        lastActivityAt: new Date('2026-09-08T00:00:00.000Z'),
        createdAt: new Date('2026-09-08T00:00:00.000Z'),
      })),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
      ...overrides.group,
    },
    groupMember: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ groupId: 'group_1', userId: ACTIVE_USER.id }),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(3),
      groupBy: vi.fn().mockResolvedValue([]),
      ...overrides.groupMember,
    },
    circleChatPresence: {
      upsert: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
      ...overrides.circleChatPresence,
    },
    welcomeTableConfig: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      ...overrides.welcomeTableConfig,
    },
    userCoopMembership: {
      findUnique: vi.fn().mockResolvedValue({ status: 'ACTIVE' }),
      ...overrides.userCoopMembership,
    },
    groupComment: {
      create: vi.fn().mockImplementation(({ data }: any) => ({
        id: 'comment_1',
        groupId: data.groupId,
        authorId: data.authorId,
        content: data.content,
        createdAt: new Date('2026-09-08T00:00:00.000Z'),
        author: { name: ACTIVE_USER.name, email: ACTIVE_USER.email },
      })),
      count: vi.fn().mockResolvedValue(7),
      ...overrides.groupComment,
    },
    commonsPost: {
      create: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue(null),
      ...overrides.commonsPost,
    },
    commonsComment: {
      create: vi.fn().mockResolvedValue({ id: 'comment_sage_1' }),
      ...overrides.commonsComment,
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
      ...overrides.auditLog,
    },
    session: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'session_1',
        userId: ACTIVE_USER.id,
        token: 'token_1',
        isRevoked: false,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      }),
      update: vi.fn().mockResolvedValue({}),
      ...overrides.session,
    },
    user: {
      findUnique: vi.fn().mockResolvedValue(ACTIVE_USER),
      update: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
      ...overrides.user,
    },
    groupInvite: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue({ id: 'invite_1' }),
      update: vi.fn().mockResolvedValue({}),
      ...overrides.groupInvite,
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
    req: { headers: { 'x-session-token': 'token_1' } } as any,
    res: {} as any,
    coopId: undefined,
  });
}

describe('groupsRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listMine', () => {
    it('returns every group the caller is a member of when no coopId is given', async () => {
      const db = makeDb({
        groupMember: {
          findMany: vi.fn().mockResolvedValue([
            {
              group: {
                id: 'group_1',
                name: 'Block Club',
                purpose: null,
                privacy: 'invite-only',
                leaderId: ACTIVE_USER.id,
                createdAt: new Date('2026-09-08T00:00:00.000Z'),
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
      expect(result.groups[0].id).toBe('group_1');
    });

    it('scopes the query to a single commons when coopId is given', async () => {
      const db = makeDb();

      await callerFor(db).listMine({ coopId: 'artists' });

      expect(db.groupMember.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: ACTIVE_USER.id, group: { coopId: 'artists' } },
        }),
      );
    });
  });

  describe('listVisible', () => {
    it('returns joined private circles and public circles, without duplicates', async () => {
      const date = new Date('2026-09-08T00:00:00.000Z');
      const joined = { id: 'joined', name: 'Joined', purpose: null, privacy: 'invite-only', leaderId: ACTIVE_USER.id, createdAt: date, _count: { members: 2 } };
      const publicCircle = { id: 'public', name: 'Open Circle', purpose: null, privacy: 'public', leaderId: 'another-user', createdAt: date, _count: { members: 4 } };
      const db = makeDb({
        groupMember: { findMany: vi.fn().mockResolvedValue([{ group: joined }, { group: publicCircle }]) },
        group: { findMany: vi.fn().mockResolvedValue([publicCircle]) },
      });

      const result = await callerFor(db).listVisible({ coopId: 'artists' });

      expect(db.group.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { coopId: 'artists', privacy: 'public' } }));
      expect(result.groups).toEqual([
        expect.objectContaining({ id: 'joined', isMember: true }),
        expect.objectContaining({ id: 'public', isMember: true }),
      ]);
    });

    it('includes an unjoined public circle but never queries unjoined private circles', async () => {
      const publicCircle = { id: 'public', name: 'Open Circle', purpose: null, privacy: 'public', leaderId: 'another-user', createdAt: new Date(), _count: { members: 4 } };
      const db = makeDb({ group: { findMany: vi.fn().mockResolvedValue([publicCircle]) } });

      const result = await callerFor(db).listVisible({ coopId: 'artists' });

      expect(result.groups).toEqual([expect.objectContaining({ id: 'public', isMember: false })]);
      expect(db.group.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { coopId: 'artists', privacy: 'public' } }));
    });

    it('does not reveal circles in a common the caller has not joined', async () => {
      const db = makeDb({
        userCoopMembership: { findUnique: vi.fn().mockResolvedValue(null) },
      });

      await expect(callerFor(db).listVisible({ coopId: 'artists' })).rejects.toThrow('Join this common');
      expect(db.group.findMany).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('can create a public circle without changing the invite-only default', async () => {
      const db = makeDb();

      await callerFor(db).create({ name: 'Open Garden', privacy: 'public' });

      expect(db.group.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ privacy: 'public' }),
      }));
    });

    it('keeps a circle private when that option is selected', async () => {
      const db = makeDb();

      await callerFor(db).create({ name: 'Planning Team', privacy: 'private' });

      expect(db.group.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ privacy: 'private' }),
      }));
    });

    it('succeeds with no CoopConfig row (default, no gate)', async () => {
      const db = makeDb();

      const result = await callerFor(db).create({ name: 'Block Club' });

      expect(result.group.name).toBe('Block Club');
      expect(validateSCBalance).not.toHaveBeenCalled();
      expect(db.group.create).toHaveBeenCalled();
      expect(db.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorId: ACTIVE_USER.id,
          action: 'GROUP_CREATED',
          resource: 'Group',
          resourceId: 'group_1',
        }),
      });
    });

    it('succeeds when minScBalanceToCreateGroup is 0', async () => {
      const db = makeDb({
        coopConfig: {
          findFirst: vi
            .fn()
            .mockResolvedValue({ minScBalanceToCreateGroup: 0 }),
        },
      });

      const result = await callerFor(db).create({ name: 'Block Club' });

      expect(result.group.name).toBe('Block Club');
      expect(validateSCBalance).not.toHaveBeenCalled();
    });

    it("throws FORBIDDEN when the caller's SC balance is below the configured minimum", async () => {
      const db = makeDb({
        coopConfig: {
          findFirst: vi
            .fn()
            .mockResolvedValue({ minScBalanceToCreateGroup: 10 }),
        },
      });
      vi.mocked(validateSCBalance).mockResolvedValueOnce(5);

      await expect(
        callerFor(db).create({ name: 'Block Club' }),
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(db.group.create).not.toHaveBeenCalled();
    });

    it("succeeds when the caller's SC balance meets the configured minimum", async () => {
      const db = makeDb({
        coopConfig: {
          findFirst: vi
            .fn()
            .mockResolvedValue({ minScBalanceToCreateGroup: 10 }),
        },
      });
      vi.mocked(validateSCBalance).mockResolvedValueOnce(10);

      const result = await callerFor(db).create({ name: 'Block Club' });

      expect(result.group.name).toBe('Block Club');
      expect(db.group.create).toHaveBeenCalled();
    });
  });

  describe('getCreateRequirements', () => {
    it('skips the on-chain balance check when no gate is configured', async () => {
      const db = makeDb();

      const result = await callerFor(db).getCreateRequirements({});

      expect(result).toEqual({
        minScBalance: 0,
        currentScBalance: 0,
        canCreate: true,
      });
      expect(validateSCBalance).not.toHaveBeenCalled();
    });

    it('reports canCreate: false when balance is short', async () => {
      const db = makeDb({
        coopConfig: {
          findFirst: vi
            .fn()
            .mockResolvedValue({ minScBalanceToCreateGroup: 10 }),
        },
      });
      vi.mocked(validateSCBalance).mockResolvedValueOnce(4);

      const result = await callerFor(db).getCreateRequirements({});

      expect(result).toEqual({
        minScBalance: 10,
        currentScBalance: 4,
        canCreate: false,
      });
    });
  });

  describe('getDetail', () => {
    it('includes the commons this circle belongs to', async () => {
      const db = makeDb({
        group: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'group_1',
            name: 'Block Club',
            purpose: null,
            privacy: 'invite-only',
            leaderId: ACTIVE_USER.id,
            coopId: 'artists',
            createdAt: new Date('2026-09-08T00:00:00.000Z'),
          }),
        },
        coopConfig: {
          findFirst: vi
            .fn()
            .mockResolvedValue({ name: 'Artists Commons', slug: 'artists' }),
        },
        groupMember: {
          findUnique: vi
            .fn()
            .mockResolvedValue({ groupId: 'group_1', userId: ACTIVE_USER.id }),
          findMany: vi.fn().mockResolvedValue([]),
        },
      });

      const result = await callerFor(db).getDetail({ groupId: 'group_1' });

      expect(result.group.coopId).toBe('artists');
      expect(result.group.coopName).toBe('Artists Commons');
    });

    it('falls back to the raw coopId when no CoopConfig name is published', async () => {
      const db = makeDb({
        group: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'group_1',
            name: 'Block Club',
            purpose: null,
            privacy: 'invite-only',
            leaderId: ACTIVE_USER.id,
            coopId: 'artists',
            createdAt: new Date('2026-09-08T00:00:00.000Z'),
          }),
        },
        coopConfig: { findFirst: vi.fn().mockResolvedValue(null) },
        groupMember: {
          findUnique: vi
            .fn()
            .mockResolvedValue({ groupId: 'group_1', userId: ACTIVE_USER.id }),
          findMany: vi.fn().mockResolvedValue([]),
        },
      });

      const result = await callerFor(db).getDetail({ groupId: 'group_1' });

      expect(result.group.coopName).toBe('artists');
    });
  });

  describe('circle invitations', () => {
    const LED_GROUP = {
      id: 'group_1',
      name: 'Block Club',
      purpose: null,
      privacy: 'private',
      kind: 'STANDARD',
      leaderId: ACTIVE_USER.id,
      coopId: 'artists',
      createdAt: new Date('2026-09-08T00:00:00.000Z'),
    };
    const INVITEE = { id: 'user_2', deletedAt: null, isBot: false };

    // First groupMember.findUnique is the caller's membership check; the
    // second is "is the invitee already a member?".
    function memberLookup(inviteeIsMember = false) {
      return vi
        .fn()
        .mockResolvedValueOnce({ groupId: 'group_1', userId: ACTIVE_USER.id })
        .mockResolvedValueOnce(inviteeIsMember ? { groupId: 'group_1', userId: 'user_2' } : null);
    }

    function userLookup() {
      return vi.fn().mockImplementation(({ where }: any) =>
        where.id === INVITEE.id ? INVITEE : ACTIVE_USER,
      );
    }

    it('searchInvitees only returns commons members outside the circle and flags pending invites', async () => {
      const db = makeDb({
        group: { findUnique: vi.fn().mockResolvedValue(LED_GROUP) },
        user: {
          findUnique: vi.fn().mockResolvedValue(ACTIVE_USER),
          findMany: vi.fn().mockResolvedValue([
            { id: 'user_2', name: 'Bob', email: 'bob@example.com', handle: 'bob' },
            { id: 'user_3', name: null, email: 'carol@example.com', handle: 'carol' },
          ]),
        },
        groupInvite: {
          findMany: vi.fn().mockResolvedValue([{ inviteeId: 'user_2' }]),
        },
      });

      const result = await callerFor(db).searchInvitees({ groupId: 'group_1', query: 'o' });

      expect(db.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deletedAt: null,
            isBot: false,
            groupMemberships: { none: { groupId: 'group_1' } },
            memberships: { some: { coopId: 'artists', status: 'ACTIVE' } },
          }),
        }),
      );
      expect(result.people).toEqual([
        { userId: 'user_2', name: 'Bob', handle: 'bob', invited: true },
        { userId: 'user_3', name: 'carol', handle: 'carol', invited: false },
      ]);
    });

    it('searchInvitees is limited to the circle leader', async () => {
      const db = makeDb({
        group: { findUnique: vi.fn().mockResolvedValue({ ...LED_GROUP, leaderId: 'someone_else' }) },
      });

      await expect(
        callerFor(db).searchInvitees({ groupId: 'group_1', query: 'bob' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(db.user.findMany).not.toHaveBeenCalled();
    });

    it('invite creates a pending invite, audits it, and notifies the invitee', async () => {
      const db = makeDb({
        group: { findUnique: vi.fn().mockResolvedValue(LED_GROUP) },
        groupMember: { findUnique: memberLookup() },
        user: { findUnique: userLookup() },
      });

      const result = await callerFor(db).invite({ groupId: 'group_1', userId: 'user_2' });

      expect(result).toEqual({ inviteId: 'invite_1', alreadyInvited: false });
      expect(db.groupInvite.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: { groupId: 'group_1', inviteeId: 'user_2', inviterId: ACTIVE_USER.id },
        }),
      );
      expect(db.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'GROUP_INVITE_SENT', resourceId: 'group_1' }),
      });
      expect(createNotificationAndPush).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          userId: 'user_2',
          coopId: 'artists',
          type: 'CIRCLE_INVITATION',
          data: { groupId: 'group_1', inviteId: 'invite_1', coopId: 'artists' },
        }),
      );
      expect(db.groupMember.upsert).not.toHaveBeenCalled();
    });

    it('invite rejects people who are not members of the commons', async () => {
      const db = makeDb({
        group: { findUnique: vi.fn().mockResolvedValue(LED_GROUP) },
        groupMember: { findUnique: memberLookup() },
        user: { findUnique: userLookup() },
        userCoopMembership: {
          findUnique: vi.fn().mockImplementation(({ where }: any) =>
            where.userId_coopId.userId === 'user_2' ? null : { status: 'ACTIVE' },
          ),
        },
      });

      await expect(
        callerFor(db).invite({ groupId: 'group_1', userId: 'user_2' }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(db.groupInvite.upsert).not.toHaveBeenCalled();
    });

    it('invite rejects existing circle members', async () => {
      const db = makeDb({
        group: { findUnique: vi.fn().mockResolvedValue(LED_GROUP) },
        groupMember: { findUnique: memberLookup(true) },
        user: { findUnique: userLookup() },
      });

      await expect(
        callerFor(db).invite({ groupId: 'group_1', userId: 'user_2' }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });

    it('invite is idempotent for an already-pending invite and does not re-notify', async () => {
      const db = makeDb({
        group: { findUnique: vi.fn().mockResolvedValue(LED_GROUP) },
        groupMember: { findUnique: memberLookup() },
        user: { findUnique: userLookup() },
        groupInvite: {
          findUnique: vi.fn().mockResolvedValue({ id: 'invite_9', status: 'PENDING' }),
        },
      });

      const result = await callerFor(db).invite({ groupId: 'group_1', userId: 'user_2' });

      expect(result).toEqual({ inviteId: 'invite_9', alreadyInvited: true });
      expect(db.groupInvite.upsert).not.toHaveBeenCalled();
      expect(createNotificationAndPush).not.toHaveBeenCalled();
    });

    it('invite is not available for welcome lounges', async () => {
      const db = makeDb({
        group: { findUnique: vi.fn().mockResolvedValue({ ...LED_GROUP, kind: 'WELCOME_TABLE' }) },
      });

      await expect(
        callerFor(db).invite({ groupId: 'group_1', userId: 'user_2' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('respondToInvite accept adds the invitee as a member', async () => {
      const db = makeDb({
        groupInvite: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'invite_1',
            groupId: 'group_1',
            inviteeId: ACTIVE_USER.id,
            inviterId: 'leader_1',
            status: 'PENDING',
            group: { coopId: 'artists' },
          }),
        },
      });

      const result = await callerFor(db).respondToInvite({ inviteId: 'invite_1', accept: true });

      expect(result).toEqual({ groupId: 'group_1', coopId: 'artists', accepted: true });
      expect(db.groupInvite.update).toHaveBeenCalledWith({
        where: { id: 'invite_1' },
        data: { status: 'ACCEPTED', respondedAt: expect.any(Date) },
      });
      expect(db.groupMember.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: { groupId: 'group_1', userId: ACTIVE_USER.id } }),
      );
    });

    it('respondToInvite decline does not add a membership', async () => {
      const db = makeDb({
        groupInvite: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'invite_1',
            groupId: 'group_1',
            inviteeId: ACTIVE_USER.id,
            status: 'PENDING',
            group: { coopId: 'artists' },
          }),
        },
      });

      const result = await callerFor(db).respondToInvite({ inviteId: 'invite_1', accept: false });

      expect(result.accepted).toBe(false);
      expect(db.groupInvite.update).toHaveBeenCalledWith({
        where: { id: 'invite_1' },
        data: { status: 'DECLINED', respondedAt: expect.any(Date) },
      });
      expect(db.groupMember.upsert).not.toHaveBeenCalled();
    });

    it("respondToInvite rejects someone else's invite", async () => {
      const db = makeDb({
        groupInvite: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'invite_1',
            groupId: 'group_1',
            inviteeId: 'user_2',
            status: 'PENDING',
            group: { coopId: 'artists' },
          }),
        },
      });

      await expect(
        callerFor(db).respondToInvite({ inviteId: 'invite_1', accept: true }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(db.groupMember.upsert).not.toHaveBeenCalled();
    });

    it('revokeInvite marks a pending invite revoked for the leader', async () => {
      const db = makeDb({
        group: { findUnique: vi.fn().mockResolvedValue(LED_GROUP) },
        groupInvite: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'invite_1',
            groupId: 'group_1',
            inviteeId: 'user_2',
            status: 'PENDING',
          }),
        },
      });

      await callerFor(db).revokeInvite({ inviteId: 'invite_1' });

      expect(db.groupInvite.update).toHaveBeenCalledWith({
        where: { id: 'invite_1' },
        data: { status: 'REVOKED', respondedAt: expect.any(Date) },
      });
    });

    it('getDetail lists pending invites for the leader and no longer exposes the invite code', async () => {
      const db = makeDb({
        group: { findUnique: vi.fn().mockResolvedValue({ ...LED_GROUP, inviteCode: 'ABCD1234' }) },
        groupInvite: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'invite_1',
              inviteeId: 'user_2',
              createdAt: new Date('2026-09-20T00:00:00.000Z'),
              invitee: { name: 'Bob', email: 'bob@example.com' },
            },
          ]),
        },
      });

      const result = await callerFor(db).getDetail({ groupId: 'group_1' });

      expect(result.group.inviteCode).toBeNull();
      expect(result.pendingInvites).toEqual([
        { inviteId: 'invite_1', userId: 'user_2', name: 'Bob', invitedAt: '2026-09-20T00:00:00.000Z' },
      ]);
    });
  });

  describe('addComment', () => {
    it("bumps the group's lastActivityAt when a comment is posted", async () => {
      const db = makeDb({
        group: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'group_1',
            coopId: 'artists',
            leaderId: ACTIVE_USER.id,
          }),
        },
      });

      await callerFor(db).addComment({ groupId: 'group_1', content: 'hello' });

      expect(db.group.update).toHaveBeenCalledWith({
        where: { id: 'group_1' },
        data: { lastActivityAt: expect.any(Date) },
      });
      expect(db.commonsPost.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: 'circle:comment_1',
          coopId: 'artists',
          circleId: 'group_1',
          content: 'hello',
        }),
      });
      expect(db.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorId: ACTIVE_USER.id,
          action: 'GROUP_COMMENT_ADDED',
          resource: 'GroupComment',
          resourceId: 'comment_1',
        }),
      });
    });
  });

  describe('joinPublic', () => {
    it('joins a public circle and records membership', async () => {
      const db = makeDb({
        group: { findUnique: vi.fn().mockResolvedValue({ id: 'group_1', coopId: 'artists', privacy: 'public', name: 'Open Garden' }) },
        groupMember: { findUnique: vi.fn().mockResolvedValue(null) },
      });

      const result = await callerFor(db).joinPublic({ groupId: 'group_1' });

      expect(result.joined).toBe(true);
      expect(db.groupMember.upsert).toHaveBeenCalledWith(expect.objectContaining({
        create: { groupId: 'group_1', userId: ACTIVE_USER.id },
      }));
    });

    it('does not let a nonmember join a private circle by its ID', async () => {
      const db = makeDb({
        group: { findUnique: vi.fn().mockResolvedValue({ id: 'group_1', coopId: 'artists', privacy: 'private' }) },
      });

      await expect(callerFor(db).joinPublic({ groupId: 'group_1' })).rejects.toThrow('Public circle not found');
      expect(db.groupMember.upsert).not.toHaveBeenCalled();
    });

    it('requires membership in the parent common before joining', async () => {
      const db = makeDb({
        group: { findUnique: vi.fn().mockResolvedValue({ id: 'group_1', coopId: 'artists', privacy: 'public' }) },
        userCoopMembership: { findUnique: vi.fn().mockResolvedValue(null) },
      });

      await expect(callerFor(db).joinPublic({ groupId: 'group_1' })).rejects.toThrow('Join this common first');
      expect(db.groupMember.upsert).not.toHaveBeenCalled();
    });
  });

  describe('updatePrivacy', () => {
    it('requires a leader and explicit confirmation before exposing private history', async () => {
      const db = makeDb({
        group: { findUnique: vi.fn().mockResolvedValue({ id: 'group_1', leaderId: ACTIVE_USER.id, privacy: 'private' }) },
      });

      await expect(callerFor(db).updatePrivacy({ groupId: 'group_1', privacy: 'public' })).rejects.toThrow('Confirm that existing circle posts');
      expect(db.group.update).not.toHaveBeenCalled();
    });

    it('lets the leader make the circle public after confirmation', async () => {
      const db = makeDb({
        group: { findUnique: vi.fn().mockResolvedValue({ id: 'group_1', leaderId: ACTIVE_USER.id, privacy: 'private' }) },
      });

      const result = await callerFor(db).updatePrivacy({ groupId: 'group_1', privacy: 'public', confirmExposeHistory: true });

      expect(result.privacy).toBe('public');
      expect(db.group.update).toHaveBeenCalledWith({ where: { id: 'group_1' }, data: { privacy: 'public' } });
    });

    it('does not let another member change privacy', async () => {
      const db = makeDb({
        group: { findUnique: vi.fn().mockResolvedValue({ id: 'group_1', leaderId: 'another-user', privacy: 'public' }) },
      });

      await expect(callerFor(db).updatePrivacy({ groupId: 'group_1', privacy: 'private' })).rejects.toThrow('Only the circle leader');
    });
  });

  describe('joinByCode', () => {
    it('adds the caller as a member and logs GROUP_JOINED', async () => {
      const db = makeDb({
        group: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'group_1',
            name: 'Block Club',
            inviteCode: 'ABCD1234',
          }),
        },
      });

      const result = await callerFor(db).joinByCode({ inviteCode: 'abcd1234' });

      expect(result).toEqual({ groupId: 'group_1', name: 'Block Club' });
      expect(db.groupMember.upsert).toHaveBeenCalled();
      expect(db.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorId: ACTIVE_USER.id,
          action: 'GROUP_JOINED',
          resource: 'GroupMember',
          resourceId: 'group_1',
        }),
      });
    });

    it("joins when the invite code's group matches the given coopId", async () => {
      const db = makeDb({
        group: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'group_1',
            name: 'Block Club',
            coopId: 'cahootz',
            inviteCode: 'ABCD1234',
          }),
        },
      });

      const result = await callerFor(db).joinByCode({
        inviteCode: 'abcd1234',
        coopId: 'cahootz',
      });

      expect(result).toEqual({ groupId: 'group_1', name: 'Block Club' });
      expect(db.groupMember.upsert).toHaveBeenCalled();
    });

    it('rejects a code for a circle in a different commons than the given coopId', async () => {
      const db = makeDb({
        group: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'group_1',
            name: 'Block Club',
            coopId: 'cahootz',
            inviteCode: 'ABCD1234',
          }),
        },
      });

      await expect(
        callerFor(db).joinByCode({ inviteCode: 'abcd1234', coopId: 'artists' }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

      expect(db.groupMember.upsert).not.toHaveBeenCalled();
    });
  });

  describe('regenerateInviteCode', () => {
    it('regenerates the code and logs GROUP_INVITE_CODE_REGENERATED', async () => {
      const db = makeDb({
        group: {
          findUnique: vi
            .fn()
            .mockResolvedValueOnce({ id: 'group_1', leaderId: ACTIVE_USER.id }) // requireMembership
            .mockResolvedValueOnce(null), // uniqueness check for the new code
          update: vi.fn().mockResolvedValue({ inviteCode: 'NEWCODE1' }),
        },
      });

      const result = await callerFor(db).regenerateInviteCode({
        groupId: 'group_1',
      });

      expect(result).toEqual({ inviteCode: 'NEWCODE1' });
      expect(db.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorId: ACTIVE_USER.id,
          action: 'GROUP_INVITE_CODE_REGENERATED',
          resource: 'Group',
          resourceId: 'group_1',
        }),
      });
    });
  });

  describe('transferLeadership', () => {
    it('transfers leadership and logs GROUP_LEADERSHIP_TRANSFERRED', async () => {
      const db = makeDb({
        group: {
          findUnique: vi
            .fn()
            .mockResolvedValue({ id: 'group_1', leaderId: ACTIVE_USER.id }),
        },
        groupMember: {
          findUnique: vi
            .fn()
            .mockResolvedValue({ groupId: 'group_1', userId: 'user_2' }),
        },
      });

      const result = await callerFor(db).transferLeadership({
        groupId: 'group_1',
        newLeaderUserId: 'user_2',
      });

      expect(result).toEqual({ success: true });
      expect(db.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorId: ACTIVE_USER.id,
          action: 'GROUP_LEADERSHIP_TRANSFERRED',
          resource: 'Group',
          resourceId: 'group_1',
          metadata: { previousLeaderId: ACTIVE_USER.id, newLeaderId: 'user_2' },
        }),
      });
    });
  });

  describe('leave', () => {
    it("removes the membership and logs GROUP_LEFT when the caller isn't the leader", async () => {
      const db = makeDb({
        group: {
          findUnique: vi
            .fn()
            .mockResolvedValue({ id: 'group_1', leaderId: 'user_2' }),
        },
      });

      const result = await callerFor(db).leave({ groupId: 'group_1' });

      expect(result).toEqual({ success: true, groupDeleted: false });
      expect(db.groupMember.delete).toHaveBeenCalled();
      expect(db.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorId: ACTIVE_USER.id,
          action: 'GROUP_LEFT',
          resource: 'GroupMember',
          resourceId: 'group_1',
        }),
      });
    });

    it('deletes the group and logs GROUP_DELETED when the leader is the sole member', async () => {
      const db = makeDb({
        group: {
          findUnique: vi
            .fn()
            .mockResolvedValue({ id: 'group_1', leaderId: ACTIVE_USER.id }),
        },
        groupMember: {
          count: vi.fn().mockResolvedValue(1),
        },
      });

      const result = await callerFor(db).leave({ groupId: 'group_1' });

      expect(result).toEqual({ success: true, groupDeleted: true });
      expect(db.group.delete).toHaveBeenCalledWith({
        where: { id: 'group_1' },
      });
      expect(db.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorId: ACTIVE_USER.id,
          action: 'GROUP_DELETED',
          resource: 'Group',
          resourceId: 'group_1',
          metadata: { reason: 'leader_left_as_sole_member' },
        }),
      });
    });
  });

  describe('getDigest', () => {
    it('returns aggregated member/comment counts and last activity', async () => {
      const db = makeDb({
        group: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'group_1',
            name: 'Block Club',
            leaderId: ACTIVE_USER.id,
            lastActivityAt: new Date('2026-09-08T12:00:00.000Z'),
          }),
        },
      });

      const result = await callerFor(db).getDigest({ groupId: 'group_1' });

      expect(result).toEqual({
        groupId: 'group_1',
        groupName: 'Block Club',
        lastActivityAt: '2026-09-08T12:00:00.000Z',
        memberCount: 3,
        commentCountSince: 7,
        since: null,
      });
    });
  });

  describe('getAiDigest', () => {
    const originalKey = process.env.OPENAI_API_KEY;

    beforeEach(() => {
      process.env.OPENAI_API_KEY = 'test-key';
      // ai-memory.ts's queryObservations()/recordObservation() import `db`
      // module-level from @repo/db (the globally-mocked singleton), separate
      // from the per-test `db` object passed via ctx below.
      mockDb.group = {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: 'group_1', leaderId: ACTIVE_USER.id }),
      };
      mockDb.groupMember = {
        findUnique: vi
          .fn()
          .mockResolvedValue({ groupId: 'group_1', userId: ACTIVE_USER.id }),
      };
      mockDb.aIObservation = {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockImplementation(({ data }: any) => ({
          id: 'obs_1',
          ...data,
          createdAt: new Date('2026-09-08T12:00:00.000Z'),
        })),
      };
    });

    afterEach(() => {
      process.env.OPENAI_API_KEY = originalKey;
    });

    it('generates a digest via the shared Community Observer agent and records an AIObservation', async () => {
      const db = makeDb({
        group: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'group_1',
            name: 'Block Club',
            coopId: 'cahootz',
            leaderId: ACTIVE_USER.id,
          }),
        },
        groupComment: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'comment_1',
              content: 'hello',
              author: { name: 'Alice', email: ACTIVE_USER.email },
            },
          ]),
        },
        auditLog: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'audit_1',
              action: 'GROUP_CREATED',
              occurredAt: new Date('2026-09-08T00:00:00.000Z'),
            },
          ]),
        },
      });

      const result = await callerFor(db).getAiDigest({ groupId: 'group_1' });

      expect(result.digest.summary).toBe(
        'Two members joined and leadership transferred since last digest.',
      );
      expect(mockDb.aIObservation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'circle_digest_summary',
            scopeType: 'circle',
            scopeId: 'group_1',
            visibility: 'CIRCLE',
            generatedByAgentKey: 'community-observer',
          }),
        }),
      );
    });

    it('throws PRECONDITION_FAILED when OPENAI_API_KEY is unset', async () => {
      delete process.env.OPENAI_API_KEY;
      const db = makeDb({
        group: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'group_1',
            name: 'Block Club',
            coopId: 'cahootz',
            leaderId: ACTIVE_USER.id,
          }),
        },
      });

      await expect(
        callerFor(db).getAiDigest({ groupId: 'group_1' }),
      ).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
      });
    });
  });

  describe('welcome-table guardrails on existing group procedures', () => {
    const welcomeTableGroup = {
      id: 'wt_1',
      coopId: 'cahootz',
      name: 'Welcome Lounge 1',
      privacy: 'private',
      leaderId: 'guide_1',
      kind: 'WELCOME_TABLE',
      welcomeTableNumber: 1,
      welcomeTableStatus: 'OPEN',
      capacity: 30,
      inviteCode: 'ABCD1234',
    };

    it('joinByCode rejects a welcome table even with a valid code', async () => {
      const db = makeDb({
        group: { findUnique: vi.fn().mockResolvedValue(welcomeTableGroup) },
      });

      await expect(
        callerFor(db).joinByCode({ inviteCode: 'ABCD1234' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(db.groupMember.upsert).not.toHaveBeenCalled();
    });

    it('updatePrivacy rejects a welcome table', async () => {
      const db = makeDb({
        group: { findUnique: vi.fn().mockResolvedValue(welcomeTableGroup) },
        groupMember: { findUnique: vi.fn().mockResolvedValue({ groupId: 'wt_1', userId: ACTIVE_USER.id }) },
      });

      await expect(
        callerFor(db).updatePrivacy({ groupId: 'wt_1', privacy: 'public', confirmExposeHistory: true }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('regenerateInviteCode rejects a welcome table', async () => {
      const db = makeDb({
        group: { findUnique: vi.fn().mockResolvedValue(welcomeTableGroup) },
        groupMember: { findUnique: vi.fn().mockResolvedValue({ groupId: 'wt_1', userId: ACTIVE_USER.id }) },
      });

      await expect(
        callerFor(db).regenerateInviteCode({ groupId: 'wt_1' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('transferLeadership rejects a welcome table', async () => {
      const db = makeDb({
        group: { findUnique: vi.fn().mockResolvedValue(welcomeTableGroup) },
        groupMember: { findUnique: vi.fn().mockResolvedValue({ groupId: 'wt_1', userId: ACTIVE_USER.id }) },
      });

      await expect(
        callerFor(db).transferLeadership({ groupId: 'wt_1', newLeaderUserId: 'someone_else' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('leave rejects a welcome table guide leaving through self-service', async () => {
      const db = makeDb({
        group: { findUnique: vi.fn().mockResolvedValue({ ...welcomeTableGroup, leaderId: ACTIVE_USER.id }) },
        groupMember: {
          findUnique: vi.fn().mockResolvedValue({ groupId: 'wt_1', userId: ACTIVE_USER.id, role: 'GUIDE' }),
        },
      });

      await expect(callerFor(db).leave({ groupId: 'wt_1' })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(db.group.delete).not.toHaveBeenCalled();
    });

    it('leave still lets a newcomer leave a welcome table without touching status', async () => {
      const db = makeDb({
        group: { findUnique: vi.fn().mockResolvedValue(welcomeTableGroup) },
        groupMember: {
          findUnique: vi.fn().mockResolvedValue({ groupId: 'wt_1', userId: ACTIVE_USER.id, role: 'NEWCOMER' }),
        },
      });

      const result = await callerFor(db).leave({ groupId: 'wt_1' });

      expect(result).toEqual({ success: true, groupDeleted: false });
      expect(db.groupMember.delete).toHaveBeenCalledWith({
        where: { groupId_userId: { groupId: 'wt_1', userId: ACTIVE_USER.id } },
      });
      expect(db.group.update).not.toHaveBeenCalled();
    });
  });

  describe('assignWelcomeTable', () => {
    const baseConfig = {
      id: 'cfg_1',
      coopId: 'cahootz',
      enabled: true,
      capacity: 30,
      guideUserId: 'guide_1',
      lastTableNumber: 0,
      activeTableId: null as string | null,
    };

    it('returns the existing assignment idempotently without starting a transaction', async () => {
      const existingTable = { id: 'wt_1', name: 'Welcome Lounge 1', welcomeTableNumber: 1 };
      const db = makeDb({
        groupMember: { findFirst: vi.fn().mockResolvedValue({ group: existingTable }) },
      });

      const result = await callerFor(db).assignWelcomeTable({});

      expect(result).toEqual({ groupId: 'wt_1', name: 'Welcome Lounge 1', welcomeTableNumber: 1 });
      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it('creates Welcome Lounge 1 when no active table exists yet', async () => {
      const db = makeDb({
        groupMember: { findFirst: vi.fn().mockResolvedValue(null) },
        welcomeTableConfig: { upsert: vi.fn().mockResolvedValue(baseConfig) },
        group: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockImplementation(({ data }: any) => ({ id: 'wt_1', ...data })),
        },
      });

      const result = await callerFor(db).assignWelcomeTable({});

      expect(db.group.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            kind: 'WELCOME_TABLE',
            name: 'Welcome Lounge 1',
            welcomeTableNumber: 1,
            welcomeTableStatus: 'OPEN',
            leaderId: 'guide_1',
            privacy: 'private',
          }),
        }),
      );
      expect(db.groupMember.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: { groupId: 'wt_1', userId: 'guide_1', role: 'GUIDE' } }),
      );
      expect(db.groupMember.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: { groupId: 'wt_1', userId: ACTIVE_USER.id, role: 'NEWCOMER' } }),
      );
      expect(db.commonsPost.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          coopId: 'cahootz',
          circleId: 'wt_1',
          authorId: 'sage_1',
          title: 'Welcome to Welcome Lounge 1',
          content: expect.stringContaining('Introduce yourself in the comments'),
          tag: 'Social',
        }),
      });
      expect(db.welcomeTableConfig.update).toHaveBeenCalledWith({
        where: { id: 'cfg_1' },
        data: { lastTableNumber: 1, activeTableId: 'wt_1' },
      });
      expect(result.welcomeTableNumber).toBe(1);
    });

    it('adds the newcomer to an open table below capacity without creating a new one', async () => {
      const activeTable = { id: 'wt_1', welcomeTableStatus: 'OPEN' };
      const db = makeDb({
        groupMember: { findFirst: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(5) },
        welcomeTableConfig: {
          upsert: vi.fn().mockResolvedValue({ ...baseConfig, activeTableId: 'wt_1' }),
        },
        group: { findUnique: vi.fn().mockResolvedValue(activeTable) },
      });

      await callerFor(db).assignWelcomeTable({});

      expect(db.groupMember.create).toHaveBeenCalledTimes(1);
      expect(db.groupMember.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: { groupId: 'wt_1', userId: ACTIVE_USER.id, role: 'NEWCOMER' } }),
      );
      expect(db.group.create).not.toHaveBeenCalled();
      expect(db.commonsPost.create).not.toHaveBeenCalled();
      expect(db.group.update).not.toHaveBeenCalled();
    });

    it('marks the table FULL when the 30th newcomer joins', async () => {
      const activeTable = { id: 'wt_1', welcomeTableStatus: 'OPEN' };
      const db = makeDb({
        groupMember: { findFirst: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(29) },
        welcomeTableConfig: {
          upsert: vi.fn().mockResolvedValue({ ...baseConfig, activeTableId: 'wt_1' }),
        },
        group: { findUnique: vi.fn().mockResolvedValue(activeTable) },
      });

      await callerFor(db).assignWelcomeTable({});

      expect(db.group.update).toHaveBeenCalledWith({
        where: { id: 'wt_1' },
        data: { welcomeTableStatus: 'FULL' },
      });
    });

    it('creates the next numbered table when the active one is full', async () => {
      const fullTable = { id: 'wt_1', welcomeTableStatus: 'FULL' };
      const db = makeDb({
        groupMember: { findFirst: vi.fn().mockResolvedValue(null) },
        welcomeTableConfig: {
          upsert: vi.fn().mockResolvedValue({ ...baseConfig, lastTableNumber: 1, activeTableId: 'wt_1' }),
        },
        group: {
          findUnique: vi.fn().mockResolvedValue(fullTable),
          create: vi.fn().mockImplementation(({ data }: any) => ({ id: 'wt_2', ...data })),
        },
      });

      const result = await callerFor(db).assignWelcomeTable({});

      expect(db.group.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ welcomeTableNumber: 2, name: 'Welcome Lounge 2' }) }),
      );
      expect(result.welcomeTableNumber).toBe(2);
    });

    it('recovers when activeTableId points at a missing table without reusing a number', async () => {
      const db = makeDb({
        groupMember: { findFirst: vi.fn().mockResolvedValue(null) },
        welcomeTableConfig: {
          upsert: vi.fn().mockResolvedValue({ ...baseConfig, lastTableNumber: 3, activeTableId: 'gone' }),
        },
        group: {
          findUnique: vi.fn().mockResolvedValue(null), // stale reference, table no longer exists
          create: vi.fn().mockImplementation(({ data }: any) => ({ id: 'wt_4', ...data })),
        },
      });

      const result = await callerFor(db).assignWelcomeTable({});

      expect(result.welcomeTableNumber).toBe(4);
    });

    describe('newcomer announcement', () => {
      const activeTable = { id: 'wt_1', name: 'Welcome Lounge 1', welcomeTableStatus: 'OPEN' };
      const joiningDb = (overrides: Record<string, Partial<Record<string, any>>> = {}) =>
        makeDb({
          groupMember: {
            findFirst: vi.fn().mockResolvedValue(null),
            count: vi.fn().mockResolvedValue(5),
            findMany: vi.fn().mockResolvedValue([{ userId: 'guide_1' }, { userId: 'user_2' }]),
          },
          welcomeTableConfig: {
            upsert: vi.fn().mockResolvedValue({ ...baseConfig, activeTableId: 'wt_1' }),
          },
          group: { findUnique: vi.fn().mockResolvedValue(activeTable) },
          commonsPost: { findFirst: vi.fn().mockResolvedValue({ id: 'post_welcome' }) },
          user: { findUnique: vi.fn().mockResolvedValue({ ...ACTIVE_USER, handle: 'alice' }) },
          ...overrides,
        });

      it("has Sage @everyone the lounge on its welcome post, highlighting the newcomer", async () => {
        const db = joiningDb();

        await callerFor(db).assignWelcomeTable({});

        expect(db.commonsPost.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({ where: { coopId: 'cahootz', circleId: 'wt_1', authorId: 'sage_1' } }),
        );
        expect(db.commonsComment.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: {
              postId: 'post_welcome',
              authorId: 'sage_1',
              content: expect.stringMatching(/\[@everyone\] please welcome \[@alice\] to Welcome Lounge 1/),
            },
          }),
        );
      });

      it('pushes a notification to every other human in the lounge', async () => {
        const db = joiningDb();

        await callerFor(db).assignWelcomeTable({});

        expect(db.groupMember.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              groupId: 'wt_1',
              userId: { not: ACTIVE_USER.id },
              user: { isBot: false, deletedAt: null },
            },
          }),
        );
        expect(createNotificationAndPush).toHaveBeenCalledTimes(2);
        for (const userId of ['guide_1', 'user_2']) {
          expect(createNotificationAndPush).toHaveBeenCalledWith(db, {
            userId,
            coopId: 'cahootz',
            type: 'WELCOME_LOUNGE_JOIN',
            title: expect.stringContaining('Welcome Lounge 1'),
            body: expect.stringContaining('Alice'),
            data: { postId: 'post_welcome', commentId: 'comment_sage_1', groupId: 'wt_1', coopId: 'cahootz' },
          });
        }
      });

      it('still seats the newcomer when the announcement fails', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const db = joiningDb({
          commonsComment: { create: vi.fn().mockRejectedValue(new Error('db down')) },
        });

        const result = await callerFor(db).assignWelcomeTable({});

        expect(result.groupId).toBe('wt_1');
        expect(createNotificationAndPush).not.toHaveBeenCalled();
        errorSpy.mockRestore();
      });

      it('does not re-announce a newcomer who is already seated', async () => {
        const db = joiningDb({
          groupMember: { findFirst: vi.fn().mockResolvedValue({ group: activeTable }) },
        });

        await callerFor(db).assignWelcomeTable({});

        expect(db.commonsComment.create).not.toHaveBeenCalled();
        expect(createNotificationAndPush).not.toHaveBeenCalled();
      });
    });

    it('throws FORBIDDEN when welcome tables are disabled', async () => {
      const db = makeDb({
        groupMember: { findFirst: vi.fn().mockResolvedValue(null) },
        welcomeTableConfig: { upsert: vi.fn().mockResolvedValue({ ...baseConfig, enabled: false }) },
      });

      await expect(callerFor(db).assignWelcomeTable({})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('creates a table with no guide, using the newcomer as the placeholder leader', async () => {
      const db = makeDb({
        groupMember: { findFirst: vi.fn().mockResolvedValue(null) },
        welcomeTableConfig: { upsert: vi.fn().mockResolvedValue({ ...baseConfig, guideUserId: null }) },
        group: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockImplementation(({ data }: any) => ({ id: 'wt_1', ...data })),
        },
      });

      const result = await callerFor(db).assignWelcomeTable({});

      expect(db.group.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ leaderId: ACTIVE_USER.id }) }),
      );
      // Only the NEWCOMER row is created - no GUIDE membership when unguided.
      expect(db.groupMember.create).toHaveBeenCalledTimes(1);
      expect(db.groupMember.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: { groupId: 'wt_1', userId: ACTIVE_USER.id, role: 'NEWCOMER' } }),
      );
      expect(result.welcomeTableNumber).toBe(1);
    });
  });

  describe('chat presence procedures', () => {
    const memberOfGroup1 = {
      group: { findUnique: vi.fn().mockResolvedValue({ id: 'group_1', leaderId: 'someone_else' }) },
    };

    it('enterChat requires membership then upserts presence', async () => {
      const db = makeDb(memberOfGroup1);

      const result = await callerFor(db).enterChat({ groupId: 'group_1' });

      expect(result).toEqual({ success: true });
      expect(db.circleChatPresence.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { groupId_userId: { groupId: 'group_1', userId: ACTIVE_USER.id } },
        }),
      );
    });

    it('enterChat rejects a non-member', async () => {
      const db = makeDb({
        ...memberOfGroup1,
        groupMember: { findUnique: vi.fn().mockResolvedValue(null) },
      });

      await expect(callerFor(db).enterChat({ groupId: 'group_1' })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(db.circleChatPresence.upsert).not.toHaveBeenCalled();
    });

    it('refreshChatPresence bumps lastActivityAt', async () => {
      const db = makeDb();

      await callerFor(db).refreshChatPresence({ groupId: 'group_1' });

      expect(db.circleChatPresence.updateMany).toHaveBeenCalledWith({
        where: { groupId: 'group_1', userId: ACTIVE_USER.id },
        data: { lastActivityAt: expect.any(Date) },
      });
    });

    it('leaveChat sets exitedAt without touching GroupMember', async () => {
      const db = makeDb();

      await callerFor(db).leaveChat({ groupId: 'group_1' });

      expect(db.circleChatPresence.updateMany).toHaveBeenCalledWith({
        where: { groupId: 'group_1', userId: ACTIVE_USER.id },
        data: { exitedAt: expect.any(Date) },
      });
      expect(db.groupMember.delete).not.toHaveBeenCalled();
    });
  });
});
