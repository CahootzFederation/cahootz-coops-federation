/**
 * Store Quick Payment Service
 * Handles store payment requests, QR codes, and quick payments
 */

import { db, PaymentRequestStatus } from "@repo/db";
import { sendToSoulaanUser } from "./p2p-service.js";
import { awardStoreTransactionReward } from "./wallet-service.js";

// ─────────────────────────────────────────────────────────
// Short Code Generation
// ─────────────────────────────────────────────────────────

/**
 * Generate a unique short code for a store
 * Format: {INITIALS}{RANDOM} e.g., "JC4K9X"
 */
export function generateShortCode(storeName: string): string {
  // Get initials from store name (up to 2 chars)
  const words = storeName.trim().split(/\s+/).filter(w => w.length > 0);
  const initials = words
    .map(word => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  // Use at least 2 chars for initials, pad with 'X' if needed
  const paddedInitials = initials.padEnd(2, 'X');

  // Generate random suffix (avoiding ambiguous chars: 0/O, 1/I/L)
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const suffix = Array.from({ length: 4 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join('');

  return `${paddedInitials}${suffix}`;
}

/**
 * Validate short code format
 */
export function validateShortCode(code: string): boolean {
  // 3-20 chars, alphanumeric and hyphens only
  return /^[A-Z0-9-]{3,20}$/i.test(code);
}

/**
 * Normalize short code (uppercase, remove invalid chars)
 */
export function normalizeShortCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9-]/g, '');
}

/**
 * Check if a short code is available
 */
export async function isShortCodeAvailable(code: string, coopId: string): Promise<boolean> {
  const normalized = normalizeShortCode(code);
  const existing = await db.store.findUnique({
    where: { 
      coopId_shortCode: {
        coopId,
        shortCode: normalized,
      }
    },
    select: { id: true },
  });
  return !existing;
}

/**
 * Generate a unique short code, retrying if collision
 */
export async function generateUniqueShortCode(storeName: string, coopId: string): Promise<string> {
  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    const code = generateShortCode(storeName);
    const available = await isShortCodeAvailable(code, coopId);
    if (available) {
      return code;
    }
    attempts++;
  }

  // Fallback: add timestamp suffix
  const timestamp = Date.now().toString(36).toUpperCase().slice(-4);
  return `${storeName.slice(0, 2).toUpperCase()}${timestamp}`;
}

// ─────────────────────────────────────────────────────────
// Payment Request Operations
// ─────────────────────────────────────────────────────────

export interface CreatePaymentRequestParams {
  storeId: string;
  amount?: number;
  description?: string;
  referenceId?: string;
  expiresInMinutes?: number;
}

export interface PaymentRequestResult {
  requestId: string;
  token: string;
  qrCodeData: string;
  paymentUrl: string;
  amount?: number;
  description?: string;
  expiresAt?: Date;
}

/**
 * Create a new payment request for a store
 */
export async function createPaymentRequest(
  params: CreatePaymentRequestParams
): Promise<PaymentRequestResult> {
  const { storeId, amount, description, referenceId, expiresInMinutes } = params;

  // Calculate expiration if specified
  const expiresAt = expiresInMinutes
    ? new Date(Date.now() + expiresInMinutes * 60 * 1000)
    : undefined;

  const request = await db.storePaymentRequest.create({
    data: {
      storeId,
      amount,
      description,
      referenceId,
      expiresAt,
      status: 'PENDING',
    },
  });

  // Generate QR code data (deep link URL)
  const qrCodeData = `coop://pay/r/${request.token}`;
  const paymentUrl = `https://app.cahootz.coop/pay?r=${request.token}`;

  return {
    requestId: request.id,
    token: request.token,
    qrCodeData,
    paymentUrl,
    amount: request.amount || undefined,
    description: request.description || undefined,
    expiresAt: request.expiresAt || undefined,
  };
}

export interface PaymentRequestInfo {
  id: string;
  token: string;
  store: {
    id: string;
    name: string;
    shortCode: string | null;
    imageUrl: string | null;
    isScVerified: boolean;
  };
  amount: number | null;
  description: string | null;
  status: string;
  expiresAt: Date | null;
  isExpired: boolean;
}

/**
 * Get payment request info by token (public)
 */
export async function getPaymentRequestByToken(
  token: string
): Promise<PaymentRequestInfo | null> {
  const request = await db.storePaymentRequest.findUnique({
    where: { token },
    include: {
      store: {
        select: {
          id: true,
          name: true,
          shortCode: true,
          imageUrl: true,
          isScVerified: true,
          status: true,
        },
      },
    },
  });

  if (!request) {
    return null;
  }

  // Check if store is approved
  if (request.store.status !== 'APPROVED') {
    return null;
  }

  // Check if expired
  const isExpired = request.expiresAt ? new Date() > request.expiresAt : false;

  return {
    id: request.id,
    token: request.token,
    store: {
      id: request.store.id,
      name: request.store.name,
      shortCode: request.store.shortCode,
      imageUrl: request.store.imageUrl,
      isScVerified: request.store.isScVerified,
    },
    amount: request.amount,
    description: request.description,
    status: isExpired && request.status === 'PENDING' ? 'EXPIRED' : request.status,
    expiresAt: request.expiresAt,
    isExpired,
  };
}

