import { describe, expect, it, vi } from 'vitest';

import { userRouter } from '../routers/user.js';

const accountUser = {
  id: 'user_1',
  email: 'alice@example.com',
  handle: 'alice',
  name: 'Alice Example',
  nickname: null,
  phone: null,
  roles: ['member'],
  status: 'ACTIVE',
  deletedAt: null,
  lastActiveAt: new Date(),
};

function makeDb(overrides: Record<string, Partial<Record<string, any>>> = {}) {
  return {
    session: {
      findUnique: vi.fn().mockResolvedValue({ id: 'session_1', userId: accountUser.id, isRevoked: false, expiresAt: new Date(Date.now() + 60_000) }),
      update: vi.fn().mockResolvedValue({}),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue(accountUser),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({ name: 'Alice Jones', nickname: 'AJ', handle: 'alice-j' }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      ...overrides.user,
    },
  };
}

function callerFor(db: any) {
  return userRouter.createCaller({
    db,
    req: { headers: { 'x-session-token': 'token_1' } } as any,
    res: {} as any,
    coopId: undefined,
  });
}

describe('user.updateIdentity', () => {
  it('updates the signed-in member and normalizes their handle', async () => {
    const db = makeDb();
    const result = await callerFor(db).updateIdentity({ name: ' Alice Jones ', nickname: ' AJ ', handle: 'Alice-J' });

    expect(result).toEqual({ name: 'Alice Jones', nickname: 'AJ', handle: 'alice-j' });
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: accountUser.id },
      data: { name: 'Alice Jones', nickname: 'AJ', handle: 'alice-j' },
      select: { name: true, nickname: true, handle: true },
    });
  });

  it('rejects a handle already owned by another member', async () => {
    const db = makeDb({ user: { findFirst: vi.fn().mockResolvedValue({ id: 'user_2' }) } });

    await expect(callerFor(db).updateIdentity({ name: 'Alice', nickname: null, handle: 'taken' }))
      .rejects.toMatchObject({ code: 'CONFLICT', message: 'That @ is already taken.' });
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('rejects reserved group mentions', async () => {
    const db = makeDb();

    await expect(callerFor(db).updateIdentity({ name: 'Alice', nickname: null, handle: 'everyone' }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(db.user.update).not.toHaveBeenCalled();
  });
});

describe('user onboarding progress', () => {
  it('keeps completed onboarding complete when an older tab saves a draft', async () => {
    let saved: any = { onboardingStep: 'profile', onboardingCompletedAt: null, onboardingDraft: {} };
    const db = makeDb({ user: {
      findUniqueOrThrow: vi.fn().mockImplementation(() => Promise.resolve(saved)),
      updateMany: vi.fn().mockImplementation(({ where, data }) => {
        expect(where.id).toBe(accountUser.id);
        if (saved.onboardingCompletedAt || !where.onboardingStep.in.includes(saved.onboardingStep)) return Promise.resolve({ count: 0 });
        saved = { ...saved, ...data };
        return Promise.resolve({ count: 1 });
      }),
    } });
    const caller = callerFor(db);
    await caller.saveOnboardingProgress({ step: 'invite' });
    await caller.saveOnboardingProgress({ step: 'profile' });
    expect(saved.onboardingStep).toBe('invite');
    await caller.saveOnboardingProgress({ step: 'commons' });
    const completed = await caller.saveOnboardingProgress({ step: 'complete' });
    expect(completed.onboardingCompletedAt).toBeInstanceOf(Date);
    await caller.saveOnboardingProgress({ step: 'profile', draft: {
      selfDescription: 'stale', interests: '', resourcesOffered: '', resourcesNeeded: '', goals: '', businessSummary: '', locationSummary: '',
    } });
    expect(saved).toEqual(completed);
    expect(saved.onboardingDraft).toEqual({});
  });
});
