/**
 * SC Token Service - Idempotent service layer for SoulaaniCoin operations
 * 
 * This service wraps existing SC contract interactions with:
 * - Idempotent command processing (using SCMintEvent/SCBurnEvent as command log)
 * - Balance caching with chain-as-source-of-truth
 * - Retry logic for failed operations
 * - Audit logging
 * 
 * Does NOT rewrite Solidity contracts - uses existing wallet-service.ts and blockchain.ts
 */

import { db } from '@repo/db';
import { TRPCError } from '@trpc/server';
import { createPublicClient, createWalletClient, formatUnits, http, keccak256, parseUnits, toBytes, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { 
  mintSCToUser as mintSCToUserLegacy,
} from './wallet-service.js';
import { 
  getSCBalance as getSCBalanceFromChain,
  isActiveMember as isActiveMemberFromChain,
} from './blockchain.js';

/**
 * Mint SC to a user's wallet with idempotent command tracking
 * 
 * @param params - Mint parameters
 * @returns Mint result with actual amount minted and command record ID
 */
export async function mintSC(params: {
  idempotencyKey: string;
  userId: string;
  walletAddress: string;
  coopTokenClass: string;
  amount: number;
  sourceTransactionId?: string;
  sourceType?: string;
  metadata?: Record<string, unknown>;
}): Promise<{
  commandId: string;
  txHash: string;
  actualAmount: number;
  status: 'COMPLETED' | 'PENDING' | 'FAILED';
}> {
  const {
    idempotencyKey,
    userId,
    walletAddress,
    coopTokenClass,
    amount,
    sourceTransactionId,
    sourceType,
    metadata,
  } = params;

  console.log(`🪙 [SC Token Service] Mint request: ${amount} SC to ${walletAddress} (key: ${idempotencyKey})`);

  // Check for existing command with this idempotency key
  const existingCommand = await db.sCMintEvent.findUnique({
    where: { idempotencyKey },
  });

  if (existingCommand) {
    console.log(`🔄 [SC Token Service] Found existing mint command: ${existingCommand.id} (status: ${existingCommand.status})`);

    // If already completed, return existing result
    if (existingCommand.status === 'COMPLETED') {
      return {
        commandId: existingCommand.id,
        txHash: existingCommand.contractTxHash!,
        actualAmount: existingCommand.actualAmount!,
        status: 'COMPLETED',
      };
    }

    // If pending, check if we should retry
    if (existingCommand.status === 'PENDING') {
      const ageMs = Date.now() - existingCommand.createdAt.getTime();
      if (ageMs < 60000) {
        // Still fresh, don't retry yet
        console.log(`⏳ [SC Token Service] Command still pending (${ageMs}ms old), not retrying yet`);
        return {
          commandId: existingCommand.id,
          txHash: existingCommand.contractTxHash || '',
          actualAmount: existingCommand.actualAmount || amount,
          status: 'PENDING',
        };
      }
    }

    // If failed or stale pending, retry
    console.log(`🔄 [SC Token Service] Retrying failed/stale command: ${existingCommand.id}`);
  }

  // Create or update command record as PROCESSING
  const command = existingCommand
    ? await db.sCMintEvent.update({
        where: { id: existingCommand.id },
        data: {
          status: 'PROCESSING',
        },
      })
    : await db.sCMintEvent.create({
        data: {
          idempotencyKey,
          userId,
          walletAddress,
          coopTokenClass,
          requestedAmount: amount,
          sourceTransactionId,
          sourceType,
          metadata: metadata as any,
          status: 'PROCESSING',
        },
      });

  try {
    // Execute mint using existing wallet service
    // Note: The legacy mintSCToUser already handles membership checks and treasury reserve
    const { txHash, actualAmountSC } = await mintSCToUserLegacy(
      userId,
      amount,
      sourceType || 'COMMERCE_REWARD',
      sourceTransactionId,
      undefined, // treasury reserve amount - will be parsed from source tx by legacy service
      coopTokenClass // coopId
    );

    // Get block number from transaction receipt
    const { getPublicClient } = await import('./wallet-service.js');
    const publicClient = getPublicClient();
    const receipt = await publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` });

    // Update command record as COMPLETED
    const completedCommand = await db.sCMintEvent.update({
      where: { id: command.id },
      data: {
        status: 'COMPLETED',
        contractTxHash: txHash,
        actualAmount: actualAmountSC,
        blockNumber: Number(receipt.blockNumber),
        completedAt: new Date(),
      },
    });

    console.log(`✅ [SC Token Service] Mint completed: ${actualAmountSC} SC minted (tx: ${txHash})`);

    // Refresh balance cache
    await refreshBalanceCache(walletAddress, coopTokenClass);

    return {
      commandId: completedCommand.id,
      txHash,
      actualAmount: actualAmountSC,
      status: 'COMPLETED',
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ [SC Token Service] Mint failed:`, errorMessage);

    // Update command record as FAILED
    await db.sCMintEvent.update({
      where: { id: command.id },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        failureReason: errorMessage,
      },
    });

    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `Failed to mint SC: ${errorMessage}`,
      cause: error,
    });
  }
}

