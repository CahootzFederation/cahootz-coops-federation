import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const owner = await prisma.user.upsert({
    where: { email: 'market-admin@test.cahootz.local' },
    update: { status: 'ACTIVE', roles: ['member', 'admin'] },
    create: {
      email: 'market-admin@test.cahootz.local',
      name: 'E2E Market Admin',
      status: 'ACTIVE',
      roles: ['member', 'admin'],
      walletAddress: '0x00000000000000000000000000000000000000e2',
    },
  });
  await prisma.productCategoryConfig.upsert({
    where: { key: 'FOUNDER_BADGES' },
    update: { label: 'Funding Badges', isAdminOnly: true, isActive: true },
    create: { key: 'FOUNDER_BADGES', label: 'Funding Badges', isAdminOnly: true, isActive: true, sortOrder: 100 },
  });
  let store = await prisma.store.findFirst({
    where: { coopId: 'cahootz', kind: 'OFFICIAL_COMMONS' },
    select: { id: true, businessId: true },
  });
  if (!store) {
    const business = await prisma.business.create({ data: { ownerId: owner.id, coopId: 'cahootz', name: 'Cahootz Commons', city: 'Online', isApproved: true } });
    store = await prisma.store.create({
      data: { ownerId: owner.id, coopId: 'cahootz', businessId: business.id, kind: 'OFFICIAL_COMMONS', name: 'Cahootz Funding Shop', description: 'Official commons funding badges.', category: 'FOUNDER_PACKAGE', status: 'APPROVED', isScVerified: true, isFeatured: true, acceptsUC: false, ucDiscountPercent: 0 },
      select: { id: true, businessId: true },
    });
    const badges = [
      ['SEED_SUPPORTER', 'Seed Supporter', 50],
      ['GROWTH_SUPPORTER', 'Growth Supporter', 100],
      ['COMMUNITY_BUILDER', 'Community Builder', 500],
      ['COMMONS_PILLAR', 'Commons Pillar', 2_500],
      ['CORNERSTONE_PARTNER', 'Cornerstone Partner', 10_000],
      ['LEGACY_FOUNDER', 'Legacy Founder', 50_000],
    ] as const;
    await prisma.product.createMany({ data: badges.map(([tier, name, priceUSD]) => ({ storeId: store!.id, name, description: `${name} funding badge`, category: 'FOUNDER_BADGES', kind: 'FUNDING_BADGE', fundingBadgeTier: tier, priceUSD, images: [], trackInventory: false, isActive: true, isFeatured: true })) });
  }

  await seedSecondCommonsShop(owner.id);

  const stripeAccountId = process.env.E2E_STRIPE_CONNECTED_ACCOUNT_ID;
  if (!stripeAccountId) {
    console.log('E2E Stripe Connect account not configured; payment journey will be skipped.');
    await ensurePlaceholderFundingSettlement(store?.businessId, owner.id);
    return;
  }
  if (!stripeAccountId.startsWith('acct_')) {
    throw new Error('E2E_STRIPE_CONNECTED_ACCOUNT_ID must be a Stripe test Connect account ID');
  }
  if (!store?.businessId) throw new Error('Official Cahootz funding shop was not provisioned');

  // The same Connect account may already be linked to another business (e.g. a
  // developer's existing funding account); reuse that row rather than trying to
  // create a second one with the same unique stripeAccountId.
  const existingAccount = await prisma.stripeAccount.findUnique({ where: { stripeAccountId } });
  const settlementAccount = existingAccount ?? await prisma.stripeAccount.upsert({
    where: { businessId: store.businessId },
    update: {
      stripeAccountId,
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      verificationStatus: 'VERIFIED',
      onboardingStatus: 'PAYOUTS_ENABLED',
      requirementsCurrentlyDue: [],
      requirementsEventuallyDue: [],
      requirementsPastDue: [],
    },
    create: {
      businessId: store.businessId,
      stripeAccountId,
      accountType: 'express',
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      verificationStatus: 'VERIFIED',
      onboardingStatus: 'PAYOUTS_ENABLED',
      requirementsCurrentlyDue: [],
      requirementsEventuallyDue: [],
      requirementsPastDue: [],
    },
  });
  await prisma.platformConfig.upsert({
    where: { key: 'marketplace.fundingSettlementStripeAccountId' },
    create: {
      key: 'marketplace.fundingSettlementStripeAccountId',
      value: settlementAccount.id,
      updatedBy: owner.id,
    },
    update: { value: settlementAccount.id, updatedBy: owner.id },
  });
}

