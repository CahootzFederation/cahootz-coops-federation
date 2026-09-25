import { describe, expect, it, vi } from 'vitest';

import { ensureCommonsFundingStore, FUNDING_BADGES, highestFundingBadge } from '../services/funding-badge-service.js';
import { calculateSCReward } from '../services/reward-policy-service.js';

describe('commons funding badges', () => {
  it('keeps the canonical six tiers and normal commerce reward requests', () => {
    expect(FUNDING_BADGES.map(({ name, priceUSD, nominalReward }) => ({ name, priceUSD, nominalReward }))).toEqual([
      { name: 'Seed Supporter', priceUSD: 50, nominalReward: 5 },
      { name: 'Growth Supporter', priceUSD: 100, nominalReward: 10 },
      { name: 'Community Builder', priceUSD: 500, nominalReward: 50 },
      { name: 'Commons Pillar', priceUSD: 2_500, nominalReward: 250 },
      { name: 'Cornerstone Partner', priceUSD: 10_000, nominalReward: 1_000 },
      { name: 'Legacy Founder', priceUSD: 50_000, nominalReward: 5_000 },
    ]);
    for (const badge of FUNDING_BADGES) {
      expect(calculateSCReward(badge.priceUSD)).toBe(badge.nominalReward);
    }
  });

  it('selects the highest purchased tier independently of purchase order', () => {
    const highest = highestFundingBadge([
      { tier: 'SEED_SUPPORTER' as const },
      { tier: 'COMMONS_PILLAR' as const },
      { tier: 'GROWTH_SUPPORTER' as const },
    ]);
    expect(highest?.tier).toBe('COMMONS_PILLAR');
  });

  describe('badge descriptions', () => {
    function fakeDb(scTokenName: string | null) {
      const created: any[] = [];
      const db = {
        productCategoryConfig: { upsert: vi.fn() },
        coopConfig: { findFirst: vi.fn().mockResolvedValue(scTokenName === null ? null : { scTokenName }) },
        store: { findFirst: vi.fn().mockResolvedValue({ id: 'store-1', business: {} }) },
        product: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn(async ({ data }) => { created.push(data); }),
          update: vi.fn(),
        },
      };
      return { db, created };
    }

    it("names the commons' own coin", async () => {
      const { db, created } = fakeDb('SoulCoin');
      await ensureCommonsFundingStore(db, { coopId: 'soulaan', ownerId: 'owner', coopName: 'Soulaan Coop' });
      expect(created[0].priceUSD).toBe(50);
      expect(created[0].description).toContain('Rewards in SoulCoin follow');
    });

    it.each([null, 'FakeCoin'])('falls back to a generic coin name when the commons has none (%s)', async (name) => {
      const { db, created } = fakeDb(name);
      await ensureCommonsFundingStore(db, { coopId: 'demo', ownerId: 'owner', coopName: 'Demo' });
      expect(created.every((product) => product.description.includes('Rewards in your commons Soul Coin follow'))).toBe(true);
    });
  });
});
