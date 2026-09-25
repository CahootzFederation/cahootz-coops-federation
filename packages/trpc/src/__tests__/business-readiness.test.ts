import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@repo/db', () => ({
  db: {
    user: { findFirst: vi.fn().mockResolvedValue(null) },
    business: { findUnique: vi.fn() },
    wallet: { findMany: vi.fn() },
    stripeAccount: { findUnique: vi.fn() },
    platformConfig: { findUnique: vi.fn() },
  },
}));

vi.mock('../services/stripe-connect-service.js', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  canAcceptPayments: vi.fn().mockResolvedValue(false),
  canReceivePayouts: vi.fn().mockResolvedValue(false),
}));

import { db } from '@repo/db';
import { stripeConnectRouter } from '../routers/stripe-connect.js';

const walletAddress = '0x1234567890123456789012345678901234567890';

function caller() {
  return stripeConnectRouter.createCaller({
    db,
    req: { headers: { 'x-wallet-address': walletAddress } } as any,
    res: {} as any,
  } as any);
}

describe('stripeConnect.getBusinessReadiness', () => {
  beforeEach(() => {
    vi.mocked(db.wallet.findMany).mockResolvedValue([]);
  });

  it('treats an official commons funding shop as SC-eligible without its own Stripe account', async () => {
    vi.mocked(db.business.findUnique).mockResolvedValue({
      id: 'biz-official', name: 'Soulaan Coop Commons', ownerId: 'owner', stripeAccount: null,
      store: { id: 'store-official', kind: 'OFFICIAL_COMMONS', isScVerified: true },
    } as any);
    // Shared funding settlement account configured for the platform.
    vi.mocked(db.platformConfig.findUnique).mockImplementation((async ({ where }: any) =>
      where.key === 'marketplace.fundingSettlementStripeAccountId' ? { value: 'acct-row', updatedAt: new Date(), updatedBy: 'admin' } : null) as any);
    vi.mocked(db.stripeAccount.findUnique).mockResolvedValue({
      id: 'acct-row', chargesEnabled: true, payoutsEnabled: true, business: { id: 'x', name: 'x', ownerId: 'x' },
    } as any);

    const result = await caller().getBusinessReadiness({ businessId: 'biz-official' });
    expect(result.scRewardEligible).toBe(true);
    expect(result.canAcceptPayments).toBe(true);
    expect(result.nonEligibleReasons).toEqual([]);
  });

  it('still requires a member shop to have its own charge-enabled account and a wallet', async () => {
    vi.mocked(db.business.findUnique).mockResolvedValue({
      id: 'biz-member', name: 'Member', ownerId: 'owner', stripeAccount: null,
      store: { id: 'store-member', kind: 'MEMBER', isScVerified: true },
    } as any);

    const result = await caller().getBusinessReadiness({ businessId: 'biz-member' });
    expect(result.scRewardEligible).toBe(false);
    expect(result.nonEligibleReasons).toEqual(['NO_STRIPE_ACCOUNT', 'NO_WALLET']);
  });
});
