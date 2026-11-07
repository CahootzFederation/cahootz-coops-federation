/**
 * Coop Chain Config Service
 * 
 * Manages per-coop blockchain configuration including contract addresses
 * Chain config is now stored in CoopConfig table
 */

import { db } from '@repo/db';
import { TRPCError } from '@trpc/server';

type ChainConfig = {
  chainId: number;
  chainName: string;
  rpcUrl: string | null;
  scTokenAddress: string;
  allyTokenAddress: string | null;
  ucTokenAddress: string;
  redemptionVaultAddress: string;
  treasurySafeAddress: string;
  verifiedStoreRegistryAddress: string;
  storePaymentRouterAddress: string;
  rewardEngineAddress: string;
  backendWalletAddress: string | null;
  scTokenSymbol: string;
  scTokenName: string;
  isActive: boolean;
};

/**
 * Get active chain config for a coop
 */
export async function getChainConfig(coopId: string): Promise<ChainConfig> {
  const config = await db.coopConfig.findFirst({
    where: { 
      coopId,
      isActive: true,
    },
    orderBy: { version: 'desc' },
    select: {
      chainId: true,
      chainName: true,
      rpcUrl: true,
      scTokenAddress: true,
      allyTokenAddress: true,
      ucTokenAddress: true,
      redemptionVaultAddress: true,
      treasurySafeAddress: true,
      verifiedStoreRegistryAddress: true,
      storePaymentRouterAddress: true,
      rewardEngineAddress: true,
      backendWalletAddress: true,
      scTokenSymbol: true,
      scTokenName: true,
      isActive: true,
    },
  });

  if (!config) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: `Chain configuration not found for coop: ${coopId}`,
    });
  }

  if (!config.chainId || !config.scTokenAddress || !config.ucTokenAddress) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Chain configuration is incomplete for coop: ${coopId}`,
    });
  }

  return config as ChainConfig;
}

/** "FakeCoin" is the schema default, so it means the commons hasn't named its coin. */
const UNSET_COIN_NAMES = new Set(['', 'FakeCoin']);

/**
 * The coin name members should see. Each commons names its own coin
 * (`CoopConfig.scTokenName`); returns null when it hasn't picked one.
 */
export function coinNameFrom(scTokenName: string | null | undefined): string | null {
  const name = scTokenName?.trim() ?? '';
  return UNSET_COIN_NAMES.has(name) ? null : name;
}

/** Looks up a commons' coin name. Returns null when unset or unreadable. */
export async function getCoinName(coopId: string): Promise<string | null> {
  try {
    const config = await db.coopConfig.findFirst({
      where: { coopId, isActive: true },
      orderBy: { version: 'desc' },
      select: { scTokenName: true },
    });
    return coinNameFrom(config?.scTokenName);
  } catch {
    return null;
  }
}

/** "2.50 SoulCoin", or "2.50 coins" when the commons hasn't named its coin. */
export function formatCoinAmount(amount: number | string, coinName: string | null): string {
  const shown = typeof amount === 'number' ? amount.toFixed(2) : amount;
  return `${shown} ${coinName ?? 'coins'}`;
}

/**
 * Get SC token address for a coop
 */
export async function getSCTokenAddress(coopId: string): Promise<string> {
  const config = await getChainConfig(coopId);
  return config.scTokenAddress;
}

/**
 * Get UC token address for a coop
 */
export async function getUCTokenAddress(coopId: string): Promise<string> {
  const config = await getChainConfig(coopId);
  return config.ucTokenAddress;
}

/**
 * Get all contract addresses for a coop
 */
export async function getContractAddresses(coopId: string): Promise<{
  scTokenAddress: string;
  allyTokenAddress: string | null;
  ucTokenAddress: string;
  redemptionVaultAddress: string;
  treasurySafeAddress: string;
  verifiedStoreRegistryAddress: string;
  storePaymentRouterAddress: string;
  rewardEngineAddress: string;
  backendWalletAddress: string | null;
}> {
  const config = await getChainConfig(coopId);
  
  return {
    scTokenAddress: config.scTokenAddress,
    allyTokenAddress: config.allyTokenAddress,
    ucTokenAddress: config.ucTokenAddress,
    redemptionVaultAddress: config.redemptionVaultAddress,
    treasurySafeAddress: config.treasurySafeAddress,
    verifiedStoreRegistryAddress: config.verifiedStoreRegistryAddress,
    storePaymentRouterAddress: config.storePaymentRouterAddress,
    rewardEngineAddress: config.rewardEngineAddress,
    backendWalletAddress: config.backendWalletAddress,
  };
}

/**
 * Update chain config fields in the active CoopConfig
 * Note: This updates the active version in place, not creating a new version
 */
export async function updateChainConfig(params: {
  coopId: string;
  chainId: number;
  chainName: string;
  rpcUrl?: string;
  scTokenAddress: string;
  allyTokenAddress?: string;
  ucTokenAddress: string;
  redemptionVaultAddress: string;
  treasurySafeAddress: string;
  verifiedStoreRegistryAddress: string;
  storePaymentRouterAddress: string;
  rewardEngineAddress: string;
  backendWalletAddress?: string;
  scTokenSymbol?: string;
  scTokenName?: string;
}): Promise<void> {
  const activeConfig = await db.coopConfig.findFirst({
    where: { coopId: params.coopId, isActive: true },
    orderBy: { version: 'desc' },
  });

  if (!activeConfig) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: `No active config found for coop: ${params.coopId}`,
    });
  }

  await db.coopConfig.update({
    where: { id: activeConfig.id },
    data: {
      chainId: params.chainId,
      chainName: params.chainName,
      rpcUrl: params.rpcUrl,
      scTokenAddress: params.scTokenAddress,
      allyTokenAddress: params.allyTokenAddress,
      ucTokenAddress: params.ucTokenAddress,
      redemptionVaultAddress: params.redemptionVaultAddress,
      treasurySafeAddress: params.treasurySafeAddress,
      verifiedStoreRegistryAddress: params.verifiedStoreRegistryAddress,
      storePaymentRouterAddress: params.storePaymentRouterAddress,
      rewardEngineAddress: params.rewardEngineAddress,
      backendWalletAddress: params.backendWalletAddress,
      scTokenSymbol: params.scTokenSymbol || 'SC',
      scTokenName: params.scTokenName || 'SoulaaniCoin',
    },
  });
}
