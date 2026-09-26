/**
 * Treasury Ledger Service - Append-only fiat accounting
 * 
 * Responsibilities:
 * - Record all treasury-related transactions (fees, refunds, allocations, adjustments)
 * - Derive treasury balances from ledger entries only
 * - Provide treasury reporting and balance queries
 * 
 * This is the ONLY service that computes treasury balances.
 * Never infer treasury state from SC balances or UC movement.
 */

import { db } from '@repo/db';
import { TRPCError } from '@trpc/server';

/**
 * Record fee collection from a commerce transaction
 * 
 * @param params - Fee collection parameters
 * @returns Ledger entry
 */
export async function recordFeeCollection(params: {
  sourceTransactionId: string;
  amount: number;
  currency: string;
  metadata?: Record<string, unknown>;
}): Promise<{
  id: string;
  accountType: string;
  amount: number;
  occurredAt: Date;
}> {
  const { sourceTransactionId, amount, currency, metadata } = params;

  console.log(`💰 [Treasury Ledger] Recording fee collection: $${amount} from transaction ${sourceTransactionId}`);

  // Check if already recorded (idempotency)
  const existing = await db.treasuryLedgerEntry.findFirst({
    where: {
      sourceTransactionId,
      sourceTransactionType: 'COMMERCE_FEE',
    },
  });

  if (existing) {
    console.log(`⚠️ [Treasury Ledger] Fee already recorded: ${existing.id}`);
    return {
      id: existing.id,
      accountType: existing.accountType,
      amount: existing.amount,
      occurredAt: existing.occurredAt,
    };
  }

  // Create ledger entry
  const entry = await db.treasuryLedgerEntry.create({
    data: {
      sourceTransactionId,
      sourceTransactionType: 'COMMERCE_FEE',
      accountType: 'TREASURY_FEES',
      entryType: 'FEE_COLLECTION',
      amount,
      currency: currency.toUpperCase(),
      direction: 'CREDIT', // Increases treasury balance
      description: `Fee collected from commerce transaction`,
      metadata: metadata as any,
    },
  });

  console.log(`✅ [Treasury Ledger] Fee recorded: ${entry.id}`);

  return {
    id: entry.id,
    accountType: entry.accountType,
    amount: entry.amount,
    occurredAt: entry.occurredAt,
  };
}

/**
 * Record refund (reverses fee collection)
 * 
 * @param params - Refund parameters
 * @returns Ledger entry
 */
export async function recordRefund(params: {
  sourceTransactionId: string;
  amount: number;
  currency: string;
  reason: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}): Promise<{
  id: string;
  accountType: string;
  amount: number;
  occurredAt: Date;
}> {
  const { sourceTransactionId, amount, currency, reason, idempotencyKey, metadata } = params;

  console.log(`💸 [Treasury Ledger] Recording refund: $${amount} for transaction ${sourceTransactionId}`);

  // Check if already recorded (idempotency)
  const existing = idempotencyKey
    ? await db.treasuryLedgerEntry.findFirst({
        where: {
          sourceTransactionId,
          sourceTransactionType: 'REFUND',
          metadata: { path: ['idempotencyKey'], equals: idempotencyKey },
        },
      })
    : await db.treasuryLedgerEntry.findFirst({
        where: { sourceTransactionId, sourceTransactionType: 'REFUND' },
      });

  if (existing) {
    console.log(`⚠️ [Treasury Ledger] Refund already recorded: ${existing.id}`);
    return {
      id: existing.id,
      accountType: existing.accountType,
      amount: existing.amount,
      occurredAt: existing.occurredAt,
    };
  }

  // Create ledger entry
  const entry = await db.treasuryLedgerEntry.create({
    data: {
      sourceTransactionId,
      sourceTransactionType: 'REFUND',
      accountType: 'TREASURY_FEES',
      entryType: 'REFUND',
      amount,
      currency: currency.toUpperCase(),
      direction: 'DEBIT', // Decreases treasury balance
      description: `Refund: ${reason}`,
      metadata: metadata as any,
      ...(idempotencyKey ? { metadata: { ...metadata, idempotencyKey } as any } : {}),
    },
  });

  console.log(`✅ [Treasury Ledger] Refund recorded: ${entry.id}`);

  return {
    id: entry.id,
    accountType: entry.accountType,
    amount: entry.amount,
    occurredAt: entry.occurredAt,
  };
}

/**
 * Record treasury allocation (approved proposal spending)
 * 
 * @param params - Allocation parameters
 * @returns Ledger entry
 */
