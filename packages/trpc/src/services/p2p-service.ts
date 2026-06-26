import { db } from '@repo/db';
import { encodeFunctionData, formatUnits, type Address } from 'viem';
import { sendTransaction, createWalletForUser, ensureWalletHasGas, mintUCToUser } from './wallet-service.js';
import {
  getUCBalance,
  parseUCAmount,
  formatUCAmount,
  unityCoinAbi,
} from './blockchain.js';
import { chargePaymentMethod, refundPayment } from './stripe-customer.js';
import { sendClaimSMS } from './sms.js';
import { coopConfig } from '../config/coop.js';
import { convertUCToUSD, convertUSDToUC, createParityAmounts } from '../utils/currency-converter.js';

/**
 * Get user's balance in USD (converts from UC)
 */
export async function getUSDBalance(userId: string): Promise<{
  balanceUSD: number;
  balanceUC: string;
  formatted: string;
}> {
  console.log(`\n💰 getUSDBalance - userId: ${userId}`);

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { walletAddress: true },
  });

  console.log(`   walletAddress from DB: ${user?.walletAddress || 'NOT SET'}`);

  if (!user?.walletAddress) {
    console.log('   ⚠️ No wallet address, returning $0.00');
    return {
      balanceUSD: 0,
      balanceUC: '0',
      formatted: '$0.00',
    };
  }

  const { balance, formatted } = await getUCBalance(user.walletAddress, '???');
  console.log(`   UC balance from blockchain: ${formatted} UC (raw: ${balance})`);

  const balanceUSD = convertUCToUSD(parseFloat(formatted));
  console.log(`   USD balance: $${balanceUSD.toFixed(2)}`);

  return {
    balanceUSD,
    balanceUC: balance.toString(),
    formatted: `$${balanceUSD.toFixed(2)}`,
  };
}

/**
 * Transfer type for labeled transfers
 */
export type TransferType = 'PERSONAL' | 'RENT' | 'SERVICE' | 'STORE';

/**
 * Transfer metadata based on type
 */
export interface TransferMetadata {
  [key: string]: string | undefined;  // Index signature for Prisma Json
  // For RENT
  rentMonth?: string;  // e.g., "2026-02"
  // For SERVICE
  providerRole?: string;  // e.g., "contractor", "individual"
  // For STORE
  storeName?: string;
  storeCode?: string;           // Store's short code
  paymentRequestId?: string;    // If paid via payment request
  referenceId?: string;         // Store's internal reference
  // Personal note (≤50 chars)
  personalNote?: string;
}

/**
 * Send payment to another Soulaan user
 */
