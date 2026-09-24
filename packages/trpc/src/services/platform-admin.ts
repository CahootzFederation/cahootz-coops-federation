import type { ApplicationStatus } from "@repo/db";
import { FUNDING_BADGE_BY_TIER } from "./funding-badge-service.js";
import {
  getDefaultFundingSettlementAccount,
  getStoreFundingSettlementOverride,
} from "./funding-settlement-service.js";

export type CommonsSummary = {
  coopId: string;
  name: string | null;
  slug: string | null;
  tagline: string | null;
  chainId: number | null;
  chainName: string | null;
  isDemo: boolean;
  isPrivate: boolean;
  iconEmoji: string | null;
  iconColor: string | null;
  createdAt: string;
  memberCount: number;
  applicationCount: number;
  postCount: number;
};

export type CommonsDetail = CommonsSummary & {
  description: string | null;
  displayMission: string | null;
  charterText: string;
  missionGoals: unknown;
  scTokenAddress: string | null;
  scTokenSymbol: string | null;
  scTokenName: string | null;
  allyTokenAddress: string | null;
  ucTokenAddress: string | null;
  redemptionVaultAddress: string | null;
  treasurySafeAddress: string | null;
  verifiedStoreRegistryAddress: string | null;
  storePaymentRouterAddress: string | null;
  rewardEngineAddress: string | null;
  rpcUrl: string | null;
};

async function countsByCoop() {
  const { db } = await import("@repo/db");

  const [members, applications, posts] = await Promise.all([
    db.userCoopMembership.groupBy({ by: ["coopId"], _count: { _all: true } }),
    db.application.groupBy({ by: ["coopId"], _count: { _all: true } }),
    db.commonsPost.groupBy({ by: ["coopId"], _count: { _all: true } }),
  ]);

  const toMap = (rows: { coopId: string; _count: { _all: number } }[]) =>
    new Map(rows.map((r) => [r.coopId, r._count._all]));

  return {
    members: toMap(members),
    applications: toMap(applications),
    posts: toMap(posts),
  };
}

export async function listCommonsWithStats(): Promise<CommonsSummary[]> {
  const { db } = await import("@repo/db");

  const [configs, counts] = await Promise.all([
    db.coopConfig.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "asc" },
    }),
    countsByCoop(),
  ]);

  return configs.map((c) => ({
    coopId: c.coopId,
    name: c.name,
    slug: c.slug,
    tagline: c.tagline,
    chainId: c.chainId,
    chainName: c.chainName,
    isDemo: c.isDemo,
    isPrivate: c.isPrivate,
    iconEmoji: c.iconEmoji,
    iconColor: c.iconColor,
    createdAt: c.createdAt.toISOString(),
    memberCount: counts.members.get(c.coopId) ?? 0,
    applicationCount: counts.applications.get(c.coopId) ?? 0,
    postCount: counts.posts.get(c.coopId) ?? 0,
  }));
}

export async function getCommonsDetail(coopId: string): Promise<CommonsDetail | null> {
  const { db } = await import("@repo/db");

  const [config, counts] = await Promise.all([
    db.coopConfig.findFirst({ where: { coopId, isActive: true } }),
    countsByCoop(),
  ]);

  if (!config) return null;

  return {
    coopId: config.coopId,
    name: config.name,
    slug: config.slug,
    tagline: config.tagline,
    chainId: config.chainId,
    chainName: config.chainName,
    isDemo: config.isDemo,
    isPrivate: config.isPrivate,
    iconEmoji: config.iconEmoji,
    iconColor: config.iconColor,
    createdAt: config.createdAt.toISOString(),
    memberCount: counts.members.get(config.coopId) ?? 0,
    applicationCount: counts.applications.get(config.coopId) ?? 0,
    postCount: counts.posts.get(config.coopId) ?? 0,
    description: config.description,
    displayMission: config.displayMission,
    charterText: config.charterText,
    missionGoals: config.missionGoals,
    scTokenAddress: config.scTokenAddress,
    scTokenSymbol: config.scTokenSymbol,
    scTokenName: config.scTokenName,
    allyTokenAddress: config.allyTokenAddress,
    ucTokenAddress: config.ucTokenAddress,
    redemptionVaultAddress: config.redemptionVaultAddress,
    treasurySafeAddress: config.treasurySafeAddress,
    verifiedStoreRegistryAddress: config.verifiedStoreRegistryAddress,
    storePaymentRouterAddress: config.storePaymentRouterAddress,
    rewardEngineAddress: config.rewardEngineAddress,
    rpcUrl: config.rpcUrl,
  };
}

