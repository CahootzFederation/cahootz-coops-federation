import type { ApplicationStatus } from "@repo/db";

export type CommonsSummary = {
  coopId: string;
  name: string | null;
  slug: string | null;
  tagline: string | null;
  chainId: number | null;
  chainName: string | null;
  isDemo: boolean;
  isPrivate: boolean;
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