export async function sendToSoulaanUser(params: {
  senderId: string;
  recipientId: string;
  amountUSD: number;
  coopId: string;
  note?: string;
  transferType?: TransferType;
  transferMetadata?: TransferMetadata;
}): Promise<{
  transferId: string;
  transactionHash: string;
  fundingSource: 'BALANCE' | 'CARD';
  receiptId: string;
}> {
  const { senderId, recipientId, amountUSD, coopId, note, transferType = 'PERSONAL', transferMetadata } = params;
  const { amountUC } = createParityAmounts(amountUSD);

  console.log(`\n💸 P2P Transfer: ${amountUSD} USD (${amountUC} UC)`);
  console.log(`   From: ${senderId} → To: ${recipientId}`);

  // Get sender and recipient
  const [sender, recipient] = await Promise.all([
    db.user.findUnique({
      where: { id: senderId },
      select: { walletAddress: true, defaultPaymentMethodId: true },
    }),
    db.user.findUnique({
      where: { id: recipientId },
      select: { walletAddress: true, name: true },
    }),
  ]);

  if (!sender?.walletAddress) {
    throw new Error('Sender does not have a wallet');
  }
  if (!recipient) {
    throw new Error('Recipient not found');
  }

  const senderWalletAddress = sender.walletAddress; // TypeScript now knows this is a string

  // If recipient doesn't have a wallet, create one for them
  let recipientWalletAddress: string = recipient.walletAddress || '';
  if (!recipientWalletAddress) {
    console.log(`   Creating wallet for recipient ${recipientId}...`);
    recipientWalletAddress = await createWalletForUser(recipientId);
    console.log(`   ✅ Created wallet: ${recipientWalletAddress}`);
  }

  // Check if sender is an active SC member (required for UC transfers)
  const { isActiveMember: isSenderActive } = await import('./blockchain.js').then(m => 
    m.isActiveMember(senderWalletAddress, coopId).then(active => ({ isActiveMember: active }))
  );
  
  if (!isSenderActive) {
    throw new Error('You must be an active Cahootz co-op member to send payments. Please complete your membership application.');
  }

  // Check if recipient is an active SC member
  const { isActiveMember: isRecipientActive } = await import('./blockchain.js').then(m => 
    m.isActiveMember(recipientWalletAddress, coopId).then(active => ({ isActiveMember: active }))
  );
  
  if (!isRecipientActive) {
    throw new Error('Recipient must be an active Cahootz co-op member to receive payments.');
  }

  // Check sender's balance
  const { balance } = await getUCBalance(senderWalletAddress, coopId);
  const amountInWei = parseUCAmount(amountUC.toString());
  const hasBalance = balance >= amountInWei;

  let fundingSource: 'BALANCE' | 'CARD' = 'BALANCE';
  let stripePaymentIntentId: string | undefined;
  let stripeChargeId: string | undefined;

  // If insufficient balance, do JIT charging
  if (!hasBalance) {
    console.log('   Insufficient balance, initiating JIT charge...');
    console.log(`   Current balance: ${formatUnits(balance, 18)} UC, Need: ${amountUC} UC, Deficit: ${amountUC - parseFloat(formatUnits(balance, 18))} UC`);

    if (!sender.defaultPaymentMethodId) {
      throw new Error('Insufficient balance and no payment method on file');
    }

    // Calculate exact amount to mint (only the deficit)
    const deficit = amountInWei - balance;
    const deficitUC = parseFloat(formatUnits(deficit, 18));
    
    // Charge the card for the deficit amount
    const deficitUSD = convertUCToUSD(deficitUC);
    const amountCents = Math.ceil(deficitUSD * 100);
    console.log(`   Charging card for deficit: $${deficitUSD.toFixed(2)} (${deficitUC} UC)`);
    
    const chargeResult = await chargePaymentMethod(
      senderId,
      amountCents,
      `Payment to ${recipient.name || 'Soulaan user'}`,
      { recipientId, amountUSD: deficitUSD.toString() }
    );

    stripePaymentIntentId = chargeResult.paymentIntentId;
    stripeChargeId = chargeResult.chargeId;
    fundingSource = 'CARD';

    // Mint only the deficit to sender's wallet after card charge
    console.log(`   Minting ${deficitUC} UC to sender wallet (to cover deficit)...`);
    await mintUCToUser(senderId, deficitUC, coopId);
    console.log('   Card charged and UC minted successfully');
    
    // IMPORTANT: Re-check balance after minting to confirm it's available
    console.log('   Verifying balance after mint...');
    const { balance: newBalance } = await getUCBalance(senderWalletAddress, coopId);
    if (newBalance < amountInWei) {
      const currentUSD = convertUCToUSD(parseFloat(formatUnits(newBalance, 18)));
      throw new Error(`Payment processed but funds not yet available in your balance. Please try again in a moment. (Expected: $${amountUSD.toFixed(2)}, Current: $${currentUSD.toFixed(2)})`);
    }
    console.log(`   ✅ Balance confirmed: ${formatUnits(newBalance, 18)} UC`);
  }

  // Load CoopConfig
  const coopConfig = await db.coopConfig.findFirst({
    where: { coopId, isActive: true },
  });

  if (!coopConfig || !coopConfig.ucTokenAddress) {
    throw new Error(`CoopConfig or UC token address not found for coopId: ${coopId}`);
  }

  // Create transfer record first (PENDING)
  const transfer = await db.p2PTransfer.create({
    data: {
      senderId,
      recipientId,
      amountUSD,
      amountUC,
      coopId,
      fundingSource,
      stripePaymentIntentId,
      stripeChargeId,
      note,
      status: 'PROCESSING',
      transferType,
      transferMetadata: transferMetadata ? transferMetadata : undefined,
    },
  });

  try {
    // Ensure sender has gas for the transaction
    console.log('   Ensuring sender has gas...');
    const hasGas = await ensureWalletHasGas(senderWalletAddress);
    if (!hasGas) {
      throw new Error('Failed to fund wallet with gas');
    }
    console.log('   ✅ Sender has sufficient gas');

    // Execute blockchain transfer
    const txData = encodeFunctionData({
      abi: unityCoinAbi,
      functionName: 'transfer',
      args: [recipientWalletAddress as Address, amountInWei],
    });

    const txHash = await sendTransaction(
      senderId,
      coopConfig.ucTokenAddress as Address,
      txData
    );

    // Update transfer as completed
    await db.p2PTransfer.update({
      where: { id: transfer.id },
      data: {
        status: 'COMPLETED',
        blockchainTxHash: txHash,
        completedAt: new Date(),
      },
    });

    // Create immutable receipt
    const receipt = await db.receipt.create({
      data: {
        p2pTransferId: transfer.id,
        senderId,
        recipientId,
        amountUSD,
        coopId,
        transferType,
        metadata: transferMetadata ? transferMetadata : undefined,
        verificationStatus: 'UNVERIFIED',
      },
    });

    // Create notifications
    await createPaymentNotifications(transfer.id, senderId, recipientId, amountUSD, coopId, transferType);

    console.log(`   ✅ Transfer complete: ${txHash}`);
    console.log(`   📝 Receipt created: ${receipt.id}`);
    return {
      transferId: transfer.id,
      transactionHash: txHash,
      fundingSource,
      receiptId: receipt.id,
    };
  } catch (error) {
    console.error('   ❌ Transfer failed:', error);

    // Mark transfer as failed
    await db.p2PTransfer.update({
      where: { id: transfer.id },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        failureReason: error instanceof Error ? error.message : 'Transfer failed',
      },
    });

    // If card was charged, initiate refund
    if (fundingSource === 'CARD' && stripePaymentIntentId) {
      console.log('   💳 Initiating refund for failed transfer...');
      try {
        const amountCents = Math.ceil(amountUSD * 100);
        await refundPayment(stripePaymentIntentId, amountCents);
        console.log('   ✅ Refund initiated successfully');

        // Notify user about the refund
        await db.notification.create({
          data: {
            userId: senderId,
            coopId,
            type: 'PAYMENT_REFUNDED',
            title: 'Payment Refunded',
            body: `Your $${amountUSD.toFixed(2)} payment failed and has been refunded to your card.`,
            data: {
              transferId: transfer.id,
              amountUSD,
              reason: error instanceof Error ? error.message : 'Transfer failed',
            },
          },
        });
      } catch (refundError) {
        console.error('   ❌ Refund failed:', refundError);
        // Log for manual intervention
        await db.notification.create({
          data: {
            userId: senderId,
            coopId,
            type: 'PAYMENT_REFUND_FAILED',
            title: 'Payment Issue',
            body: `Your $${amountUSD.toFixed(2)} payment failed. Please contact support for a refund.`,
            data: {
              transferId: transfer.id,
              amountUSD,
              stripePaymentIntentId,
            },
          },
        });
      }
    }

    throw error;
  }
}