export interface StoreInfo {
  id: string;
  ownerId: string;
  name: string;
  shortCode: string | null;
  imageUrl: string | null;
  isScVerified: boolean;
  acceptsQuickPay: boolean;
  coopId: string;
}

/**
 * Get store by short code (public)
 */
export async function getStoreByShortCode(code: string, coopId: string): Promise<StoreInfo | null> {
  const normalized = normalizeShortCode(code);

  const store = await db.store.findFirst({
    where: {
      shortCode: normalized,
      coopId,
      status: 'APPROVED',
      acceptsQuickPay: true,
    },
    select: {
      id: true,
      ownerId: true,
      name: true,
      shortCode: true,
      imageUrl: true,
      isScVerified: true,
      coopId: true,
      acceptsQuickPay: true,
    },
  });

  return store;
}

// ─────────────────────────────────────────────────────────
// Payment Execution
// ─────────────────────────────────────────────────────────

export interface PayRequestParams {
  token: string;
  payerId: string;
  amount: number; // Required - must match request amount if set
}

export interface PayRequestResult {
  success: boolean;
  transferId: string;
  message: string;
}

/**
 * Pay a payment request
 */
export async function payRequest(params: PayRequestParams): Promise<PayRequestResult> {
  const { token, payerId, amount } = params;

  // Get and validate the request
  const request = await db.storePaymentRequest.findUnique({
    where: { token },
    include: {
      store: {
        select: {
          id: true,
          ownerId: true,
          name: true,
          status: true,
          isScVerified: true,
          coopId: true,
        },
      },
    },
  });

  if (!request) {
    throw new Error('Payment request not found');
  }

  if (request.status !== 'PENDING') {
    throw new Error(`Payment request is ${request.status.toLowerCase()}`);
  }

  if (request.store.status !== 'APPROVED') {
    throw new Error('Store is not active');
  }

  // Check expiration
  if (request.expiresAt && new Date() > request.expiresAt) {
    await db.storePaymentRequest.update({
      where: { id: request.id },
      data: { status: 'EXPIRED' },
    });
    throw new Error('Payment request has expired');
  }

  // Validate amount if request has a fixed amount
  if (request.amount !== null && Math.abs(amount - request.amount) > 0.01) {
    throw new Error(`Amount must be $${request.amount.toFixed(2)}`);
  }

  // Can't pay your own store
  if (payerId === request.store.ownerId) {
    throw new Error("You can't pay your own store");
  }

  // Execute the P2P transfer to store owner
  const transferResult = await sendToSoulaanUser({
    senderId: payerId,
    recipientId: request.store.ownerId,
    amountUSD: amount,
    coopId: request.store.coopId,
    note: request.description || `Payment to ${request.store.name}`,
    transferType: 'STORE',
    transferMetadata: {
      storeName: request.store.name,
      paymentRequestId: request.id,
      referenceId: request.referenceId || undefined,
    },
  });

  // Update payment request as completed
  await db.storePaymentRequest.update({
    where: { id: request.id },
    data: {
      status: 'COMPLETED',
      p2pTransferId: transferResult.transferId,
      paidByUserId: payerId,
      paidAt: new Date(),
    },
  });

  // Award SC rewards for SC-verified stores
  let scReward: { customerReward: number; storeReward: number } = { customerReward: 0, storeReward: 0 };
  if (request.store.isScVerified) {
    scReward = await awardStoreTransactionReward(
      payerId,
      request.store.ownerId,
      amount,
      request.store.isScVerified,
      request.store.coopId,  // coopId
      undefined,  // orderId (not available in payment request flow)
      request.storeId,  // storeId
      transferResult.transactionHash,  // Source UC tx hash
      'P2P_TRANSFER',  // Source type
      transferResult.transferId  // Source record ID
    );
  }

  // Create notification for store owner
  const scMessage = scReward.storeReward > 0 ? ` (+${scReward.storeReward.toFixed(2)} SC)` : '';
  await db.notification.create({
    data: {
      userId: request.store.ownerId,
      coopId: request.store.coopId,
      type: 'STORE_PAYMENT_RECEIVED',
      title: 'Payment Received!',
      body: `You received $${amount.toFixed(2)}${scMessage}${request.description ? ` for "${request.description}"` : ''}`,
      data: {
        paymentRequestId: request.id,
        transferId: transferResult.transferId,
        amount,
        description: request.description,
        scReward: scReward.storeReward,
      },
    },
  });

  // Create notification for customer if they earned SC
  if (scReward.customerReward > 0) {
    await db.notification.create({
      data: {
        userId: payerId,
        coopId: request.store.coopId,
        type: 'SC_REWARD_EARNED',
        title: 'SC Reward Earned!',
        body: `You earned ${scReward.customerReward.toFixed(2)} SC for shopping at ${request.store.name}`,
        data: {
          transferId: transferResult.transferId,
          storeName: request.store.name,
          scReward: scReward.customerReward,
        },
      },
    });
  }

  return {
    success: true,
    transferId: transferResult.transferId,
    message: `Paid $${amount.toFixed(2)} to ${request.store.name}`,
  };
}