/**
 * Funding shops are only listed once the shared funding settlement account can
 * accept charges. Without a real Stripe test account (CI), point that setting at
 * a placeholder so the Shop still lists the badges; listing only reads the
 * cached capability flags. Never replaces a settlement account that's already
 * configured, such as a developer's real one.
 */
async function ensurePlaceholderFundingSettlement(businessId: string | undefined, ownerId: string) {
  const key = 'marketplace.fundingSettlementStripeAccountId';
  if (await prisma.platformConfig.findUnique({ where: { key } })) return;
  if (!businessId) throw new Error('Official Cahootz funding shop was not provisioned');

  const placeholder = await prisma.stripeAccount.upsert({
    where: { businessId },
    update: {},
    create: {
      businessId,
      stripeAccountId: 'acct_e2e_funding_placeholder',
      accountType: 'express',
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      verificationStatus: 'VERIFIED',
      onboardingStatus: 'PAYOUTS_ENABLED',
      requirementsCurrentlyDue: [],
      requirementsEventuallyDue: [],
      requirementsPastDue: [],
    },
  });
  await prisma.platformConfig.create({ data: { key, value: placeholder.id, updatedBy: ownerId } });
}

/**
 * A second commons with one payment-ready member shop, joined by User A, so the
 * Shop tab's commons switcher can be exercised. Listing a shop only reads the
 * cached Stripe capability flags, so a placeholder account id is enough.
 */
async function seedSecondCommonsShop(ownerId: string) {
  const coopId = 'e2e-market';
  const memberEmail = process.env.E2E_USER_A_EMAIL || 'releaseclick1@test.cahootz.local';

  const config = await prisma.coopConfig.findFirst({ where: { coopId, isActive: true } });
  if (!config) {
    await prisma.coopConfig.create({
      data: {
        coopId,
        version: 1,
        isActive: true,
        name: 'E2E Market Commons',
        slug: 'E2E Market',
        charterText: 'E2E Market Commons fixture charter.',
        missionGoals: [],
        proposalCategories: [],
        sectorExclusions: [],
        structuralWeights: { feasibility: 0.4, risk: 0.35, accountability: 0.25 },
        scoreMix: { missionWeight: 0.6, structuralWeight: 0.4 },
        createdBy: 'system',
      },
    });
  }

  const member = await prisma.user.findUnique({ where: { email: memberEmail }, select: { id: true, walletAddress: true } });
  if (!member) {
    console.warn(`${memberEmail} not found; seed test users before the marketplace fixtures.`);
  } else {
    // Checkout identifies the buyer by wallet address, and email-only test
    // accounts never get one, so give User A a fixed address to buy with.
    if (!member.walletAddress) {
      await prisma.user.update({ where: { id: member.id }, data: { walletAddress: '0x0000000000000000000000000000000000e2e0a1' } });
    }
    await prisma.userCoopMembership.upsert({
      where: { userId_coopId: { userId: member.id, coopId } },
      update: { status: 'ACTIVE' },
      create: { userId: member.id, coopId, status: 'ACTIVE', roles: ['member'] },
    });
  }

  let store = await prisma.store.findFirst({ where: { coopId, name: 'E2E Second Commons Shop', deletedAt: null }, select: { id: true } });
  if (!store) {
    const business = await prisma.business.create({ data: { ownerId, coopId, name: 'E2E Second Commons Shop', city: 'Online', isApproved: true } });
    await prisma.stripeAccount.create({
      data: {
        businessId: business.id,
        stripeAccountId: 'acct_e2e_second_commons',
        accountType: 'express',
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
        verificationStatus: 'VERIFIED',
        onboardingStatus: 'PAYOUTS_ENABLED',
        requirementsCurrentlyDue: [],
        requirementsEventuallyDue: [],
        requirementsPastDue: [],
      },
    });
    store = await prisma.store.create({
      data: { ownerId, coopId, businessId: business.id, kind: 'MEMBER', name: 'E2E Second Commons Shop', description: 'Member shop in the E2E second commons.', category: 'OTHER', status: 'APPROVED', acceptsUC: false, ucDiscountPercent: 0 },
      select: { id: true },
    });
    await prisma.product.create({ data: { storeId: store.id, name: 'E2E Second Commons Tote', description: 'E2E fixture product', category: 'OTHER', priceUSD: 12, images: [], quantity: 100, isActive: true } });
  }
}

main().finally(() => prisma.$disconnect());