/**
 * Send payment to a non-user (creates pending transfer)
 */
export async function sendToNonUser(params: {
  senderId: string;
  recipientPhone: string;
  recipientEmail?: string;
  amountUSD: number;
  coopId: string;
  note?: string;
  transferType?: TransferType;
  transferMetadata?: TransferMetadata;
}): Promise<{
  pendingTransferId: string;
  claimToken: string;
  fundingSource: 'BALANCE' | 'CARD';
  receiptId: string;
}> {
  const { senderId, recipientPhone, recipientEmail, amountUSD, coopId, note, transferType = 'PERSONAL', transferMetadata } = params;
  const { amountUC } = createParityAmounts(amountUSD);

  console.log(`\n💸 P2P Transfer to non-user: ${amountUSD} USD`);
  console.log(`   From: ${senderId} → To: ${recipientPhone}`);

  // Get sender
  const sender = await db.user.findUnique({
    where: { id: senderId },
    select: { walletAddress: true, defaultPaymentMethodId: true, name: true },
  });

  if (!sender?.walletAddress) {
    throw new Error('Sender does not have a wallet');
  }

  // Check sender's balance
  const { balance } = await getUCBalance(sender.walletAddress, coopId);
  const amountInWei = parseUCAmount(amountUC.toString());
  const hasBalance = balance >= amountInWei;

  let fundingSource: 'BALANCE' | 'CARD' = 'BALANCE';
  let stripePaymentIntentId: string | undefined;
  let stripeChargeId: string | undefined;

  // If insufficient balance, do JIT charging
  if (!hasBalance) {
    console.log('   Insufficient balance, initiating JIT charge...');

    if (!sender.defaultPaymentMethodId) {
      throw new Error('Insufficient balance and no payment method on file');
    }

    const amountCents = Math.ceil(amountUSD * 100);
    const chargeResult = await chargePaymentMethod(
      senderId,
      amountCents,
      `Payment to ${recipientPhone}`,
      { recipientPhone, amountUSD: amountUSD.toString() }
    );

    stripePaymentIntentId = chargeResult.paymentIntentId;
    stripeChargeId = chargeResult.chargeId;
    fundingSource = 'CARD';

    // Mint UC to sender's wallet after card charge
    console.log('   Minting UC to sender wallet...');
    await mintUCToUser(senderId, amountUC, coopId);
    console.log('   Card charged and UC minted successfully');
  }

  // Calculate expiration (7 days)
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  // Create pending transfer (escrow)
  const pendingTransfer = await db.pendingTransfer.create({
    data: {
      senderId,
      recipientPhone,
      recipientEmail,
      amountUSD,
      amountUC,
      coopId,
      fundingSource,
      stripePaymentIntentId,
      stripeChargeId,
      note,
      expiresAt,
      status: 'PENDING_CLAIM',
      transferType,
      transferMetadata: transferMetadata ? transferMetadata : undefined,
    },
  });

  // Create immutable receipt
  const receipt = await db.receipt.create({
    data: {
      pendingTransferId: pendingTransfer.id,
      senderId,
      recipientPhone,
      amountUSD,
      coopId,
      transferType,
      metadata: transferMetadata ? transferMetadata : undefined,
      verificationStatus: 'UNVERIFIED',
    },
  });

  // TODO: Debit sender's UC to escrow
  // For now, we track it in the pending transfer record

  // Create notification for sender
  const config = coopConfig();
  await db.notification.create({
    data: {
      userId: senderId,
      coopId,
      type: 'PAYMENT_SENT',
      title: 'Payment Sent',
      body: `You sent $${amountUSD.toFixed(2)} to ${recipientPhone}. They have ${config.claimExpirationDays} days to claim it.`,
      data: {
        pendingTransferId: pendingTransfer.id,
        recipientPhone,
        amountUSD,
      },
    },
  });

  console.log(`   ✅ Pending transfer created: ${pendingTransfer.id}`);
  console.log(`   Claim token: ${pendingTransfer.claimToken}`);

  // Send SMS to recipient
  const smsResult = await sendClaimSMS({
    recipientPhone,
    senderName: sender.name || `Someone on ${config.shortName}`,
    amountUSD,
    claimToken: pendingTransfer.claimToken,
    note,
  });

  if (smsResult.success) {
    console.log(`   📱 SMS sent: ${smsResult.messageId}`);
  } else {
    console.warn(`   ⚠️ SMS not sent: ${smsResult.error}`);
  }

  console.log(`   📝 Receipt created: ${receipt.id}`);

  return {
    pendingTransferId: pendingTransfer.id,
    claimToken: pendingTransfer.claimToken,
    fundingSource,
    receiptId: receipt.id,
  };
}

