import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';
import { authRouter } from '../routers/auth.js';

// Mock the email module so tests never send real emails
vi.mock('../lib/email.js', () => ({
  sendLoginCode: vi.fn().mockResolvedValue(undefined),
  generateLoginCode: vi.fn().mockReturnValue('123456'),
  isEmailConfigured: vi.fn().mockReturnValue(false), // dev mode: log to console
}));

import { generateLoginCode, isEmailConfigured, sendLoginCode } from '../lib/email.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ACTIVE_USER = {
  id: 'user_1',
  email: 'alice@example.com',
  name: 'Alice',
  roles: ['member'],
  status: 'ACTIVE',
  walletAddress: '0xabcdef1234567890abcdef1234567890abcdef12',
  phone: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

const ACTIVE_MEMBERSHIP = {
  coopId: 'coop_1',
};

const COOP_CONFIG = {
  id: 'cfg_1',
  coopId: 'coop_1',
  name: 'Cahootz Coop',
  slug: 'soulaan',
  bgColor: '#B45309',
  accentColor: '#16A34A',
  isActive: true,
  version: 1,
};

function makeDb(overrides: Record<string, Partial<Record<string, any>>> = {}) {
  return {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      ...overrides.user,
    },
    loginCode: {
      create: vi.fn().mockResolvedValue({ id: 'code_1' }),
      findFirst: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      ...overrides.loginCode,
    },
    coopConfig: {
      findFirst: vi.fn().mockResolvedValue(null),
      ...overrides.coopConfig,
    },
    wallet: {
      findFirst: vi.fn().mockResolvedValue(null),
      ...overrides.wallet,
    },
    ...overrides,
  };
}

function callerFor(db: any) {
  return authRouter.createCaller({
    db,
    req: { headers: {} } as any,
    res: {} as any,
    coopId: undefined,
  });
}

// ─── requestLoginCode ─────────────────────────────────────────────────────────

describe('auth.requestLoginCode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends a login code for an ACTIVE user', async () => {
    const db = makeDb({
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: ACTIVE_USER.id,
          status: 'ACTIVE',
          walletAddress: null,
          wallets: [],
          memberships: [],
        }),
      },
    });
    const caller = callerFor(db);

    const result = await caller.requestLoginCode({ email: 'alice@example.com' });

    expect(result.success).toBe(true);
    expect(db.loginCode.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'alice@example.com',
        code: '123456',
        expiresAt: expect.any(Date),
      }),
    });
    // email not configured → does NOT call sendLoginCode
    expect(sendLoginCode).not.toHaveBeenCalled();
  });

  it('sends email when email is configured', async () => {
    vi.mocked(isEmailConfigured).mockReturnValueOnce(true);
    const db = makeDb({
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: ACTIVE_USER.id,
          status: 'ACTIVE',
          walletAddress: null,
          wallets: [],
          memberships: [],
        }),
      },
    });

    await callerFor(db).requestLoginCode({ email: 'alice@example.com' });

    expect(sendLoginCode).toHaveBeenCalledWith('alice@example.com', '123456', undefined);
  });

  it('throws NOT_FOUND when user does not exist', async () => {
    const db = makeDb({
      user: { findUnique: vi.fn().mockResolvedValue(null) },
    });

    await expect(
      callerFor(db).requestLoginCode({ email: 'nobody@example.com' }),
    ).rejects.toThrow(TRPCError);
    await expect(
      callerFor(db).requestLoginCode({ email: 'nobody@example.com' }),
    ).rejects.toThrow('No account found with this email address');
  });

  it('blocks PENDING users', async () => {
    const db = makeDb({
      user: {
        findUnique: vi.fn().mockResolvedValue({ ...ACTIVE_USER, status: 'PENDING', wallets: [], memberships: [] }),
      },
    });

    await expect(
      callerFor(db).requestLoginCode({ email: 'alice@example.com' }),
    ).rejects.toThrow('still under review');
  });

  it('blocks REJECTED users', async () => {
    const db = makeDb({
      user: {
        findUnique: vi.fn().mockResolvedValue({ ...ACTIVE_USER, status: 'REJECTED', wallets: [], memberships: [] }),
      },
    });

    await expect(
      callerFor(db).requestLoginCode({ email: 'alice@example.com' }),
    ).rejects.toThrow('was not approved');
  });

  it('blocks SUSPENDED users', async () => {
    const db = makeDb({
      user: {
        findUnique: vi.fn().mockResolvedValue({ ...ACTIVE_USER, status: 'SUSPENDED', wallets: [], memberships: [] }),
      },
    });

    await expect(
      callerFor(db).requestLoginCode({ email: 'alice@example.com' }),
    ).rejects.toThrow('suspended');
  });

  it('normalises email to lowercase before lookup', async () => {
    const db = makeDb({
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: ACTIVE_USER.id,
          status: 'ACTIVE',
          walletAddress: null,
          wallets: [],
          memberships: [],
        }),
      },
    });

    await callerFor(db).requestLoginCode({ email: 'ALICE@EXAMPLE.COM' });

    expect(db.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: 'alice@example.com' },
      }),
    );
  });
});

// ─── verifyLoginCode ──────────────────────────────────────────────────────────