export async function listCommonsStores(coopId: string) {
  const { db } = await import("@repo/db");
  const [stores, sharedDefault] = await Promise.all([
    db.store.findMany({
      where: { coopId, deletedAt: null },
      include: {
        business: { include: { stripeAccount: true } },
        _count: { select: { products: true } },
      },
      orderBy: [{ kind: "desc" }, { createdAt: "asc" }],
    }),
    getDefaultFundingSettlementAccount(db),
  ]);

  return Promise.all(stores.map(async (store) => {
    const override = store.kind === "OFFICIAL_COMMONS"
      ? await getStoreFundingSettlementOverride(store.id, db)
      : null;
    const settlement = store.kind === "OFFICIAL_COMMONS"
      ? override ?? sharedDefault
      : store.business?.stripeAccount ?? null;
    return {
      id: store.id,
      coopId: store.coopId,
      name: store.name,
      description: store.description,
      kind: store.kind,
      status: store.status,
      category: store.category,
      imageUrl: store.imageUrl,
      city: store.city,
      state: store.state,
      productCount: store._count.products,
      totalOrders: store.totalOrders,
      totalSales: store.totalSales,
      paymentReady: settlement?.chargesEnabled === true,
      publicReady: store.status === "APPROVED" && settlement?.chargesEnabled === true,
      settlementSource: store.kind === "OFFICIAL_COMMONS"
        ? override ? "STORE_OVERRIDE" as const : "SHARED_DEFAULT" as const
        : "STORE_ACCOUNT" as const,
    };
  }));
}

export async function getCommonsStoreDetail(coopId: string, storeId: string) {
  const { db } = await import("@repo/db");
  const store = await db.store.findFirst({
    where: { id: storeId, coopId, deletedAt: null },
    include: {
      business: { include: { stripeAccount: true } },
      products: {
        orderBy: [{ isActive: "desc" }, { priceUSD: "asc" }],
        include: {
          _count: {
            select: {
              fundingBadgeEntitlements: { where: { status: "ACTIVE" } },
            },
          },
        },
      },
    },
  });
  if (!store) return null;

  const override = store.kind === "OFFICIAL_COMMONS"
    ? await getStoreFundingSettlementOverride(store.id, db)
    : null;
  const settlement = store.kind === "OFFICIAL_COMMONS"
    ? override ?? await getDefaultFundingSettlementAccount(db)
    : store.business?.stripeAccount ?? null;

  return {
    id: store.id,
    coopId: store.coopId,
    name: store.name,
    description: store.description,
    kind: store.kind,
    category: store.category,
    imageUrl: store.imageUrl,
    city: store.city,
    state: store.state,
    status: store.status,
    isFeatured: store.isFeatured,
    totalSales: store.totalSales,
    totalOrders: store.totalOrders,
    createdAt: store.createdAt.toISOString(),
    publicReady: store.status === "APPROVED" && settlement?.chargesEnabled === true,
    settlement: settlement ? {
      source: store.kind === "OFFICIAL_COMMONS"
        ? override ? "STORE_OVERRIDE" as const : "SHARED_DEFAULT" as const
        : "STORE_ACCOUNT" as const,
      stripeAccountId: settlement.stripeAccountId,
      businessName: store.kind === "OFFICIAL_COMMONS"
        ? settlement.business.name
        : store.business?.name ?? store.name,
      chargesEnabled: settlement.chargesEnabled,
      payoutsEnabled: settlement.payoutsEnabled,
    } : null,
    products: store.products.map((product) => {
      const badge = product.fundingBadgeTier
        ? FUNDING_BADGE_BY_TIER.get(product.fundingBadgeTier)
        : null;
      return {
        id: product.id,
        name: product.name,
        description: product.description,
        category: product.category,
        kind: product.kind,
        tier: product.fundingBadgeTier,
        rank: badge?.rank ?? 0,
        color: badge?.color ?? "#64748B",
        priceUSD: product.priceUSD,
        nominalReward: badge?.nominalReward ?? 0,
        quantity: product.quantity,
        trackInventory: product.trackInventory,
        isActive: product.isActive,
        isFeatured: product.isFeatured,
        totalSold: product.totalSold,
        activeOwners: product._count.fundingBadgeEntitlements,
      };
    }),
  };
}