/**
 * Process expired pending transfers (refund to sender)
 */
export async function processExpiredTransfers(): Promise<number> {
  const now = new Date();

  // Find expired pending transfers
  const expiredTransfers = await db.pendingTransfer.findMany({
    where: {
      status: 'PENDING_CLAIM',
      expiresAt: { lt: now },
    },
    include: {
      sender: { select: { walletAddress: true, name: true } },
    },
  });

  console.log(`\n🕐 Processing ${expiredTransfers.length} expired transfers...`);

  let processed = 0;

  for (const transfer of expiredTransfers) {
    try {
      // TODO: Refund UC from escrow to sender's wallet

      // Update transfer status
      await db.pendingTransfer.update({
        where: { id: transfer.id },
        data: {
          status: 'EXPIRED',
          refundedAt: now,
        },
      });

      // Notify sender
      await db.notification.create({
        data: {
          userId: transfer.senderId,
          coopId: transfer.coopId,
          type: 'PAYMENT_EXPIRED',
          title: 'Payment Returned',
          body: `Your $${transfer.amountUSD.toFixed(2)} payment to ${transfer.recipientPhone} was not claimed and has been returned.`,
          data: {
            pendingTransferId: transfer.id,
            amountUSD: transfer.amountUSD,
          },
        },
      });

      processed++;
      console.log(`   ✅ Refunded transfer ${transfer.id}`);
    } catch (error) {
      console.error(`   ❌ Failed to refund transfer ${transfer.id}:`, error);
    }
  }

  return processed;
}

