import { TRPCError } from '@trpc/server';
import { describe, expect, it, vi } from 'vitest';

import { userRouter } from '../routers/user.js';

const USER_ID = 'user_1';
const WALLET_ADDRESS = '0xabcdef1234567890abcdef1234567890abcdef12';

function makeDb(overrides: Record<string, Partial<Record<string, any>>> = {}) {
  return {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
      ...overrides.user,
    },
    session: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      ...overrides.session,
    },
  };
}

function callerFor(db: any, walletAddress = WALLET_ADDRESS) {
  return userRouter.createCaller({
    db,
    req: { headers: { 'x-wallet-address': walletAddress } } as any,
    res: {} as any,
    coopId: undefined,
  });
}

describe('user.deleteAccount', () => {
  it('soft deletes the authenticated user and revokes sessions', async () => {
    const db = makeDb({
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: USER_ID,
          email: 'alice@example.com',
          deletedAt: null,
          walletAddress: WALLET_ADDRESS,
          wallets: [],
          memberships: [],
        }),
        update: vi.fn().mockResolvedValue({}),
      },
    });

    const result = await callerFor(db).deleteAccount({ userId: USER_ID });

    expect(result.success).toBe(true);
    expect(result.isDemoMode).toBe(false);
    expect(result.deletedAt).toEqual(expect.any(String));
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: {
        deletedAt: expect.any(Date),
        deletedBy: USER_ID,
      },
    });
    expect(db.session.updateMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, isRevoked: false },
      data: {
        isRevoked: true,
        revokedAt: expect.any(Date),
        revokedReason: 'account_deleted',
      },
    });
  });

  it('does not mutate the shared demo account', async () => {
    const db = makeDb({
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: USER_ID,
          email: 'demo@cahootz.coop',
          deletedAt: null,
          walletAddress: WALLET_ADDRESS,
          wallets: [],
          memberships: [{ coopId: 'demo' }],
        }),
      },
    });

    const result = await callerFor(db).deleteAccount({ userId: USER_ID });

    expect(result.success).toBe(true);
    expect(result.isDemoMode).toBe(true);
    expect(result.deletedAt).toBeNull();
    expect(db.user.update).not.toHaveBeenCalled();
    expect(db.session.updateMany).not.toHaveBeenCalled();
  });

  it('rejects deletion when the wallet does not belong to the user', async () => {
    const db = makeDb({
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: USER_ID,
          email: 'alice@example.com',
          deletedAt: null,
          walletAddress: WALLET_ADDRESS,
          wallets: [],
          memberships: [],
        }),
      },
    });

    await expect(
      callerFor(db, '0x1111111111111111111111111111111111111111').deleteAccount({ userId: USER_ID }),
    ).rejects.toBeInstanceOf(TRPCError);
    expect(db.user.update).not.toHaveBeenCalled();
  });
});
