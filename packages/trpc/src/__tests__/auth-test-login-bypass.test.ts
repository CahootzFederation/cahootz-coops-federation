import { describe, it, expect, vi, afterEach } from 'vitest';

// Mock the email module so tests never send real emails
vi.mock('../lib/email.js', () => ({
  sendLoginCode: vi.fn().mockResolvedValue(undefined),
  generateLoginCode: vi.fn().mockReturnValue('123456'),
  isEmailConfigured: vi.fn().mockReturnValue(false),
}));

// The test-login bypass reads process.env.NODE_ENV once at module load time
// (see `isProduction` in ../routers/auth.ts), so this file resets modules and
// re-imports after flipping NODE_ENV rather than sharing the module cache
// with auth.test.ts.
describe('auth test-login bypass is disabled in production', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    vi.resetModules();
  });

  it('does not skip real login-code generation for *@test.cahootz.local when NODE_ENV=production', async () => {
    process.env.NODE_ENV = 'production';
    vi.resetModules();
    const { authRouter } = await import('../routers/auth.js');

    const db = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'tester_1',
          status: 'ACTIVE',
          deletedAt: null,
          walletAddress: null,
          wallets: [],
          memberships: [],
        }),
        create: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      userCoopMembership: { upsert: vi.fn().mockResolvedValue({ id: 'membership_1' }) },
      loginCode: { create: vi.fn().mockResolvedValue({ id: 'code_1' }) },
      coopConfig: { findFirst: vi.fn().mockResolvedValue(null) },
    };

    const caller = authRouter.createCaller({
      db: db as any,
      req: { headers: {} } as any,
      res: {} as any,
      coopId: undefined,
    });

    const result = await caller.requestLoginCode({ email: 'tester1@test.cahootz.local' });

    expect(result.success).toBe(true);
    // Bypass disabled in production: a real code is generated and stored instead of skipped.
    expect(db.loginCode.create).toHaveBeenCalled();
  });
});
