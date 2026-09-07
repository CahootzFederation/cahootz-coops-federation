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
