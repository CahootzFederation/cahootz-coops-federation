import { beforeEach, describe, expect, it, vi } from 'vitest';

import { streetRouter } from '../routers/street.js';
import { createNotificationAndPush } from '../services/push-notification-service.js';

vi.mock('../services/push-notification-service.js', () => ({
  createNotificationAndPush: vi.fn().mockResolvedValue({ id: 'n_1' }),
}));

const ME = {
  id: 'user_1',
  email: 'alice@example.com',
  name: 'Alice',
  handle: 'alice',
  phone: null,
  roles: ['member'],
  status: 'ACTIVE',
  deletedAt: null,
};

function makeDb(overrides: Record<string, Record<string, any>> = {}) {
  const lots: any[] = [];
  const db: any = {
    session: {
      findUnique: vi.fn().mockResolvedValue({
        id: 's_1', userId: ME.id, token: 't_1', isRevoked: false, expiresAt: new Date(Date.now() + 3_600_000),
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    user: { findUnique: vi.fn().mockResolvedValue(ME), update: vi.fn().mockResolvedValue({}) },
    userCoopMembership: {
      findUnique: vi.fn().mockResolvedValue({ status: 'ACTIVE', roles: ['member'] }),
      findMany: vi.fn(async ({ where }: any) => where.userId.in.map((userId: string) => ({ userId }))),
      ...overrides.userCoopMembership,
    },
    streetLot: {
      findUnique: vi.fn(async ({ where }: any) =>
        lots.find((l) => l.coopId === where.coopId_userId.coopId && l.userId === where.coopId_userId.userId) ?? null),
      findFirst: vi.fn(async () => (lots.length ? { lotNumber: Math.max(...lots.map((l) => l.lotNumber)) } : null)),
      findMany: vi.fn(async () => lots.map((l) => ({ ...l, user: { id: l.userId, name: l.userId, email: `${l.userId}@x.com`, handle: l.userId, avatarColor: null } }))),
      create: vi.fn(async ({ data }: any) => {
        if (lots.some((l) => l.coopId === data.coopId && (l.lotNumber === data.lotNumber || l.userId === data.userId))) {
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        }
        lots.push(data);
        return data;
      }),
      update: vi.fn(async ({ data }: any) => ({ lotNumber: 0, houseStyle: 'a', wallColor: 'cream', roofColor: 'terracotta', ...data })),
      ...overrides.streetLot,
    },
    streetPresence: {
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      ...overrides.streetPresence,
    },
    group: { count: vi.fn().mockResolvedValue(5) },
    notification: { findFirst: vi.fn().mockResolvedValue(null), ...overrides.notification },
    _lots: lots,
  };
  return db;
}

const callerFor = (db: any) =>
  streetRouter.createCaller({ db, req: { headers: { 'x-session-token': 't_1' } } as any, res: {} as any, coopId: undefined } as any);

describe('streetRouter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('gives a member a lot on their first visit and keeps it after that', async () => {
    const db = makeDb();
    db._lots.push({ coopId: 'c1', userId: 'neighbor', lotNumber: 0, houseStyle: 'a', wallColor: 'cream', roofColor: 'terracotta' });
    const first = await callerFor(db).get({ coopId: 'c1' });
    expect(first.yourLotNumber).toBe(1);
    expect(first.lots.map((l) => [l.lotNumber, l.isYou])).toEqual([[0, false], [1, true]]);
    expect(first.circleCount).toBe(5);

    const second = await callerFor(db).get({ coopId: 'c1' });
    expect(second.yourLotNumber).toBe(1);
    expect(db.streetLot.create).toHaveBeenCalledTimes(1);
  });

  it('takes the next lot when another first visit grabbed the same number', async () => {
    const db = makeDb();
    let raced = false;
    db.streetLot.findFirst.mockImplementation(async () => {
      if (!raced) {
        raced = true;
        db._lots.push({ coopId: 'c1', userId: 'someone', lotNumber: 0, houseStyle: 'a', wallColor: 'cream', roofColor: 'slate' });
        return null; // stale read: we think lot 0 is free
      }
      return { lotNumber: Math.max(...db._lots.map((l: any) => l.lotNumber)) };
    });
    const street = await callerFor(db).get({ coopId: 'c1' });
    expect(street.yourLotNumber).toBe(1);
  });

  it('turns away people who are not members of the Commons', async () => {
    const db = makeDb({ userCoopMembership: { findUnique: vi.fn().mockResolvedValue({ status: 'PENDING', roles: [] }) } });
    await expect(callerFor(db).get({ coopId: 'c1' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(db.streetLot.create).not.toHaveBeenCalled();
  });

  it('hides houses of people who left the Commons but keeps their lot number', async () => {
    const db = makeDb({
      userCoopMembership: {
        findMany: vi.fn().mockResolvedValue([{ userId: ME.id }]),
      },
    });
    db._lots.push({ coopId: 'c1', userId: 'gone', lotNumber: 0, houseStyle: 'a', wallColor: 'cream', roofColor: 'terracotta' });
    const street = await callerFor(db).get({ coopId: 'c1' });
    expect(street.lots.map((l) => l.user.id)).toEqual([ME.id]);
    expect(street.yourLotNumber).toBe(1);
    expect(street.maxLotNumber).toBe(1);
  });

  it('only counts people seen in the last 90 seconds as online', async () => {
    const db = makeDb();
    await callerFor(db).get({ coopId: 'c1' });
    const where = db.streetPresence.findMany.mock.calls[0][0].where;
    expect(where.exitedAt).toBeNull();
    const cutoff = where.lastActivityAt.gt.getTime();
    expect(Date.now() - cutoff).toBeGreaterThanOrEqual(89_000);
    expect(Date.now() - cutoff).toBeLessThanOrEqual(91_000);
  });

  it('saves where you are standing and rejects spots off the street', async () => {
    const db = makeDb();
    await callerFor(db).move({ coopId: 'c1', x: 9, y: 9 });
    expect(db.streetPresence.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ x: 9, y: 9, exitedAt: null }),
    }));
    await expect(callerFor(db).move({ coopId: 'c1', x: -1, y: 4 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(callerFor(db).move({ coopId: 'c1', x: 400, y: 4 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('marks you gone when you leave the street', async () => {
    const db = makeDb();
    await callerFor(db).leave({ coopId: 'c1' });
    expect(db.streetPresence.updateMany).toHaveBeenCalledWith({
      where: { coopId: 'c1', userId: ME.id },
      data: { exitedAt: expect.any(Date) },
    });
  });

  it('only saves palette colors and styles', async () => {
    const db = makeDb();
    const saved = await callerFor(db).paint({ coopId: 'c1', wallColor: 'sky', roofColor: 'blue', houseStyle: 'b' });
    expect(saved).toMatchObject({ wallColor: 'sky', roofColor: 'blue', houseStyle: 'b' });
    await expect(callerFor(db).paint({ coopId: 'c1', wallColor: '#ff00ff' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(callerFor(db).paint({ coopId: 'c1', roofColor: 'gold' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(callerFor(db).paint({ coopId: 'c1', houseStyle: 'z' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  describe('knock', () => {
    it('lets the neighbor know you stopped by', async () => {
      const db = makeDb();
      await expect(callerFor(db).knock({ coopId: 'c1', userId: 'user_2' })).resolves.toEqual({ success: true });
      expect(createNotificationAndPush).toHaveBeenCalledWith(db, expect.objectContaining({
        userId: 'user_2',
        coopId: 'c1',
        type: 'STREET_KNOCK',
        body: 'Alice stopped by your house.',
        data: expect.objectContaining({ fromUserId: ME.id }),
      }));
    });

    it("won't knock on your own door", async () => {
      const db = makeDb();
      await expect(callerFor(db).knock({ coopId: 'c1', userId: ME.id })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(createNotificationAndPush).not.toHaveBeenCalled();
    });

    it("won't knock for someone who isn't a member", async () => {
      const db = makeDb({
        userCoopMembership: {
          findUnique: vi.fn(async ({ where }: any) =>
            where.userId_coopId.userId === ME.id ? { status: 'ACTIVE', roles: ['member'] } : null),
        },
      });
      await expect(callerFor(db).knock({ coopId: 'c1', userId: 'stranger' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(createNotificationAndPush).not.toHaveBeenCalled();
    });

    it('allows one knock per neighbor every 30 minutes', async () => {
      const db = makeDb({ notification: { findFirst: vi.fn().mockResolvedValue({ id: 'earlier' }) } });
      await expect(callerFor(db).knock({ coopId: 'c1', userId: 'user_2' })).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
      const where = db.notification.findFirst.mock.calls[0][0].where;
      expect(where).toMatchObject({ userId: 'user_2', type: 'STREET_KNOCK', data: { path: ['fromUserId'], equals: ME.id } });
      expect(Date.now() - where.createdAt.gt.getTime()).toBeGreaterThanOrEqual(29 * 60_000);
      expect(createNotificationAndPush).not.toHaveBeenCalled();
    });
  });
});