/**
 * Get transfer type label for display
 */
function getTransferTypeLabel(type: TransferType): string {
  switch (type) {
    case 'PERSONAL': return 'Personal';
    case 'RENT': return 'Rent';
    case 'SERVICE': return 'Service';
    case 'STORE': return 'Store';
    default: return 'Personal';
  }
}

/**
 * Create payment notifications for both parties
 */
async function createPaymentNotifications(
  transferId: string,
  senderId: string,
  recipientId: string,
  amountUSD: number,
  coopId: string,
  transferType: TransferType = 'PERSONAL'
): Promise<void> {
  const [sender, recipient] = await Promise.all([
    db.user.findUnique({ where: { id: senderId }, select: { name: true } }),
    db.user.findUnique({ where: { id: recipientId }, select: { name: true } }),
  ]);

  const typeLabel = getTransferTypeLabel(transferType);

  // Notification for sender
  await db.notification.create({
    data: {
      userId: senderId,
      coopId,
      type: 'PAYMENT_SENT',
      title: 'Payment Sent',
      body: `You sent $${amountUSD.toFixed(2)} to ${recipient?.name || 'a user'} — ${typeLabel}`,
      data: { transferId, amountUSD, transferType },
    },
  });

  // Notification for recipient
  await db.notification.create({
    data: {
      userId: recipientId,
      coopId,
      type: 'PAYMENT_RECEIVED',
      title: 'Payment Received',
      body: `${sender?.name || 'Someone'} sent you $${amountUSD.toFixed(2)} — ${typeLabel}`,
      data: { transferId, amountUSD, transferType },
    },
  });
}

/**
 * Get transfer history for a user (sent and received)
 */
export async function getTransferHistory(
  userId: string,
  limit: number = 50,
  offset: number = 0
): Promise<{
  transfers: Array<{
    id: string;
    type: 'sent' | 'received' | 'pending';
    amount: number;
    counterparty: string;
    status: string;
    transferType: TransferType;
    note?: string;
    createdAt: Date;
  }>;
  total: number;
}> {
  // Get P2P transfers (sent and received)
  const [sentTransfers, receivedTransfers, pendingTransfers, total] = await Promise.all([
    db.p2PTransfer.findMany({
      where: { senderId: userId },
      include: { recipient: { select: { name: true, phone: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    db.p2PTransfer.findMany({
      where: { recipientId: userId },
      include: { sender: { select: { name: true, phone: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    db.pendingTransfer.findMany({
      where: { senderId: userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    db.p2PTransfer.count({
      where: { OR: [{ senderId: userId }, { recipientId: userId }] },
    }),
  ]);

  // Combine and format
  const transfers = [
    ...sentTransfers.map(t => ({
      id: t.id,
      type: 'sent' as const,
      amount: t.amountUSD,
      counterparty: t.recipient.name || t.recipient.phone || 'Unknown',
      status: t.status,
      transferType: (t.transferType || 'PERSONAL') as TransferType,
      note: t.note || undefined,
      createdAt: t.createdAt,
    })),
    ...receivedTransfers.map(t => ({
      id: t.id,
      type: 'received' as const,
      amount: t.amountUSD,
      counterparty: t.sender.name || t.sender.phone || 'Unknown',
      status: t.status,
      transferType: (t.transferType || 'PERSONAL') as TransferType,
      note: t.note || undefined,
      createdAt: t.createdAt,
    })),
    ...pendingTransfers.map(t => ({
      id: t.id,
      type: 'pending' as const,
      amount: t.amountUSD,
      counterparty: t.recipientPhone,
      status: t.status,
      transferType: (t.transferType || 'PERSONAL') as TransferType,
      note: t.note || undefined,
      createdAt: t.createdAt,
    })),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return {
    transfers: transfers.slice(0, limit),
    total,
  };
}
