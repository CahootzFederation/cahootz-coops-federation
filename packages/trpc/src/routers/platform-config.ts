import { z } from 'zod';
import { db } from '@repo/db';
import { router } from '../trpc.js';
import { publicProcedure, privateProcedure } from '../procedures/index.js';

// Well-known config keys
const KNOWN_KEYS = [
  'coin.symbol',
  'coin.name',
  'coin.description',
  'platform.name',
] as const;

export type CoinConfig = {
  symbol: string;
  name: string;
  description: string;
};

export type PlatformConfigMap = {
  coin: CoinConfig;
  platformName: string;
};

/** Fetch all platform config rows and shape them into a typed object */
async function loadConfig(): Promise<PlatformConfigMap> {
  const rows = await db.platformConfig.findMany({
    where: { key: { in: [...KNOWN_KEYS] } },
  });

  const map: Record<string, string> = {};
  for (const row of rows) {
    map[row.key] = row.value;
  }

  return {
    coin: {
      symbol: map['coin.symbol'] ?? 'SC',
      name: map['coin.name'] ?? 'Cahootz Coin',
      description: map['coin.description'] ?? '',
    },
    platformName: map['platform.name'] ?? 'Cahootz',
  };
}

export const platformConfigRouter = router({
  /**
   * Public — any authenticated or anonymous caller can read config.
   * Used by mobile app and web to get coin name/symbol.
   */
  getConfig: publicProcedure
    .query(async () => {
      return loadConfig();
    }),

  /**
   * Admin — update one or more config values.
   */
  updateConfig: privateProcedure
    .input(z.object({
      updates: z.array(z.object({
        key: z.enum(KNOWN_KEYS),
        value: z.string().min(1).max(500),
      })),
      updatedBy: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      await db.$transaction(
        input.updates.map(({ key, value }) =>
          db.platformConfig.upsert({
            where: { key },
            create: { key, value, updatedBy: input.updatedBy },
            update: { value, updatedBy: input.updatedBy },
          })
        )
      );
      return loadConfig();
    }),
});
