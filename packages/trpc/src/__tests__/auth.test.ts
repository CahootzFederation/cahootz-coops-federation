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
  coopId: 'cahootz',
};

const COOP_CONFIG = {
  id: 'cfg_1',
  coopId: 'cahootz',
  name: 'Unity Coop',
  slug: 'unity-coop',
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
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        ...ACTIVE_USER,
        memberships: [ACTIVE_MEMBERSHIP],
      }),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      ...overrides.user,
    },
    userCoopMembership: {
      upsert: vi.fn().mockResolvedValue({ id: 'membership_1' }),
      ...overrides.userCoopMembership,
    },
    session: {
      create: vi.fn().mockResolvedValue({ id: 'session_1' }),
      findUnique: vi.fn(),
      update: vi.fn(),
      ...overrides.session,
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

  it('creates a Commons account when email does not exist', async () => {
    const createdUser = {
      id: 'new_user_1',
      status: 'ACTIVE',
      deletedAt: null,
      walletAddress: null,
      wallets: [],
      memberships: [],
    };
    const db = makeDb({
      user: { findUnique: vi.fn().mockResolvedValue(null) },
    });
    db.user.create.mockResolvedValue(createdUser);

    const result = await callerFor(db).requestLoginCode({ email: 'nobody@example.com' });

    expect(result.success).toBe(true);
    expect(db.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'nobody@example.com',
          status: 'ACTIVE',
          roles: ['member'],
        }),
      }),
    );
    expect(db.userCoopMembership.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          coopId: 'cahootz',
          status: 'ACTIVE',
        }),
      }),
    );
  });

  it('promotes PENDING users into Commons access', async () => {
    const db = makeDb({
      user: {
        findUnique: vi.fn().mockResolvedValue({ ...ACTIVE_USER, status: 'PENDING', wallets: [], memberships: [] }),
      },
    });

    const result = await callerFor(db).requestLoginCode({ email: 'alice@example.com' });

    expect(result.success).toBe(true);
    expect(db.user.updateMany).toHaveBeenCalledWith({
      where: { id: ACTIVE_USER.id, status: 'PENDING' },
      data: { status: 'ACTIVE' },
    });
    expect(db.userCoopMembership.upsert).toHaveBeenCalled();
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

  it('blocks deleted users', async () => {
    const db = makeDb({
      user: {
        findUnique: vi.fn().mockResolvedValue({
          ...ACTIVE_USER,
          deletedAt: new Date('2026-07-01T00:00:00.000Z'),
          wallets: [],
          memberships: [],
        }),
      },
    });

    await expect(
      callerFor(db).requestLoginCode({ email: 'alice@example.com' }),
    ).rejects.toThrow('account has been deleted');
    expect(db.loginCode.create).not.toHaveBeenCalled();
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

  it('defaults verified login to the configured Commons coop', async () => {
    const db = makeDb({
      loginCode: {
        findFirst: vi.fn().mockResolvedValue(VALID_LOGIN_CODE),
        update: vi.fn().mockResolvedValue({}),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({ ...ACTIVE_USER, memberships: [] }),
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
    expect(result.user?.id).toBe(ACTIVE_USER.id);
    expect(result.user?.email).toBe(ACTIVE_USER.email);
    expect(result.user?.sessionToken).toEqual(expect.any(String));
    expect(result.user?.coop?.id).toBe('cahootz');
    expect(result.user?.coop?.name).toBe('Unity Coop');
    expect(db.loginCode.update).toHaveBeenCalledWith({
      where: { id: 'code_1' },
      data: { used: true },
    });
    expect(db.userCoopMembership.upsert).toHaveBeenCalled();
    expect(db.session.create).toHaveBeenCalled();
  });

  it('blocks deleted users from verifying a login code', async () => {
    const db = makeDb({
      loginCode: {
        findFirst: vi.fn().mockResolvedValue(VALID_LOGIN_CODE),
        update: vi.fn().mockResolvedValue({}),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({
          ...ACTIVE_USER,
          deletedAt: new Date('2026-07-01T00:00:00.000Z'),
          memberships: [],
        }),
      },
    });

    await expect(
      callerFor(db).verifyLoginCode({
        email: 'alice@example.com',
        code: '123456',
      }),
    ).rejects.toThrow('account has been deleted');
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
    expect(result.user?.coop?.id).toBe('cahootz');
    expect(result.user?.coop?.name).toBe('Unity Coop');
    expect(result.user?.coop?.shortName).toBe('unity-coop');
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

  it('allows a PENDING user to verify into Commons access', async () => {
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

    const result = await callerFor(db).verifyLoginCode({ email: 'alice@example.com', code: '123456' });

    expect(result.success).toBe(true);
    expect(db.user.updateMany).toHaveBeenCalledWith({
      where: { id: ACTIVE_USER.id, status: 'PENDING' },
      data: { status: 'ACTIVE' },
    });
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
    expect(result.user?.coop?.id).toBe('cahootz');
    expect(result.user?.coop?.name).toBe('Cahootz Commons');
    expect(result.user?.coop?.shortName).toBe('Cahootz');
  });
});
