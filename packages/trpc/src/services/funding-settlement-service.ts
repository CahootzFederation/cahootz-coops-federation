import Stripe from 'stripe';
import { TRPCError } from '@trpc/server';

import { db } from '@repo/db';

export const DEFAULT_FUNDING_SETTLEMENT_KEY = 'marketplace.fundingSettlementStripeAccountId';
export const STORE_FUNDING_SETTLEMENT_KEY_PREFIX = 'marketplace.storeFundingSettlementStripeAccountId.';

type DbClient = typeof db | any;

function storeFundingSettlementKey(storeId: string) {
  return `${STORE_FUNDING_SETTLEMENT_KEY_PREFIX}${storeId}`;
}

async function getFundingSettlementAccountForKey(key: string, client: DbClient = db) {
  const setting = await client.platformConfig.findUnique({
    where: { key },
    select: { value: true, updatedAt: true, updatedBy: true },
  });
  if (!setting) return null;

  const account = await client.stripeAccount.findUnique({
    where: { id: setting.value },
    include: { business: { select: { id: true, name: true, ownerId: true } } },
  });
  return account ? { ...account, configuredAt: setting.updatedAt, configuredBy: setting.updatedBy } : null;
}

export async function getDefaultFundingSettlementAccount(client: DbClient = db) {
  return getFundingSettlementAccountForKey(DEFAULT_FUNDING_SETTLEMENT_KEY, client);
}

export async function getStoreFundingSettlementOverride(storeId: string, client: DbClient = db) {
  return getFundingSettlementAccountForKey(storeFundingSettlementKey(storeId), client);
}

export async function resolveStoreSettlementAccount(
  store: {
    id?: string;
    kind: string;
    business?: { stripeAccount?: unknown | null } | null;
  },
  client: DbClient = db,
) {
  if (store.kind === 'OFFICIAL_COMMONS') {
    if (store.id) {
      const override = await getStoreFundingSettlementOverride(store.id, client);
      if (override) return override;
    }
    return getDefaultFundingSettlementAccount(client);
  }
  return store.business?.stripeAccount ?? null;
}

export async function listFundingSettlementAccounts(client: DbClient = db) {
  const [accounts, selected, officialStores, overrideSettings] = await Promise.all([
    client.stripeAccount.findMany({
      include: { business: { select: { id: true, name: true, coopId: true } } },
      orderBy: { updatedAt: 'desc' },
    }),
    getDefaultFundingSettlementAccount(client),
    client.store.findMany({
      where: { kind: 'OFFICIAL_COMMONS', deletedAt: null },
      select: { id: true, coopId: true, name: true },
      orderBy: [{ coopId: 'asc' }, { createdAt: 'asc' }],
    }),
    client.platformConfig.findMany({
      where: { key: { startsWith: STORE_FUNDING_SETTLEMENT_KEY_PREFIX } },
      select: { key: true, value: true, updatedAt: true },
    }),
  ]);

  const accountsById = new Map(accounts.map((account: any) => [account.id, account]));
  const overridesByStoreId = new Map(overrideSettings.map((setting: any) => [
    setting.key.slice(STORE_FUNDING_SETTLEMENT_KEY_PREFIX.length),
    setting,
  ]));

  const summarizeAccount = (account: any) => account ? {
    id: account.id,
    stripeAccountId: account.stripeAccountId,
    businessName: account.business.name,
    chargesEnabled: account.chargesEnabled,
    payoutsEnabled: account.payoutsEnabled,
  } : null;

  return {
    selected: selected ? {
      ...summarizeAccount(selected),
      configuredAt: selected.configuredAt,
    } : null,
    officialStores: officialStores.map((store: any) => {
      const setting = overridesByStoreId.get(store.id) as any;
      const override = setting ? accountsById.get(setting.value) : null;
      return {
        ...store,
        usesDefault: !override,
        override: summarizeAccount(override),
        effectiveAccount: summarizeAccount(override ?? selected),
        configuredAt: setting?.updatedAt ?? null,
      };
    }),
    accounts: accounts.map((account: any) => ({
      id: account.id,
      stripeAccountId: account.stripeAccountId,
      businessName: account.business.name,
      coopId: account.business.coopId,
      chargesEnabled: account.chargesEnabled,
      payoutsEnabled: account.payoutsEnabled,
      verificationStatus: account.verificationStatus,
    })),
  };
}

