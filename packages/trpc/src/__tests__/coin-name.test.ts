import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@repo/db', () => ({
  db: { coopConfig: { findFirst: vi.fn() } },
}));

import { db } from '@repo/db';
import { coinNameFrom, formatCoinAmount, getCoinName } from '../services/coop-chain-config-service.js';

describe('coin name', () => {
  beforeEach(() => {
    vi.mocked(db.coopConfig.findFirst).mockReset();
  });

  it("uses the commons' own coin name", () => {
    expect(coinNameFrom('SoulCoin')).toBe('SoulCoin');
    expect(formatCoinAmount(2.5, 'SoulCoin')).toBe('2.50 SoulCoin');
    expect(formatCoinAmount('12', 'SoulCoin')).toBe('12 SoulCoin');
  });

  it('falls back to plain "coins" when the commons has not named its coin', () => {
    expect(coinNameFrom('FakeCoin')).toBeNull();
    expect(coinNameFrom('  ')).toBeNull();
    expect(coinNameFrom(null)).toBeNull();
    expect(formatCoinAmount(1, null)).toBe('1.00 coins');
  });

  it('looks up the active config for the commons', async () => {
    vi.mocked(db.coopConfig.findFirst).mockResolvedValue({ scTokenName: 'HarborCoin' } as never);
    await expect(getCoinName('harbor')).resolves.toBe('HarborCoin');
    expect(db.coopConfig.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { coopId: 'harbor', isActive: true } }),
    );
  });

  it('never blocks a notification when the lookup fails', async () => {
    vi.mocked(db.coopConfig.findFirst).mockRejectedValue(new Error('db down'));
    await expect(getCoinName('harbor')).resolves.toBeNull();
  });
});