export interface PayByCodeParams {
  storeCode: string;
  payerId: string;
  amount: number;
  coopId: string;
  note?: string;
}

/**
 * Pay a store directly by short code (no payment request)
 */
export async function payByStoreCode(params: PayByCodeParams): Promise<PayRequestResult> {
  const { storeCode, payerId, amount, coopId, note } = params;

  // Look up store
  const store = await getStoreByShortCode(storeCode, coopId);

  if (!store) {
    throw new Error('Store not found or not accepting quick payments');
  }

  // Can't pay your own store
  if (payerId === store.ownerId) {
    throw new Error("You can't pay your own store");
  }

  // Execute the P2P transfer
  const transferResult = await sendToSoulaanUser({
    senderId: payerId,
    recipientId: store.ownerId,
    amountUSD: amount,
    coopId: store.coopId,
    note: note || `Payment to ${store.name}`,
    transferType: 'STORE',
    transferMetadata: {
      storeName: store.name,
      storeCode: store.shortCode || undefined,
    },
  });

  // Award SC rewards for SC-verified stores
  let scReward: { customerReward: number; storeReward: number } = { customerReward: 0, storeReward: 0 };
  if (store.isScVerified) {
    scReward = await awardStoreTransactionReward(
      payerId,
      store.ownerId,
      amount,
      store.isScVerified,
      store.coopId,  // coopId
      undefined,  // orderId (not available in quick pay flow)
      store.id,  // storeId
      transferResult.transactionHash,  // Source UC tx hash
      'P2P_TRANSFER',  // Source type
      transferResult.transferId  // Source record ID
    );
  }

  // Create notification for store owner
  const scMessage = scReward.storeReward > 0 ? ` (+${scReward.storeReward.toFixed(2)} SC)` : '';
  await db.notification.create({
    data: {
      userId: store.ownerId,
      coopId: store.coopId,
      type: 'STORE_PAYMENT_RECEIVED',
      title: 'Payment Received!',
      body: `You received $${amount.toFixed(2)}${scMessage}${note ? ` - "${note}"` : ''}`,
      data: {
        transferId: transferResult.transferId,
        amount,
        note,
        scReward: scReward.storeReward,
      },
    },
  });

  // Create notification for customer if they earned SC
  if (scReward.customerReward > 0) {
    await db.notification.create({
      data: {
        userId: payerId,
        coopId: store.coopId,
        type: 'SC_REWARD_EARNED',
        title: 'SC Reward Earned!',
        body: `You earned ${scReward.customerReward.toFixed(2)} SC for shopping at ${store.name}`,
        data: {
          transferId: transferResult.transferId,
          storeName: store.name,
          scReward: scReward.customerReward,
        },
      },
    });
  }

  return {
    success: true,
    transferId: transferResult.transferId,
    message: `Paid $${amount.toFixed(2)} to ${store.name}`,
  };
}

// ─────────────────────────────────────────────────────────
// Payment Request History
// ─────────────────────────────────────────────────────────

export interface PaymentRequestHistoryItem {
  id: string;
  token: string;
  amount: number | null;
  description: string | null;
  referenceId: string | null;
  status: string;
  paidAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}

export async function getStorePaymentRequests(
  storeId: string,
  status?: PaymentRequestStatus,
  limit: number = 50,
  cursor?: string
): Promise<{ requests: PaymentRequestHistoryItem[]; nextCursor: string | null }> {
  const requests = await db.storePaymentRequest.findMany({
    where: {
      storeId,
      ...(status ? { status } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      token: true,
      amount: true,
      description: true,
      referenceId: true,
      status: true,
      paidAt: true,
      expiresAt: true,
      createdAt: true,
    },
  });

  const hasMore = requests.length > limit;
  const items = hasMore ? requests.slice(0, -1) : requests;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  return {
    requests: items,
    nextCursor,
  };
}

/**
 * Cancel a payment request
 */
export async function cancelPaymentRequest(
  requestId: string,
  storeId: string
): Promise<void> {
  const request = await db.storePaymentRequest.findFirst({
    where: { id: requestId, storeId },
  });

  if (!request) {
    throw new Error('Payment request not found');
  }

  if (request.status !== 'PENDING') {
    throw new Error(`Cannot cancel a ${request.status.toLowerCase()} request`);
  }

  await db.storePaymentRequest.update({
    where: { id: requestId },
    data: { status: 'CANCELLED' },
  });
}
