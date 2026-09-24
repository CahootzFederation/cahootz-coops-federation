import { describe, expect, it } from 'vitest';

import { FUNDING_BADGES, highestFundingBadge } from '../services/funding-badge-service.js';
import { calculateSCReward } from '../services/reward-policy-service.js';

describe('commons funding badges', () => {
  it('keeps the canonical six tiers and normal commerce reward requests', () => {
    expect(FUNDING_BADGES.map(({ name, priceUSD, nominalReward }) => ({ name, priceUSD, nominalReward }))).toEqual([
      { name: 'Seed Supporter', priceUSD: 500, nominalReward: 50 },
      { name: 'Growth Supporter', priceUSD: 1_000, nominalReward: 100 },
      { name: 'Community Builder', priceUSD: 5_000, nominalReward: 500 },
      { name: 'Commons Pillar', priceUSD: 25_000, nominalReward: 2_500 },
      { name: 'Cornerstone Partner', priceUSD: 100_000, nominalReward: 10_000 },
      { name: 'Legacy Founder', priceUSD: 500_000, nominalReward: 50_000 },
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
});