async function verifyAndUpsertFundingSettlementAccount(input: {
  stripeAccountId: string;
  actorUserId: string;
}, client: DbClient = db) {
  if (!/^acct_[A-Za-z0-9]+$/.test(input.stripeAccountId)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Enter a valid Stripe connected account ID' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2026-02-25.clover',
  });
  let platformAccount: Stripe.Account;
  let retrieved: Stripe.Account | Stripe.DeletedAccount;
  try {
    [platformAccount, retrieved] = await Promise.all([
      stripe.accounts.retrieve(),
      stripe.accounts.retrieve(input.stripeAccountId),
    ]);
  } catch {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Stripe could not verify that connected account for this platform',
    });
  }
  if ('deleted' in retrieved && retrieved.deleted) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'That Stripe account has been deleted' });
  }
  if (platformAccount.id === retrieved.id) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Use a connected account, not the platform account, for destination charges',
    });
  }

  let account = await client.stripeAccount.findUnique({
    where: { stripeAccountId: retrieved.id },
  });
  const accountData = {
    accountType: retrieved.type ?? 'express',
    country: retrieved.country ?? 'US',
    chargesEnabled: retrieved.charges_enabled,
    payoutsEnabled: retrieved.payouts_enabled,
    detailsSubmitted: retrieved.details_submitted,
    requirementsCurrentlyDue: retrieved.requirements?.currently_due ?? [],
    requirementsEventuallyDue: retrieved.requirements?.eventually_due ?? [],
    requirementsPastDue: retrieved.requirements?.past_due ?? [],
    verificationStatus: retrieved.charges_enabled ? 'VERIFIED' : 'PENDING',
    onboardingStatus: retrieved.payouts_enabled
      ? 'PAYOUTS_ENABLED'
      : retrieved.charges_enabled
        ? 'CHARGES_ENABLED'
        : retrieved.details_submitted
          ? 'SUBMITTED'
          : 'DRAFT',
    disabledReason: retrieved.requirements?.disabled_reason ?? null,
  } as const;

  if (account) {
    return client.stripeAccount.update({ where: { id: account.id }, data: accountData });
  }

  const actor = await client.user.findUnique({ where: { id: input.actorUserId }, select: { id: true } });
  if (!actor) throw new TRPCError({ code: 'NOT_FOUND', message: 'Platform administrator not found' });
  const business = await client.business.create({
    data: {
      ownerId: actor.id,
      coopId: 'platform',
      name: 'Shared Commons Funding Settlement',
      city: 'Online',
      isApproved: true,
    },
  });
  return client.stripeAccount.create({
    data: { businessId: business.id, stripeAccountId: retrieved.id, ...accountData },
  });
}

export async function setDefaultFundingSettlementAccount(input: {
  stripeAccountId: string;
  actorUserId: string;
}, client: DbClient = db) {
  const account = await verifyAndUpsertFundingSettlementAccount(input, client);

  await client.platformConfig.upsert({
    where: { key: DEFAULT_FUNDING_SETTLEMENT_KEY },
    create: { key: DEFAULT_FUNDING_SETTLEMENT_KEY, value: account.id, updatedBy: input.actorUserId },
    update: { value: account.id, updatedBy: input.actorUserId },
  });

  return {
    id: account.id,
    stripeAccountId: account.stripeAccountId,
    chargesEnabled: account.chargesEnabled,
    payoutsEnabled: account.payoutsEnabled,
  };
}

export async function setStoreFundingSettlementAccount(input: {
  storeId: string;
  stripeAccountId: string | null;
  actorUserId: string;
}, client: DbClient = db) {
  const store = await client.store.findFirst({
    where: { id: input.storeId, kind: 'OFFICIAL_COMMONS', deletedAt: null },
    select: { id: true },
  });
  if (!store) throw new TRPCError({ code: 'NOT_FOUND', message: 'Official badge store not found' });

  const key = storeFundingSettlementKey(store.id);
  if (input.stripeAccountId === null) {
    await client.platformConfig.deleteMany({ where: { key } });
    return { storeId: store.id, usesDefault: true };
  }

  const account = await verifyAndUpsertFundingSettlementAccount({
    stripeAccountId: input.stripeAccountId,
    actorUserId: input.actorUserId,
  }, client);
  await client.platformConfig.upsert({
    where: { key },
    create: { key, value: account.id, updatedBy: input.actorUserId },
    update: { value: account.id, updatedBy: input.actorUserId },
  });
  return {
    storeId: store.id,
    usesDefault: false,
    stripeAccountId: account.stripeAccountId,
    chargesEnabled: account.chargesEnabled,
    payoutsEnabled: account.payoutsEnabled,
  };
}
