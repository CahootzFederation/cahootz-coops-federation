import { describe, it, expect, vi, beforeEach } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { walletAuthRouter } from '../routers/wallet-auth.js';

describe('walletAuthRouter', () => {
  const privateKey = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' as const;
  const account = privateKeyToAccount(privateKey);
  const walletAddress = account.address;

  function makeDb(overrides: Record<string, any> = {}) {
    return {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          walletAddress,
          encryptedPrivateKey: 'encrypted',
          walletCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      wallet: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'wallet_123',
          userId: 'user_123',
          address: walletAddress,
          walletType: 'MANAGED',
          isPrimary: true,
          verifiedAt: null,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      walletChallenge: {
        create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'challenge_123', ...data })),
        findUnique: vi.fn(),
        update: vi.fn().mockResolvedValue({}),
      },
      $transaction: vi.fn((items) => Promise.all(items)),
      ...overrides,
    };
  }

  function callerFor(db: any) {
    return walletAuthRouter.createCaller({
      db,
      req: { headers: {} } as any,
      res: {} as any,
      coopId: 'soulaan',
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a challenge for a wallet linked to the user', async () => {
    const db = makeDb();
    const caller = callerFor(db);

    const result = await caller.requestChallenge({
      userId: 'user_123',
      walletAddress,
      coopId: 'soulaan',
      purpose: 'Verify mobile wallet',
    });

    expect(result.challengeId).toBe('challenge_123');
    expect(result.message).toContain('Sign in to Cahootz');
    expect(result.message).toContain(`Wallet: ${walletAddress}`);
    expect(db.walletChallenge.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user_123',
        walletId: 'wallet_123',
        walletAddress,
        coopId: 'soulaan',
        purpose: 'Verify mobile wallet',
      }),
    });
  });

  it('verifies a valid signature and consumes the challenge', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    const message = [
      'Sign in to Cahootz',
      '',
      `Wallet: ${walletAddress}`,
      'Nonce: test',
    ].join('\n');
    const signature = await account.signMessage({ message });
    const db = makeDb();
    db.walletChallenge.findUnique.mockResolvedValue({
      id: 'challenge_123',
      userId: 'user_123',
      walletId: 'wallet_123',
      walletAddress,
      message,
      expiresAt,
      consumedAt: null,
    });

    const result = await callerFor(db).verifySignature({
      challengeId: 'challenge_123',
      walletAddress,
      signature,
    });

    expect(result.success).toBe(true);
    expect(result.walletAddress).toBe(walletAddress);
    expect(db.walletChallenge.update).toHaveBeenCalledWith({
      where: { id: 'challenge_123' },
      data: { consumedAt: expect.any(Date) },
    });
    expect(db.wallet.update).toHaveBeenCalledWith({
      where: { address: walletAddress },
      data: expect.objectContaining({
        verifiedAt: expect.any(Date),
        lastSeenAt: expect.any(Date),
      }),
    });
  });

  it('rejects expired, reused, mismatched, and unlinked challenges', async () => {
    const db = makeDb();
    const caller = callerFor(db);

    db.walletChallenge.findUnique.mockResolvedValueOnce({
      id: 'expired',
      userId: 'user_123',
      walletAddress,
      message: 'expired',
      expiresAt: new Date(Date.now() - 1_000),
      consumedAt: null,
    });
    await expect(caller.verifySignature({
      challengeId: 'expired',
      walletAddress,
      signature: `0x${'1'.repeat(130)}`,
    })).rejects.toThrow('Wallet challenge has expired');

    db.walletChallenge.findUnique.mockResolvedValueOnce({
      id: 'used',
      userId: 'user_123',
      walletAddress,
      message: 'used',
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: new Date(),
    });
    await expect(caller.verifySignature({
      challengeId: 'used',
      walletAddress,
      signature: `0x${'1'.repeat(130)}`,
    })).rejects.toThrow('Wallet challenge has already been used');

    db.walletChallenge.findUnique.mockResolvedValueOnce({
      id: 'mismatch',
      userId: 'user_123',
      walletAddress,
      message: 'mismatch',
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    });
    await expect(caller.verifySignature({
      challengeId: 'mismatch',
      walletAddress: '0x1234567890123456789012345678901234567890',
      signature: `0x${'1'.repeat(130)}`,
    })).rejects.toThrow('Wallet address does not match challenge');

    db.user.findUnique.mockResolvedValueOnce({
      walletAddress: null,
      encryptedPrivateKey: null,
      walletCreatedAt: null,
    });
    db.wallet.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    await expect(caller.requestChallenge({
      userId: 'user_123',
      walletAddress,
      coopId: 'soulaan',
      purpose: 'Verify mobile wallet',
    })).rejects.toThrow('Wallet is not linked to this user');
  });
});
