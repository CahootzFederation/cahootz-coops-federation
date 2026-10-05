import { describe, it, expect, vi, beforeEach } from 'vitest';

// Receipts: p2p.getTransfer and p2p.getHistory only ever read the signed-in
// member's own payments, and getTransferForUser only returns a payment to
// its sender or recipient.

vi.mock('@repo/db', () => ({
  db: {
    user: { findFirst: vi.fn() },
    p2PTransfer: { findFirst: vi.fn() },
    pendingTransfer: { findFirst: vi.fn() },
  },
}));

// Heavy dependencies of the real service; none are used by the receipt lookup.
vi.mock('../services/wallet-service.js', () => ({
  sendTransaction: vi.fn(),
  createWalletForUser: vi.fn(),
  ensureWalletHasGas: vi.fn(),
  mintUCToUser: vi.fn(),
}));
vi.mock('../services/blockchain.js', () => ({
  getSCBalance: vi.fn(),
  getUCBalance: vi.fn(),
  parseUCAmount: vi.fn(),
  formatUCAmount: vi.fn(),
  unityCoinAbi: [],
}));
vi.mock('../services/stripe-customer.js', () => ({
  chargePaymentMethod: vi.fn(),
  refundPayment: vi.fn(),
  createSetupIntent: vi.fn(),
  savePaymentMethod: vi.fn(),
  removePaymentMethod: vi.fn(),
  setDefaultPaymentMethod: vi.fn(),
}));
vi.mock('../services/sms.js', () => ({ sendClaimSMS: vi.fn() }));
vi.mock('../routers/notification.js', () => ({ legacyNotificationProcedures: {} }));

import { db } from '@repo/db';
import { p2pRouter } from '../routers/p2p.js';
import * as p2pService from '../services/p2p-service.js';

const WALLET = '0x1234567890123456789012345678901234567890';
const ME = 'user-me';

function caller(wallet: string = WALLET) {
  return p2pRouter.createCaller({
    db,
    req: { headers: { 'x-wallet-address': wallet } } as any,
    res: {} as any,
  } as any);
}

const storeTransfer = {
  id: 'cmtransfer0001abcd2345',
  senderId: ME,
  recipientId: 'store-owner',
  amountUSD: 12.5,
  status: 'COMPLETED',
  transferType: 'STORE',
  transferMetadata: { storeName: 'E2E Corner Store', storeCode: 'E2EQPABC' },
  note: 'Lunch',
  createdAt: new Date('2026-10-01T17:05:00.000Z'),
  completedAt: new Date('2026-10-01T17:05:03.000Z'),
  sender: { name: 'Me', phone: null },
  recipient: { name: 'Store Owner', phone: null },
};

describe('getTransferForUser (access check)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('only looks for payments the member sent or received', async () => {
    vi.mocked(db.p2PTransfer.findFirst).mockResolvedValue(storeTransfer as any);

    const receipt = await p2pService.getTransferForUser(ME, storeTransfer.id);

    expect(db.p2PTransfer.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: storeTransfer.id, OR: [{ senderId: ME }, { recipientId: ME }] },
    }));
    expect(receipt).toMatchObject({
      id: storeTransfer.id,
      direction: 'sent',
      amount: 12.5,
      fee: 0,
      counterparty: 'Store Owner',
      status: 'COMPLETED',
      transferType: 'STORE',
      storeName: 'E2E Corner Store',
      note: 'Lunch',
    });
  });

  it('shows the sender as the other party when the member received it', async () => {
    vi.mocked(db.p2PTransfer.findFirst).mockResolvedValue({
      ...storeTransfer, senderId: 'payer', recipientId: ME, sender: { name: 'Pat Payer', phone: null },
    } as any);

    const receipt = await p2pService.getTransferForUser(ME, storeTransfer.id);
    expect(receipt).toMatchObject({ direction: 'received', counterparty: 'Pat Payer' });
  });

  it("returns nothing for someone else's payment", async () => {
    // Prisma applies the sender/recipient filter, so a stranger's payment is not found.
    vi.mocked(db.p2PTransfer.findFirst).mockResolvedValue(null);
    vi.mocked(db.pendingTransfer.findFirst).mockResolvedValue(null);

    expect(await p2pService.getTransferForUser('stranger', storeTransfer.id)).toBeNull();
    expect(db.pendingTransfer.findFirst).toHaveBeenCalledWith({
      where: { id: storeTransfer.id, senderId: 'stranger' },
    });
  });

  it('only shows money sent to a non-member to its sender', async () => {
    vi.mocked(db.p2PTransfer.findFirst).mockResolvedValue(null);
    vi.mocked(db.pendingTransfer.findFirst).mockResolvedValue({
      id: 'pending-1', senderId: ME, recipientPhone: '+15555550100', amountUSD: 4, status: 'PENDING_CLAIM',
      transferType: 'PERSONAL', transferMetadata: null, note: null,
      createdAt: new Date('2026-10-02T10:00:00.000Z'), claimedAt: null,
    } as any);

    const receipt = await p2pService.getTransferForUser(ME, 'pending-1');
    expect(db.pendingTransfer.findFirst).toHaveBeenCalledWith({ where: { id: 'pending-1', senderId: ME } });
    expect(receipt).toMatchObject({ direction: 'pending', counterparty: '+15555550100', storeName: null });
  });
});

describe('p2p.getTransfer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The auth middleware and the caller lookup both use user.findFirst.
    vi.mocked(db.user.findFirst).mockResolvedValue({ id: ME, deletedAt: null } as any);
  });

  it("returns the signed-in member's own payment as a receipt", async () => {
    vi.mocked(db.p2PTransfer.findFirst).mockResolvedValue(storeTransfer as any);

    const receipt = await caller().getTransfer({ transferId: storeTransfer.id });

    expect(db.p2PTransfer.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: storeTransfer.id, OR: [{ senderId: ME }, { recipientId: ME }] },
    }));
    expect(receipt).toEqual({
      id: storeTransfer.id,
      direction: 'sent',
      amount: 12.5,
      fee: 0,
      counterparty: 'Store Owner',
      status: 'COMPLETED',
      transferType: 'STORE',
      storeName: 'E2E Corner Store',
      note: 'Lunch',
      createdAt: '2026-10-01T17:05:00.000Z',
      completedAt: '2026-10-01T17:05:03.000Z',
    });
  });

  it("answers NOT_FOUND for a payment the member wasn't part of", async () => {
    vi.mocked(db.p2PTransfer.findFirst).mockResolvedValue(null);
    vi.mocked(db.pendingTransfer.findFirst).mockResolvedValue(null);

    await expect(caller().getTransfer({ transferId: storeTransfer.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('refuses when the wallet does not belong to an account', async () => {
    vi.mocked(db.user.findFirst).mockResolvedValue(null);

    await expect(caller().getTransfer({ transferId: storeTransfer.id })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(db.p2PTransfer.findFirst).not.toHaveBeenCalled();
  });

  it('refuses without a signed-in wallet', async () => {
    await expect(
      p2pRouter.createCaller({ db, req: { headers: {} }, res: {} } as any)
        .getTransfer({ transferId: storeTransfer.id }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(db.p2PTransfer.findFirst).not.toHaveBeenCalled();
  });
});

describe('p2p.getHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.user.findFirst).mockResolvedValue({ id: ME, deletedAt: null } as any);
  });

  it("refuses to read another member's history", async () => {
    const spy = vi.spyOn(p2pService, 'getTransferHistory');
    await expect(caller().getHistory({ userId: 'someone-else' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
