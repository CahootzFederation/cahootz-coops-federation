import type { FundingBadgeTier } from '@repo/db';

export type FundingBadgeDefinition = {
  tier: FundingBadgeTier;
  rank: number;
  name: string;
  shortName: string;
  priceUSD: number;
  nominalReward: number;
  color: string;
};

export const FUNDING_BADGES: readonly FundingBadgeDefinition[] = [
  { tier: 'SEED_SUPPORTER', rank: 1, name: 'Seed Supporter', shortName: 'Seed', priceUSD: 50, nominalReward: 5, color: '#B7791F' },
  { tier: 'GROWTH_SUPPORTER', rank: 2, name: 'Growth Supporter', shortName: 'Growth', priceUSD: 100, nominalReward: 10, color: '#2F855A' },
  { tier: 'COMMUNITY_BUILDER', rank: 3, name: 'Community Builder', shortName: 'Builder', priceUSD: 500, nominalReward: 50, color: '#2B6CB0' },
  { tier: 'COMMONS_PILLAR', rank: 4, name: 'Commons Pillar', shortName: 'Pillar', priceUSD: 2_500, nominalReward: 250, color: '#6B46C1' },
  { tier: 'CORNERSTONE_PARTNER', rank: 5, name: 'Cornerstone Partner', shortName: 'Cornerstone', priceUSD: 10_000, nominalReward: 1_000, color: '#C05621' },
  { tier: 'LEGACY_FOUNDER', rank: 6, name: 'Legacy Founder', shortName: 'Legacy', priceUSD: 50_000, nominalReward: 5_000, color: '#975A16' },
] as const;

export const FUNDING_BADGE_BY_TIER = new Map(
  FUNDING_BADGES.map((badge) => [badge.tier, badge]),
);

export function highestFundingBadge<T extends { tier: FundingBadgeTier }>(badges: T[]): T | null {
  return [...badges].sort(
    (a, b) => (FUNDING_BADGE_BY_TIER.get(b.tier)?.rank ?? 0) - (FUNDING_BADGE_BY_TIER.get(a.tier)?.rank ?? 0),
  )[0] ?? null;
}

/**
 * Idempotently provisions the protected official funding store for one commons.
 * The store is approved administratively but remains absent from public queries
 * until the commons completes Stripe Connect onboarding.
 */
export async function ensureCommonsFundingStore(
  db: any,
  input: { coopId: string; ownerId: string; coopName: string },
) {
  await db.productCategoryConfig.upsert({
    where: { key: 'FOUNDER_BADGES' },
    update: { label: 'Funding Badges', isAdminOnly: true, isActive: true, sortOrder: 100 },
    create: { key: 'FOUNDER_BADGES', label: 'Funding Badges', isAdminOnly: true, isActive: true, sortOrder: 100 },
  });

  // Each commons names its own coin; "FakeCoin" is the schema default, i.e. unset.
  const config = await db.coopConfig.findFirst({
    where: { coopId: input.coopId, isActive: true },
    orderBy: { version: 'desc' },
    select: { scTokenName: true },
  });
  const coinName = config?.scTokenName && config.scTokenName !== 'FakeCoin'
    ? config.scTokenName
    : 'your commons Soul Coin';

  let store = await db.store.findFirst({
    where: { coopId: input.coopId, kind: 'OFFICIAL_COMMONS', deletedAt: null },
    include: { business: true },
  });

  if (!store) {
    const business = await db.business.create({
      data: {
        ownerId: input.ownerId,
        coopId: input.coopId,
        name: `${input.coopName} Commons`,
        city: 'Online',
        isApproved: true,
      },
    });
    store = await db.store.create({
      data: {
        ownerId: input.ownerId,
        coopId: input.coopId,
        businessId: business.id,
        kind: 'OFFICIAL_COMMONS',
        name: `${input.coopName} Funding Shop`,
        description: `Support ${input.coopName} directly and carry your contribution badge throughout the commons.`,
        category: 'FOUNDER_PACKAGE',
        status: 'APPROVED',
        acceptsUC: false,
        ucDiscountPercent: 0,
        acceptsQuickPay: false,
        isScVerified: true,
        scVerifiedAt: new Date(),
        isFeatured: true,
      },
      include: { business: true },
    });
  }

  for (const badge of FUNDING_BADGES) {
    const existing = await db.product.findFirst({
      where: { storeId: store.id, fundingBadgeTier: badge.tier },
      select: { id: true },
    });
    const data = {
      name: badge.name,
      description: `Fund ${input.coopName} with a $${badge.priceUSD.toLocaleString('en-US')} contribution and receive the ${badge.name} badge. Rewards in ${coinName} follow the commons' normal capped contribution policy.`,
      category: 'FOUNDER_BADGES',
      kind: 'FUNDING_BADGE',
      fundingBadgeTier: badge.tier,
      priceUSD: badge.priceUSD,
      ucDiscountPrice: null,
      quantity: 0,
      trackInventory: false,
      allowBackorder: false,
      isActive: true,
      isFeatured: true,
    };
    if (existing) {
      await db.product.update({ where: { id: existing.id }, data });
    } else {
      await db.product.create({ data: { ...data, storeId: store.id, images: [] } });
    }
  }

  return store;
}

export async function grantFundingBadgesForTransaction(db: any, transactionId: string) {
  const transaction = await db.commerceTransaction.findUnique({
    where: { id: transactionId },
    select: { id: true, customerId: true, coopId: true, metadata: true },
  });
  if (!transaction) return [];

  const metadata = transaction.metadata && typeof transaction.metadata === 'object' && !Array.isArray(transaction.metadata)
    ? transaction.metadata as Record<string, unknown>
    : {};
  const items = Array.isArray(metadata.items) ? metadata.items : [];
  const productIds = items.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const productId = (item as Record<string, unknown>).productId;
    return typeof productId === 'string' ? [productId] : [];
  });
  if (!productIds.length) return [];

  const products = await db.product.findMany({
    where: { id: { in: productIds }, kind: 'FUNDING_BADGE', fundingBadgeTier: { not: null } },
    select: { id: true, fundingBadgeTier: true },
  });

  const grants = [];
  for (const product of products) {
    const grant = await db.fundingBadgeEntitlement.upsert({
      where: {
        userId_coopId_tier: {
          userId: transaction.customerId,
          coopId: transaction.coopId,
          tier: product.fundingBadgeTier!,
        },
      },
      update: {},
      create: {
        userId: transaction.customerId,
        coopId: transaction.coopId,
        tier: product.fundingBadgeTier!,
        productId: product.id,
        commerceTransactionId: transaction.id,
      },
    });
    grants.push(grant);
  }
  return grants;
}
