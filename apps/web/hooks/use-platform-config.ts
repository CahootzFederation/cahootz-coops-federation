import { api } from "@/lib/trpc/client";

export interface CoinConfig {
  symbol: string;
  name: string;
  description: string;
}

const DEFAULT_COIN: CoinConfig = {
  symbol: "SC",
  name: "Cahootz Coin",
  description: "",
};

/**
 * Returns coin config (symbol, name, description) from PlatformConfig table.
 * When a coopId is provided, coop-level token metadata takes precedence.
 * Falls back to SC / Cahootz Coin defaults if the queries haven't resolved yet.
 */
export function useCoin(coopId?: string): CoinConfig {
  const { data: platformConfig } = api.platformConfig.getConfig.useQuery(undefined, {
    staleTime: 5 * 60 * 1000, // cache for 5 minutes
  });
  const { data: coopConfig } = api.coopConfig.getActive.useQuery(
    { coopId: coopId ?? "" },
    {
      enabled: !!coopId,
      staleTime: 5 * 60 * 1000,
    }
  );

  const fallbackCoin = platformConfig?.coin ?? DEFAULT_COIN;

  return {
    symbol: coopConfig?.scTokenSymbol ?? fallbackCoin.symbol,
    name: coopConfig?.scTokenName ?? fallbackCoin.name,
    description: coopConfig?.description ?? fallbackCoin.description,
  };
}

export function usePlatformConfig(coopId?: string) {
  const { data: platformConfig } = api.platformConfig.getConfig.useQuery(undefined, {
    staleTime: 5 * 60 * 1000, // cache for 5 minutes
  });
  const { data: coopConfig } = api.coopConfig.getActive.useQuery(
    { coopId: coopId ?? "" },
    {
      enabled: !!coopId,
      staleTime: 5 * 60 * 1000,
    }
  );

  const fallbackCoin = platformConfig?.coin ?? DEFAULT_COIN;

  return {
    coin: {
      symbol: coopConfig?.scTokenSymbol ?? fallbackCoin.symbol,
      name: coopConfig?.scTokenName ?? fallbackCoin.name,
      description: coopConfig?.description ?? fallbackCoin.description,
    },
    platformName: platformConfig?.platformName ?? "Cahootz",
  };
}