export async function recordAllocation(params: {
  proposalId: string;
  amount: number;
  currency: string;
  approvedBy: string;
  description: string;
  metadata?: Record<string, unknown>;
}): Promise<{
  id: string;
  accountType: string;
  amount: number;
  occurredAt: Date;
}> {
  const { proposalId, amount, currency, approvedBy, description, metadata } = params;

  console.log(`📤 [Treasury Ledger] Recording allocation: $${amount} for proposal ${proposalId}`);

  // Check if already recorded (idempotency)
  const existing = await db.treasuryLedgerEntry.findFirst({
    where: {
      sourceTransactionId: proposalId,
      sourceTransactionType: 'ALLOCATION',
    },
  });

  if (existing) {
    console.log(`⚠️ [Treasury Ledger] Allocation already recorded: ${existing.id}`);
    return {
      id: existing.id,
      accountType: existing.accountType,
      amount: existing.amount,
      occurredAt: existing.occurredAt,
    };
  }

  // Create ledger entry
  const entry = await db.treasuryLedgerEntry.create({
    data: {
      sourceTransactionId: proposalId,
      sourceTransactionType: 'ALLOCATION',
      accountType: 'GRANTS',
      entryType: 'ALLOCATION',
      amount,
      currency: currency.toUpperCase(),
      direction: 'DEBIT', // Decreases treasury balance
      description,
      metadata: {
        ...metadata,
        approvedBy,
      } as any,
    },
  });

  console.log(`✅ [Treasury Ledger] Allocation recorded: ${entry.id}`);

  return {
    id: entry.id,
    accountType: entry.accountType,
    amount: entry.amount,
    occurredAt: entry.occurredAt,
  };
}

/**
 * Record manual adjustment (admin operation)
 * 
 * @param params - Adjustment parameters
 * @returns Ledger entry
 */
export async function recordAdjustment(params: {
  accountType: 'PLATFORM_FEES' | 'TREASURY_FEES' | 'PENDING_SETTLEMENT' | 'ADJUSTMENTS' | 'GRANTS';
  amount: number;
  currency: string;
  direction: 'CREDIT' | 'DEBIT';
  reason: string;
  authorizedBy: string;
  metadata?: Record<string, unknown>;
}): Promise<{
  id: string;
  accountType: string;
  amount: number;
  occurredAt: Date;
}> {
  const { accountType, amount, currency, direction, reason, authorizedBy, metadata } = params;

  console.log(`🔧 [Treasury Ledger] Recording adjustment: ${direction} $${amount} to ${accountType}`);

  // Create ledger entry
  const entry = await db.treasuryLedgerEntry.create({
    data: {
      sourceTransactionType: 'ADJUSTMENT',
      accountType,
      entryType: 'ADJUSTMENT',
      amount,
      currency: currency.toUpperCase(),
      direction,
      description: reason,
      metadata: {
        ...metadata,
        authorizedBy,
      } as any,
    },
  });

  console.log(`✅ [Treasury Ledger] Adjustment recorded: ${entry.id}`);

  return {
    id: entry.id,
    accountType: entry.accountType,
    amount: entry.amount,
    occurredAt: entry.occurredAt,
  };
}

/**
 * Get balance for a treasury account
 * Derived from ledger entries only (source of truth)
 * 
 * @param accountType - Account type to query
 * @param currency - Currency filter (default: USD)
 * @returns Account balance
 */
export async function getAccountBalance(
  accountType: 'PLATFORM_FEES' | 'TREASURY_FEES' | 'PENDING_SETTLEMENT' | 'ADJUSTMENTS' | 'GRANTS',
  currency: string = 'USD'
): Promise<{
  accountType: string;
  balance: number;
  entryCount: number;
  totalCredits: number;
  totalDebits: number;
  currency: string;
  lastUpdated: Date | null;
}> {
  console.log(`💰 [Treasury Ledger] Calculating balance for ${accountType} (${currency})`);

  // Get all entries for this account
  const entries = await db.treasuryLedgerEntry.findMany({
    where: {
      accountType,
      currency: currency.toUpperCase(),
    },
    orderBy: {
      occurredAt: 'desc',
    },
  });

  // Calculate balance from entries
  let balance = 0;
  let totalCredits = 0;
  let totalDebits = 0;
  for (const entry of entries) {
    if (entry.direction === 'CREDIT') {
      balance += entry.amount;
      totalCredits += entry.amount;
    } else {
      balance -= entry.amount;
      totalDebits += entry.amount;
    }
  }

  const lastUpdated = entries[0]?.occurredAt || null;

  console.log(`✅ [Treasury Ledger] Balance: $${balance.toFixed(2)}`);

  return {
    accountType,
    balance,
    entryCount: entries.length,
    totalCredits,
    totalDebits,
    currency: currency.toUpperCase(),
    lastUpdated,
  };
}

/**
 * Get total treasury balance (all accounts)
 * 
 * @param currency - Currency filter (default: USD)
 * @returns Total balance across all treasury accounts
 */