/**
 * Burn SC from a user's wallet with idempotent command tracking
 * 
 * @param params - Burn parameters
 * @returns Burn result
 */
export async function burnSC(params: {
  idempotencyKey: string;
  userId: string;
  walletAddress: string;
  amount: number;
  coopId: string;
  reason: string;
  authorizedBy: string;
  metadata?: Record<string, unknown>;
}): Promise<{
  commandId: string;
  txHash: string;
  actualAmount: number;
  status: 'COMPLETED' | 'PENDING' | 'FAILED';
}> {
  const {
    idempotencyKey,
    userId,
    walletAddress,
    amount,
    coopId,
    reason,
    authorizedBy,
    metadata,
  } = params;

  console.log(`🔥 [SC Token Service] Burn request: ${amount} SC from ${walletAddress} (key: ${idempotencyKey})`);

  // Check for existing command
  const existingCommand = await db.sCBurnEvent.findUnique({
    where: { idempotencyKey },
  });

  if (existingCommand) {
    console.log(`🔄 [SC Token Service] Found existing burn command: ${existingCommand.id} (status: ${existingCommand.status})`);

    if (existingCommand.status === 'COMPLETED') {
      return {
        commandId: existingCommand.id,
        txHash: existingCommand.contractTxHash!,
        actualAmount: existingCommand.actualAmount!,
        status: 'COMPLETED',
      };
    }

    if (existingCommand.status === 'PENDING') {
      const ageMs = Date.now() - existingCommand.createdAt.getTime();
      if (ageMs < 60000) {
        console.log(`⏳ [SC Token Service] Burn command still pending, not retrying yet`);
        return {
          commandId: existingCommand.id,
          txHash: existingCommand.contractTxHash || '',
          actualAmount: existingCommand.actualAmount || amount,
          status: 'PENDING',
        };
      }
    }
  }

  // Create or update command record
  const command = existingCommand
    ? await db.sCBurnEvent.update({
        where: { id: existingCommand.id },
        data: {
          status: 'PROCESSING',
        },
      })
    : await db.sCBurnEvent.create({
        data: {
          idempotencyKey,
          userId,
          walletAddress,
          requestedAmount: amount,
          reason,
          authorizedBy,
          metadata: metadata as any,
          status: 'PROCESSING',
        },
      });

  try {
    const config = await db.coopConfig.findFirst({
      where: { coopId, isActive: true },
      orderBy: { version: 'desc' },
      select: { scTokenAddress: true, rpcUrl: true },
    });
    const privateKey = process.env.BACKEND_WALLET_PRIVATE_KEY;
    if (!config?.scTokenAddress || !privateKey) {
      throw new Error('SoulCoin contract or backend signer is not configured');
    }

    const account = privateKeyToAccount(privateKey as `0x${string}`);
    const publicClient = createPublicClient({ chain: baseSepolia, transport: http(config.rpcUrl ?? undefined) });
    const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(config.rpcUrl ?? undefined) });
    const balance = await publicClient.readContract({
      address: config.scTokenAddress as Address,
      abi: [{ inputs: [{ name: 'account', type: 'address' }], name: 'balanceOf', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' }],
      functionName: 'balanceOf',
      args: [walletAddress as Address],
    });
    const requested = parseUnits(amount.toString(), 18);
    if (balance < requested) {
      throw new Error(`Wallet balance ${formatUnits(balance, 18)} SC is below the required refund reversal ${amount} SC`);
    }
    const txHash = await walletClient.writeContract({
      address: config.scTokenAddress as Address,
      abi: [{ inputs: [{ name: 'account', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'reason', type: 'bytes32' }], name: 'slash', outputs: [], stateMutability: 'nonpayable', type: 'function' }],
      functionName: 'slash',
      args: [walletAddress as Address, requested, keccak256(toBytes(reason))],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status === 'reverted') throw new Error(`SoulCoin reversal reverted: ${txHash}`);

    await db.sCBurnEvent.update({
      where: { id: command.id },
      data: {
        status: 'COMPLETED',
        contractTxHash: txHash,
        actualAmount: amount,
        blockNumber: Number(receipt.blockNumber),
        completedAt: new Date(),
      },
    });
    await refreshBalanceCache(walletAddress, coopId);
    return { commandId: command.id, txHash, actualAmount: amount, status: 'COMPLETED' };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ [SC Token Service] Burn failed:`, errorMessage);

    await db.sCBurnEvent.update({
      where: { id: command.id },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        failureReason: errorMessage,
      },
    });

    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `Failed to burn SC: ${errorMessage}`,
      cause: error,
    });
  }
}

/**
 * Get SC balance for a wallet address
 * Reads from chain (source of truth), updates cache
 * 
 * @param walletAddress - Wallet address to check
 * @param coopId - Coop ID to load contract addresses from CoopConfig
 * @returns Balance information
 */
export async function getSCBalance(walletAddress: string, coopId: string = '???'): Promise<{
  balance: number;
  formatted: string;
  syncedAt: Date;
  blockNumber: number;
}> {
  console.log(`💰 [SC Token Service] Getting SC balance for ${walletAddress}`);

  // Read from chain (source of truth)
  const { balance, formatted } = await getSCBalanceFromChain(walletAddress, coopId);
  const balanceNumber = parseFloat(formatted);

  // Get current block number
  const { getPublicClient } = await import('./wallet-service.js');
  const publicClient = getPublicClient();
  const block = await publicClient.getBlock();

  // Update cache
  await updateBalanceCache(walletAddress, balanceNumber, Number(block.number));

  return {
    balance: balanceNumber,
    formatted,
    syncedAt: new Date(),
    blockNumber: Number(block.number),
  };
}

/**
 * Get cached SC balance (faster, but may be stale)
 * 
 * @param walletAddress - Wallet address to check
 * @returns Cached balance or null if not cached
 */
export async function getCachedSCBalance(walletAddress: string): Promise<{
  balance: number;
  syncedAt: Date;
  blockNumber: number;
} | null> {
  // Find wallet record
  const wallet = await db.wallet.findUnique({
    where: { address: walletAddress },
    include: { scBalanceCache: true },
  });

  if (!wallet?.scBalanceCache) {
    return null;
  }

  return {
    balance: wallet.scBalanceCache.balance,
    syncedAt: wallet.scBalanceCache.syncedAt,
    blockNumber: wallet.scBalanceCache.blockNumber,
  };
}

/**
 * Check if a wallet is an active SC member
 * 
 * @param walletAddress - Wallet address to check
 * @param coopId - Coop ID to load contract addresses from CoopConfig
 * @returns Boolean indicating active membership
 */
export async function isActiveMember(walletAddress: string, coopId: string = '???'): Promise<boolean> {
  console.log(`👤 [SC Token Service] Checking active member status for ${walletAddress}`);
  return await isActiveMemberFromChain(walletAddress, coopId);
}

/**
 * Refresh balance cache for a wallet
 * 
 * @param walletAddress - Wallet address to refresh
 * @param coopId - Coop ID to load contract addresses from CoopConfig
 */
export async function refreshBalanceCache(walletAddress: string, coopId: string = '???'): Promise<void> {
  console.log(`🔄 [SC Token Service] Refreshing balance cache for ${walletAddress}`);

  try {
    const { balance, formatted } = await getSCBalanceFromChain(walletAddress, coopId);
    const balanceNumber = parseFloat(formatted);

    const { getPublicClient } = await import('./wallet-service.js');
    const publicClient = getPublicClient();
    const block = await publicClient.getBlock();

    await updateBalanceCache(walletAddress, balanceNumber, Number(block.number));

    console.log(`✅ [SC Token Service] Balance cache refreshed: ${balanceNumber} SC`);
  } catch (error) {
    console.error(`❌ [SC Token Service] Failed to refresh balance cache:`, error);
    // Don't throw - cache refresh is best-effort
  }
}

/**
 * Update balance cache in database
 * 
 * @param walletAddress - Wallet address
 * @param balance - Balance amount
 * @param blockNumber - Block number at time of sync
 */
async function updateBalanceCache(
  walletAddress: string,
  balance: number,
  blockNumber: number
): Promise<void> {
  // Find or create wallet record
  const wallet = await db.wallet.findUnique({
    where: { address: walletAddress },
  });

  if (!wallet) {
    console.warn(`⚠️ [SC Token Service] Wallet ${walletAddress} not found in database, skipping cache update`);
    return;
  }

  // Upsert balance cache
  await db.sCBalanceCache.upsert({
    where: { walletId: wallet.id },
    create: {
      walletId: wallet.id,
      balance,
      blockNumber,
      syncedAt: new Date(),
    },
    update: {
      balance,
      blockNumber,
      syncedAt: new Date(),
    },
  });
}

/**
 * Retry failed mint commands
 * Should be called by a background job
 * 
 * @param maxRetries - Maximum number of retries per command
 * @returns Number of commands retried
 */
export async function retryFailedMints(maxRetries: number = 3): Promise<number> {
  console.log(`🔄 [SC Token Service] Retrying failed mint commands...`);

  // Find failed commands that haven't exceeded max retries
  const failedCommands = await db.sCMintEvent.findMany({
    where: {
      status: 'FAILED',
      // No retry count field yet, would need to add to schema
    },
    take: 10, // Process in batches
  });

  let retriedCount = 0;

  for (const command of failedCommands) {
    try {
      console.log(`🔄 [SC Token Service] Retrying command ${command.id}...`);

      // Retry the mint
      await mintSC({
        idempotencyKey: command.idempotencyKey,
        userId: command.userId,
        walletAddress: command.walletAddress,
        coopTokenClass: command.coopTokenClass,
        amount: command.requestedAmount,
        sourceTransactionId: command.sourceTransactionId || undefined,
        sourceType: command.sourceType || undefined,
        metadata: (command.metadata as Record<string, unknown>) || undefined,
      });

      retriedCount++;
    } catch (error) {
      console.error(`❌ [SC Token Service] Retry failed for command ${command.id}:`, error);
      // Continue with next command
    }
  }

  console.log(`✅ [SC Token Service] Retried ${retriedCount} failed mint commands`);
  return retriedCount;
}

/**
 * Get mint history for a user
 * 
 * @param userId - User ID
 * @param limit - Maximum number of records to return
 * @returns Array of mint events
 */
export async function getMintHistory(
  userId: string,
  limit: number = 50
): Promise<Array<{
  id: string;
  amount: number;
  actualAmount: number | null;
  status: string;
  sourceType: string | null;
  txHash: string | null;
  createdAt: Date;
  completedAt: Date | null;
}>> {
  const events = await db.sCMintEvent.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      requestedAmount: true,
      actualAmount: true,
      status: true,
      sourceType: true,
      contractTxHash: true,
      createdAt: true,
      completedAt: true,
    },
  });

  return events.map(event => ({
    id: event.id,
    amount: event.requestedAmount,
    actualAmount: event.actualAmount,
    status: event.status,
    sourceType: event.sourceType,
    txHash: event.contractTxHash,
    createdAt: event.createdAt,
    completedAt: event.completedAt,
  }));
}

/**
 * Get total SC minted for a user
 * 
 * @param userId - User ID
 * @returns Total SC minted (completed only)
 */
export async function getTotalSCMinted(userId: string): Promise<number> {
  const result = await db.sCMintEvent.aggregate({
    where: {
      userId,
      status: 'COMPLETED',
    },
    _sum: {
      actualAmount: true,
    },
  });

  return result._sum.actualAmount || 0;
}
