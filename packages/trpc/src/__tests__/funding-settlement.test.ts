import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_FUNDING_SETTLEMENT_KEY,
  STORE_FUNDING_SETTLEMENT_KEY_PREFIX,
  getDefaultFundingSettlementAccount,
  resolveStoreSettlementAccount,
} from '../services/funding-settlement-service.js';

describe('funding settlement account resolution', () => {
  it('uses the platform setting for every official commons shop', async () => {
    const client = {
      platformConfig: {
        findUnique: vi.fn().mockImplementation(({ where }: any) => Promise.resolve(
          where.key === DEFAULT_FUNDING_SETTLEMENT_KEY
            ? { value: 'stripe-record-1', updatedAt: new Date(), updatedBy: 'admin-1' }
            : null,
        )),
      },
      stripeAccount: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'stripe-record-1',
          stripeAccountId: 'acct_shared',
          chargesEnabled: true,
          business: { id: 'business-1', name: 'Shared funding', ownerId: 'admin-1' },
        }),
      },
    };

    const result = await resolveStoreSettlementAccount({
      id: 'store-1',
      kind: 'OFFICIAL_COMMONS',
      business: { stripeAccount: { id: 'ignored-store-account' } },
    }, client);

    expect(client.platformConfig.findUnique).toHaveBeenCalledWith({
      where: { key: `${STORE_FUNDING_SETTLEMENT_KEY_PREFIX}store-1` },
      select: { value: true, updatedAt: true, updatedBy: true },
    });
    expect(client.platformConfig.findUnique).toHaveBeenCalledWith({
      where: { key: DEFAULT_FUNDING_SETTLEMENT_KEY },
      select: { value: true, updatedAt: true, updatedBy: true },
    });
    expect(result).toMatchObject({ stripeAccountId: 'acct_shared', chargesEnabled: true });
  });

  it('uses an individual override before the shared default', async () => {
    const client = {
      platformConfig: {
        findUnique: vi.fn().mockResolvedValue({ value: 'stripe-override', updatedAt: new Date(), updatedBy: 'admin-1' }),
      },
      stripeAccount: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'stripe-override',
          stripeAccountId: 'acct_override',
          chargesEnabled: true,
          business: { id: 'business-2', name: 'Dedicated funding', ownerId: 'admin-1' },
        }),
      },
    };

    const result = await resolveStoreSettlementAccount({ id: 'store-2', kind: 'OFFICIAL_COMMONS' }, client);

    expect(client.platformConfig.findUnique).toHaveBeenCalledTimes(1);
    expect(client.platformConfig.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: `${STORE_FUNDING_SETTLEMENT_KEY_PREFIX}store-2` },
    }));
    expect(result).toMatchObject({ stripeAccountId: 'acct_override' });
  });

  it('keeps member shops on their own connected account', async () => {
    const ownAccount = { id: 'member-stripe', stripeAccountId: 'acct_member', chargesEnabled: true };
    const client = {
      platformConfig: { findUnique: vi.fn() },
      stripeAccount: { findUnique: vi.fn() },
    };
    const result = await resolveStoreSettlementAccount({
      kind: 'MEMBER',
      business: { stripeAccount: ownAccount },
    }, client);

    expect(result).toBe(ownAccount);
    expect(client.platformConfig.findUnique).not.toHaveBeenCalled();
  });

  it('keeps official stores hidden until a shared account is configured', async () => {
    const client = {
      platformConfig: { findUnique: vi.fn().mockResolvedValue(null) },
      stripeAccount: { findUnique: vi.fn() },
    };
    await expect(getDefaultFundingSettlementAccount(client)).resolves.toBeNull();
  });
});
