import { db } from '../packages/db/index.js';
import { ensureCommonsFundingStore } from '../packages/trpc/src/services/funding-badge-service.js';

async function main() {
  const configs = await db.coopConfig.findMany({
    where: { isActive: true },
    orderBy: [{ coopId: 'asc' }, { version: 'desc' }],
    select: { coopId: true, name: true, createdBy: true },
  });
  const latest = [...new Map(configs.map((config) => [config.coopId, config])).values()];

  for (const config of latest) {
    const owner = await db.user.findFirst({
      where: {
        OR: [
          { walletAddress: { equals: config.createdBy, mode: 'insensitive' } },
          { wallets: { some: { address: { equals: config.createdBy, mode: 'insensitive' } } } },
          { memberships: { some: { coopId: config.coopId, status: 'ACTIVE', roles: { has: 'admin' } } } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!owner) {
      console.warn(`Skipping ${config.coopId}: no active commons administrator found`);
      continue;
    }
    await db.$transaction((tx) => ensureCommonsFundingStore(tx, {
      coopId: config.coopId,
      ownerId: owner.id,
      coopName: config.name ?? config.coopId,
    }));
    console.log(`Provisioned funding shop for ${config.coopId}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
