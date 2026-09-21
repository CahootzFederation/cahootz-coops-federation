import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/admin-config.js', () => ({
  isPlatformAdminWallet: vi.fn().mockReturnValue(true),
  isPlatformAdminEmail: vi.fn().mockReturnValue(true),
}));

// listCommonsMembers (reused for listEligibleGuides) imports the real
// @repo/db singleton itself rather than taking ctx.db as a parameter - so
// unlike every other procedure here, that one test mocks this module
// directly instead of going through the local makeDb() context.
vi.mock('../services/platform-admin.js', () => ({
  listCommonsMembers: vi.fn(),
}));

import { welcomeTablesRouter } from '../routers/welcome-tables.js';
import { listCommonsMembers } from '../services/platform-admin.js';

const ADMIN_WALLET = '0x1111111111111111111111111111111111111111'.slice(0, 42);

function makeDb(overrides: Record<string, Partial<Record<string, any>>> = {}) {
  const db: any = {
    welcomeTableConfig: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockImplementation(({ where, create }: any) => ({
        id: 'cfg_1',
        coopId: where.coopId,
        enabled: true,
        capacity: 30,
        guideUserId: null,
        lastTableNumber: 0,
        activeTableId: null,
        ...create,
      })),
      update: vi.fn().mockImplementation(({ data }: any) => ({ id: 'cfg_1', ...data })),
      ...overrides.welcomeTableConfig,
    },
    group: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockImplementation(({ data }: any) => ({ id: 'wt_new', ...data })),
      update: vi.fn().mockResolvedValue({}),
      ...overrides.group,
    },
    groupMember: {
      create: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
      ...overrides.groupMember,
    },
    userCoopMembership: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      ...overrides.userCoopMembership,
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
      ...overrides.auditLog,
    },
    user: {
      findFirst: vi.fn().mockResolvedValue(null),
      ...overrides.user,
    },
    $transaction: vi.fn(async (arg: any) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      return arg(db);
    }),
  };

  return db;
}

function callerFor(db: any) {
  return welcomeTablesRouter.createCaller({
    db,
    req: { headers: { 'x-wallet-address': ADMIN_WALLET } } as any,
    res: {} as any,
    coopId: undefined,
  });
}