describe('auth.verifyLoginCode', () => {
  const VALID_LOGIN_CODE = {
    id: 'code_1',
    email: 'alice@example.com',
    code: '123456',
    used: false,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns user without coop data when no active membership exists', async () => {
    const db = makeDb({
      loginCode: {
        findFirst: vi.fn().mockResolvedValue(VALID_LOGIN_CODE),
        update: vi.fn().mockResolvedValue({}),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({ ...ACTIVE_USER, memberships: [] }),
      },
    });

    const result = await callerFor(db).verifyLoginCode({
      email: 'alice@example.com',
      code: '123456',
    });

    expect(result.success).toBe(true);
    expect(result.user?.id).toBe(ACTIVE_USER.id);
    expect(result.user?.email).toBe(ACTIVE_USER.email);
    expect(result.user?.coop).toBeUndefined();
    expect(db.loginCode.update).toHaveBeenCalledWith({
      where: { id: 'code_1' },
      data: { used: true },
    });
  });

  it('returns user WITH coop data when an active membership and config exist', async () => {
    const db = makeDb({
      loginCode: {
        findFirst: vi.fn().mockResolvedValue(VALID_LOGIN_CODE),
        update: vi.fn().mockResolvedValue({}),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({
          ...ACTIVE_USER,
          memberships: [ACTIVE_MEMBERSHIP],
        }),
      },
      coopConfig: {
        findFirst: vi.fn().mockResolvedValue(COOP_CONFIG),
      },
    });

    const result = await callerFor(db).verifyLoginCode({
      email: 'alice@example.com',
      code: '123456',
    });

    expect(result.success).toBe(true);
    expect(result.user?.coop?.id).toBe('coop_1');
    expect(result.user?.coop?.name).toBe('Cahootz Coop');
    expect(result.user?.coop?.shortName).toBe('soulaan');
  });

  it('rejects an expired or already-used login code', async () => {
    const db = makeDb({
      loginCode: {
        findFirst: vi.fn().mockResolvedValue(null), // no matching valid code
        update: vi.fn(),
      },
    });

    await expect(
      callerFor(db).verifyLoginCode({ email: 'alice@example.com', code: '000000' }),
    ).rejects.toThrow('Invalid or expired code');
  });

  it('rejects a non-ACTIVE user even with a valid code', async () => {
    const db = makeDb({
      loginCode: {
        findFirst: vi.fn().mockResolvedValue(VALID_LOGIN_CODE),
        update: vi.fn().mockResolvedValue({}),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({
          ...ACTIVE_USER,
          status: 'PENDING',
          memberships: [],
        }),
      },
    });

    await expect(
      callerFor(db).verifyLoginCode({ email: 'alice@example.com', code: '123456' }),
    ).rejects.toThrow('Account is not active');
  });

  it('throws NOT_FOUND when user disappears after code validation', async () => {
    const db = makeDb({
      loginCode: {
        findFirst: vi.fn().mockResolvedValue(VALID_LOGIN_CODE),
        update: vi.fn().mockResolvedValue({}),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    });

    await expect(
      callerFor(db).verifyLoginCode({ email: 'alice@example.com', code: '123456' }),
    ).rejects.toThrow('User not found');
  });

  it('marks the login code as used exactly once on success', async () => {
    const db = makeDb({
      loginCode: {
        findFirst: vi.fn().mockResolvedValue(VALID_LOGIN_CODE),
        update: vi.fn().mockResolvedValue({}),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({ ...ACTIVE_USER, memberships: [] }),
      },
    });

    await callerFor(db).verifyLoginCode({ email: 'alice@example.com', code: '123456' });

    expect(db.loginCode.update).toHaveBeenCalledTimes(1);
    expect(db.loginCode.update).toHaveBeenCalledWith({
      where: { id: 'code_1' },
      data: { used: true },
    });
  });

  // ── Regression guard: the membership query must NOT select the `username`
  // column (which may not exist in older production databases). If someone
  // changes the include back to fetching all columns this test will fail
  // because the spy will be called with a different shape.
  it('REGRESSION: user.findUnique uses select on memberships to avoid missing-column errors', async () => {
    const db = makeDb({
      loginCode: {
        findFirst: vi.fn().mockResolvedValue(VALID_LOGIN_CODE),
        update: vi.fn().mockResolvedValue({}),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({ ...ACTIVE_USER, memberships: [] }),
      },
    });

    await callerFor(db).verifyLoginCode({ email: 'alice@example.com', code: '123456' });

    // The query must include `memberships.select` – NOT a bare `include`
    // that would pull every column (including `username`, which may be absent).
    const callArgs = db.user.findUnique.mock.calls[0][0];
    const membershipClause = callArgs?.include?.memberships;

    expect(membershipClause).toBeDefined();
    expect(membershipClause.select).toBeDefined();
    // Only coopId should be selected – no username, no sessionToken, etc.
    expect(Object.keys(membershipClause.select)).toEqual(['coopId']);
  });

  it('still returns coop data even when coopConfig is not found', async () => {
    const db = makeDb({
      loginCode: {
        findFirst: vi.fn().mockResolvedValue(VALID_LOGIN_CODE),
        update: vi.fn().mockResolvedValue({}),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({
          ...ACTIVE_USER,
          memberships: [ACTIVE_MEMBERSHIP],
        }),
      },
      coopConfig: {
        findFirst: vi.fn().mockResolvedValue(null), // config not found
      },
    });

    const result = await callerFor(db).verifyLoginCode({
      email: 'alice@example.com',
      code: '123456',
    });

    expect(result.success).toBe(true);
    // No coopData because config was not found
    expect(result.user?.coop).toBeUndefined();
  });
});