/**
 * Flip the isPrivate label on a commons' active config row directly - this
 * is just a display/discovery flag, not a governance change, so it doesn't
 * go through the versioned update/amendment flow in coop-config.ts.
 */
export async function setCommonsPrivate(coopId: string, isPrivate: boolean): Promise<boolean> {
  const { db } = await import("@repo/db");

  const result = await db.coopConfig.updateMany({
    where: { coopId, isActive: true },
    data: { isPrivate },
  });

  return result.count > 0;
}

/**
 * Same rationale as setCommonsPrivate: the icon is cosmetic display detail,
 * not a governance change, so it's a direct field update rather than going
 * through the versioned coop-config amendment flow.
 */
export async function setCommonsIcon(
  coopId: string,
  iconEmoji: string | null,
  iconColor: string | null,
): Promise<boolean> {
  const { db } = await import("@repo/db");

  const result = await db.coopConfig.updateMany({
    where: { coopId, isActive: true },
    data: { iconEmoji, iconColor },
  });

  return result.count > 0;
}

export type CommonsMemberRow = {
  id: string;
  userId: string;
  username: string | null;
  status: string;
  roles: string[];
  lastLogin: string | null;
  createdAt: string;
  email: string;
  name: string | null;
  walletAddress: string | null;
};

export type CommonsApplicationRow = {
  id: string;
  userId: string;
  status: string;
  createdAt: string;
  reviewedAt: string | null;
  email: string;
  name: string | null;
  data: unknown;
};

export type PaginatedResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

const DEFAULT_PAGE_SIZE = 20;

export async function listCommonsMembers(
  coopId: string,
  opts: { search?: string; page?: number; pageSize?: number } = {}
): Promise<PaginatedResult<CommonsMemberRow>> {
  const { db } = await import("@repo/db");

  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? DEFAULT_PAGE_SIZE));
  const search = opts.search?.trim();

  const where = {
    coopId,
    ...(search
      ? {
          OR: [
            { username: { contains: search, mode: "insensitive" as const } },
            { user: { email: { contains: search, mode: "insensitive" as const } } },
            { user: { name: { contains: search, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    db.userCoopMembership.findMany({
      where,
      include: { user: { select: { email: true, name: true, walletAddress: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.userCoopMembership.count({ where }),
  ]);

  return {
    items: rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      username: r.username,
      status: r.status,
      roles: r.roles,
      lastLogin: r.lastLogin ? r.lastLogin.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      email: r.user.email,
      name: r.user.name,
      walletAddress: r.user.walletAddress,
    })),
    total,
    page,
    pageSize,
  };
}

export async function listCommonsApplications(
  coopId: string,
  opts: { search?: string; status?: ApplicationStatus; page?: number; pageSize?: number } = {}
): Promise<PaginatedResult<CommonsApplicationRow>> {
  const { db } = await import("@repo/db");

  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? DEFAULT_PAGE_SIZE));
  const search = opts.search?.trim();

  const where = {
    coopId,
    ...(opts.status ? { status: opts.status } : {}),
    ...(search
      ? {
          user: {
            OR: [
              { email: { contains: search, mode: "insensitive" as const } },
              { name: { contains: search, mode: "insensitive" as const } },
            ],
          },
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    db.application.findMany({
      where,
      include: { user: { select: { email: true, name: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.application.count({ where }),
  ]);

  return {
    items: rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
      email: r.user.email,
      name: r.user.name,
      data: r.data,
    })),
    total,
    page,
    pageSize,
  };
}