describe('welcomeTablesRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getConfig', () => {
    it('returns null when no config exists yet', async () => {
      const db = makeDb();

      const result = await callerFor(db).getConfig({ coopId: 'cahootz' });

      expect(result).toEqual({ config: null, activeTable: null });
    });

    it('returns the active table snapshot when one exists', async () => {
      const db = makeDb({
        welcomeTableConfig: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'cfg_1',
            coopId: 'cahootz',
            enabled: true,
            capacity: 30,
            guideUserId: 'guide_1',
            lastTableNumber: 1,
            activeTableId: 'wt_1',
          }),
        },
        group: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'wt_1',
            name: 'Welcome Table 1',
            welcomeTableStatus: 'OPEN',
            welcomeTableNumber: 1,
            _count: { members: 5 },
          }),
        },
      });

      const result = await callerFor(db).getConfig({ coopId: 'cahootz' });

      expect(result.activeTable).toEqual({
        id: 'wt_1',
        name: 'Welcome Table 1',
        status: 'OPEN',
        tableNumber: 1,
        newcomerCount: 5,
      });
    });
  });

  describe('updateConfig', () => {
    it('diffs against the current config and writes an audit entry', async () => {
      const db = makeDb({
        welcomeTableConfig: {
          upsert: vi.fn().mockResolvedValue({
            id: 'cfg_1',
            coopId: 'cahootz',
            enabled: true,
            capacity: 30,
            guideUserId: null,
            lastTableNumber: 0,
            activeTableId: null,
          }),
        },
      });

      await callerFor(db).updateConfig({ coopId: 'cahootz', guideUserId: 'guide_1', capacity: 40 });

      expect(db.welcomeTableConfig.update).toHaveBeenCalledWith({
        where: { id: 'cfg_1' },
        data: { guideUserId: 'guide_1', capacity: 40 },
      });
      expect(db.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'WELCOME_TABLE_CONFIG_UPDATED',
            actorId: ADMIN_WALLET,
            metadata: expect.objectContaining({
              diff: expect.arrayContaining([
                { field: 'guideUserId', before: null, after: 'guide_1' },
                { field: 'capacity', before: 30, after: 40 },
              ]),
            }),
          }),
        }),
      );
    });
  });

  describe('startNext', () => {
    const config = {
      id: 'cfg_1',
      coopId: 'cahootz',
      enabled: true,
      capacity: 30,
      guideUserId: 'guide_1',
      lastTableNumber: 1,
      activeTableId: 'wt_1',
    };

    it('closes a partially-filled open table without touching memberships, then starts the next one', async () => {
      const db = makeDb({
        welcomeTableConfig: { upsert: vi.fn().mockResolvedValue(config) },
        group: {
          findUnique: vi.fn().mockResolvedValue({ id: 'wt_1', welcomeTableStatus: 'OPEN' }),
          create: vi.fn().mockImplementation(({ data }: any) => ({ id: 'wt_2', ...data })),
        },
      });

      const result = await callerFor(db).startNext({ coopId: 'cahootz' });

      expect(db.group.update).toHaveBeenCalledWith({
        where: { id: 'wt_1' },
        data: { welcomeTableStatus: 'CLOSED' },
      });
      expect(db.groupMember.create).toHaveBeenCalledTimes(1); // only the new guide, no newcomer
      expect(db.groupMember.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: { groupId: 'wt_2', userId: 'guide_1', role: 'GUIDE' } }),
      );
      expect(result.welcomeTableNumber).toBe(2);
    });

    it('retries once on a Postgres serialization conflict and then succeeds', async () => {
      let calls = 0;
      const db = makeDb({
        welcomeTableConfig: { upsert: vi.fn().mockResolvedValue({ ...config, activeTableId: null }) },
        group: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockImplementation(({ data }: any) => ({ id: 'wt_2', ...data })),
        },
      });
      db.$transaction = vi.fn(async (arg: any) => {
        calls += 1;
        if (calls === 1) {
          const err: any = new Error('could not serialize access due to concurrent update');
          err.code = 'P2034';
          throw err;
        }
        if (Array.isArray(arg)) return Promise.all(arg);
        return arg(db);
      });

      const result = await callerFor(db).startNext({ coopId: 'cahootz' });

      expect(calls).toBe(2);
      expect(result.welcomeTableNumber).toBe(2);
    });

    it('does not retry non-serialization errors', async () => {
      const db = makeDb({
        welcomeTableConfig: { upsert: vi.fn().mockResolvedValue({ ...config, enabled: false }) },
      });

      await expect(callerFor(db).startNext({ coopId: 'cahootz' })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(db.$transaction).toHaveBeenCalledTimes(1);
    });

    it('falls back to the wallet-linked admin account as leader when no guide is configured', async () => {
      const db = makeDb({
        welcomeTableConfig: {
          upsert: vi.fn().mockResolvedValue({ ...config, guideUserId: null, activeTableId: null }),
        },
        group: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockImplementation(({ data }: any) => ({ id: 'wt_2', ...data })),
        },
        user: { findFirst: vi.fn().mockResolvedValue({ id: 'admin_user_1' }) },
      });

      const result = await callerFor(db).startNext({ coopId: 'cahootz' });

      expect(db.group.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ leaderId: 'admin_user_1' }) }),
      );
      expect(db.groupMember.create).not.toHaveBeenCalled(); // no guide, no newcomer to add either
      expect(result.welcomeTableNumber).toBe(2);
    });

    it('throws PRECONDITION_FAILED when no guide is configured and the admin has no linked account', async () => {
      const db = makeDb({
        welcomeTableConfig: {
          upsert: vi.fn().mockResolvedValue({ ...config, guideUserId: null, activeTableId: null }),
        },
        user: { findFirst: vi.fn().mockResolvedValue(null) },
      });

      await expect(callerFor(db).startNext({ coopId: 'cahootz' })).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
      });
    });
  });

  describe('listEligibleGuides', () => {
    it('filters to active members only', async () => {
      vi.mocked(listCommonsMembers).mockResolvedValue({
        items: [
          {
            id: 'm1',
            userId: 'u1',
            username: 'alice',
            status: 'ACTIVE',
            roles: ['member'],
            lastLogin: null,
            createdAt: '2026-09-01T00:00:00.000Z',
            email: 'alice@example.com',
            name: 'Alice',
            walletAddress: null,
          },
          {
            id: 'm2',
            userId: 'u2',
            username: 'bob',
            status: 'SUSPENDED',
            roles: ['member'],
            lastLogin: null,
            createdAt: '2026-09-01T00:00:00.000Z',
            email: 'bob@example.com',
            name: 'Bob',
            walletAddress: null,
          },
        ],
        total: 2,
        page: 1,
        pageSize: 20,
      });

      const result = await callerFor(makeDb()).listEligibleGuides({ coopId: 'cahootz' });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].userId).toBe('u1');
    });
  });

  describe('listHistory', () => {
    it('derives history entries from Group rows, most recent table first', async () => {
      const db = makeDb({
        group: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'wt_2',
              welcomeTableNumber: 2,
              welcomeTableStatus: 'OPEN',
              capacity: 30,
              createdAt: new Date('2026-09-21T00:00:00.000Z'),
              updatedAt: new Date('2026-09-21T00:00:00.000Z'),
              members: [{ userId: 'guide_1', user: { name: 'Guide One', email: 'guide@example.com' } }],
              _count: { members: 2 },
            },
            {
              id: 'wt_1',
              welcomeTableNumber: 1,
              welcomeTableStatus: 'CLOSED',
              capacity: 30,
              createdAt: new Date('2026-09-20T00:00:00.000Z'),
              updatedAt: new Date('2026-09-21T00:00:00.000Z'),
              members: [{ userId: 'guide_1', user: { name: 'Guide One', email: 'guide@example.com' } }],
              _count: { members: 30 },
            },
          ]),
        },
      });

      const result = await callerFor(db).listHistory({ coopId: 'cahootz' });

      expect(result.history).toHaveLength(2);
      expect(result.history[0].tableNumber).toBe(2);
      expect(result.history[1].status).toBe('CLOSED');
      expect(result.history[1].newcomerCount).toBe(30);
      expect(result.history[1].guide).toEqual({ userId: 'guide_1', name: 'Guide One' });
    });
  });
});