export async function getTotalTreasuryBalance(
  currency: string = 'USD'
): Promise<{
  totalBalance: number;
  currency: string;
  accountBalances: Array<{
    accountType: string;
    balance: number;
  }>;
}> {
  console.log(`💰 [Treasury Ledger] Calculating total treasury balance (${currency})`);

  const accountTypes: Array<'PLATFORM_FEES' | 'TREASURY_FEES' | 'PENDING_SETTLEMENT' | 'ADJUSTMENTS' | 'GRANTS'> = [
    'PLATFORM_FEES',
    'TREASURY_FEES',
    'PENDING_SETTLEMENT',
    'ADJUSTMENTS',
    'GRANTS',
  ];

  const accountBalances = await Promise.all(
    accountTypes.map(async (accountType) => {
      const { balance } = await getAccountBalance(accountType, currency);
      return { accountType, balance };
    })
  );

  const totalBalance = accountBalances.reduce((sum, account) => sum + account.balance, 0);

  console.log(`✅ [Treasury Ledger] Total balance: $${totalBalance.toFixed(2)}`);

  return {
    totalBalance,
    currency: currency.toUpperCase(),
    accountBalances,
  };
}

/**
 * Get ledger entries for an account
 * 
 * @param params - Query parameters
 * @returns Array of ledger entries
 */
export async function getLedgerEntries(params: {
  accountType?: 'PLATFORM_FEES' | 'TREASURY_FEES' | 'PENDING_SETTLEMENT' | 'ADJUSTMENTS' | 'GRANTS';
  entryType?: 'FEE_COLLECTION' | 'REFUND' | 'ALLOCATION' | 'ADJUSTMENT' | 'SETTLEMENT';
  currency?: string;
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
  offset?: number;
}): Promise<{
  entries: Array<{
    id: string;
    accountType: string;
    entryType: string;
    amount: number;
    currency: string;
    direction: string;
    description: string | null;
    occurredAt: Date;
  }>;
  total: number;
}> {
  const { accountType, entryType, currency, fromDate, toDate, limit = 50, offset = 0 } = params;

  const where: any = {};

  if (accountType) where.accountType = accountType;
  if (entryType) where.entryType = entryType;
  if (currency) where.currency = currency.toUpperCase();
  if (fromDate || toDate) {
    where.occurredAt = {};
    if (fromDate) where.occurredAt.gte = fromDate;
    if (toDate) where.occurredAt.lte = toDate;
  }

  const [entries, total] = await Promise.all([
    db.treasuryLedgerEntry.findMany({
      where,
      orderBy: {
        occurredAt: 'desc',
      },
      take: limit,
      skip: offset,
    }),
    db.treasuryLedgerEntry.count({ where }),
  ]);

  return {
    entries: entries.map((entry) => ({
      id: entry.id,
      accountType: entry.accountType,
      entryType: entry.entryType,
      amount: entry.amount,
      currency: entry.currency,
      direction: entry.direction,
      description: entry.description,
      occurredAt: entry.occurredAt,
    })),
    total,
  };
}

/**
 * Get treasury summary report
 * 
 * @param currency - Currency filter (default: USD)
 * @returns Treasury summary
 */
export async function getTreasurySummary(
  currency: string = 'USD'
): Promise<{
  totalBalance: number;
  currency: string;
  accountBalances: Array<{
    accountType: string;
    balance: number;
  }>;
  recentActivity: Array<{
    id: string;
    entryType: string;
    amount: number;
    direction: string;
    occurredAt: Date;
  }>;
  stats: {
    totalFeesCollected: number;
    totalAllocations: number;
    totalRefunds: number;
  };
}> {
  console.log(`📊 [Treasury Ledger] Generating treasury summary (${currency})`);

  // Get total balance
  const { totalBalance, accountBalances } = await getTotalTreasuryBalance(currency);

  // Get recent activity
  const { entries: recentActivity } = await getLedgerEntries({
    currency,
    limit: 10,
  });

  // Calculate stats
  const stats = await db.treasuryLedgerEntry.aggregate({
    where: { currency: currency.toUpperCase() },
    _sum: {
      amount: true,
    },
  });

  const feeEntries = await db.treasuryLedgerEntry.aggregate({
    where: {
      currency: currency.toUpperCase(),
      entryType: 'FEE_COLLECTION',
    },
    _sum: {
      amount: true,
    },
  });

  const allocationEntries = await db.treasuryLedgerEntry.aggregate({
    where: {
      currency: currency.toUpperCase(),
      entryType: 'ALLOCATION',
    },
    _sum: {
      amount: true,
    },
  });

  const refundEntries = await db.treasuryLedgerEntry.aggregate({
    where: {
      currency: currency.toUpperCase(),
      entryType: 'REFUND',
    },
    _sum: {
      amount: true,
    },
  });

  return {
    totalBalance,
    currency: currency.toUpperCase(),
    accountBalances,
    recentActivity: recentActivity.map((entry) => ({
      id: entry.id,
      entryType: entry.entryType,
      amount: entry.amount,
      direction: entry.direction,
      occurredAt: entry.occurredAt,
    })),
    stats: {
      totalFeesCollected: feeEntries._sum.amount || 0,
      totalAllocations: allocationEntries._sum.amount || 0,
      totalRefunds: refundEntries._sum.amount || 0,
    },
  };
}
