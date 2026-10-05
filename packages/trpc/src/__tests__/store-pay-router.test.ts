import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@repo/db', () => ({
  db: {
    user: { findFirst: vi.fn() },
    store: { findFirst: vi.fn() },
    notification: { create: vi.fn() },
  },
}));

vi.mock('../services/store-pay-service.js', () => ({
  generateUniqueShortCode: vi.fn(),
  validateShortCode: vi.fn(),
  normalizeShortCode: vi.fn((code: string) => code.toUpperCase()),
  isShortCodeAvailable: vi.fn(),
  createPaymentRequest: vi.fn(),
  getPaymentRequestByToken: vi.fn(),
  getStoreByShortCode: vi.fn(),
  payRequest: vi.fn(),
  payByStoreCode: vi.fn(),
  getStorePaymentRequests: vi.fn(),
  cancelPaymentRequest: vi.fn(),
}));

import { db } from '@repo/db';
import { storePayRouter } from '../routers/store-pay.js';
import { getStoreByShortCode, payByStoreCode, payRequest } from '../services/store-pay-service.js';

const WALLET = '0x1234567890123456789012345678901234567890';
const PAYER_ID = 'payer-1';

function caller(opts: { wallet?: string; headerCoopId?: string } = {}) {
  const wallet = opts.wallet ?? WALLET;
  return storePayRouter.createCaller({
    db,
    req: { headers: { 'x-wallet-address': wallet } } as any,
    res: {} as any,
    coopId: opts.headerCoopId,
  } as any);
}

describe('storePay.getStoreByCode', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requires the commons, because store codes are only unique within one', async () => {
    await expect(
      storePayRouter.createCaller({ db, req: { headers: {} }, res: {} } as any)
        .getStoreByCode({ code: 'SHOP' } as any),
    ).rejects.toThrow();
    expect(getStoreByShortCode).not.toHaveBeenCalled();
  });

  it('looks the code up inside the given commons', async () => {
    vi.mocked(getStoreByShortCode).mockResolvedValue({
      id: 'store-1', ownerId: 'owner-1', name: 'E2E Shop', shortCode: 'SHOP',
      imageUrl: null, isScVerified: false, coopId: 'cahootz', acceptsQuickPay: true,
    } as any);

    const result = await storePayRouter
      .createCaller({ db, req: { headers: {} }, res: {} } as any)
      .getStoreByCode({ code: 'shop', coopId: 'cahootz' });

    expect(getStoreByShortCode).toHaveBeenCalledWith('shop', 'cahootz');
    expect(result).toEqual({
      found: true,
      store: {
        id: 'store-1', name: 'E2E Shop', shortCode: 'SHOP',
        imageUrl: null, isScVerified: false, acceptsQuickPay: true,
      },
    });
  });
});

describe('storePay.payByStoreCode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Auth middleware lookup and the payer lookup both use user.findFirst.
    vi.mocked(db.user.findFirst).mockResolvedValue({ id: PAYER_ID, deletedAt: null } as any);
    vi.mocked(payByStoreCode).mockResolvedValue({
      success: true, transferId: 't-1', message: 'Paid $5.00 to E2E Shop',
      storeName: 'E2E Shop', amount: 5, fee: 0, paidAt: new Date('2026-10-05T14:30:00.000Z'),
    });
  });

  it('pays inside the commons sent by the client, as the signed-in wallet owner', async () => {
    const result = await caller().payByStoreCode({ storeCode: 'SHOP', amount: 5, coopId: 'cahootz' });

    expect(result.success).toBe(true);
    // Everything the payer's receipt shows.
    expect(result).toMatchObject({
      transferId: 't-1', storeName: 'E2E Shop', amount: 5, fee: 0, paidAt: '2026-10-05T14:30:00.000Z',
    });
    expect(payByStoreCode).toHaveBeenCalledWith({
      storeCode: 'SHOP', payerId: PAYER_ID, amount: 5, coopId: 'cahootz', note: undefined,
    });
  });

  it('falls back to the X-Coop-Id header for the commons', async () => {
    await caller({ headerCoopId: 'e2e-market' }).payByStoreCode({ storeCode: 'SHOP', amount: 5 });
    expect(payByStoreCode).toHaveBeenCalledWith(expect.objectContaining({ coopId: 'e2e-market' }));
  });

  it('refuses when no commons is given instead of guessing one', async () => {
    await expect(caller().payByStoreCode({ storeCode: 'SHOP', amount: 5 })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(payByStoreCode).not.toHaveBeenCalled();
  });

  it('never pays from a different account than the signed-in wallet', async () => {
    await expect(
      caller().payByStoreCode({ storeCode: 'SHOP', amount: 5, coopId: 'cahootz', userId: 'someone-else' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(payByStoreCode).not.toHaveBeenCalled();
  });

  it('refuses when the wallet does not belong to an account', async () => {
    vi.mocked(db.user.findFirst).mockResolvedValue(null);
    await expect(
      caller().payByStoreCode({ storeCode: 'SHOP', amount: 5, coopId: 'cahootz' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(payByStoreCode).not.toHaveBeenCalled();
  });

  it.each([0, -1, 10000.01])('rejects an invalid amount (%s) on the server', async (amount) => {
    await expect(
      caller().payByStoreCode({ storeCode: 'SHOP', amount, coopId: 'cahootz' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(payByStoreCode).not.toHaveBeenCalled();
  });

  it('passes service refusals (own store, unknown code) back as a plain message', async () => {
    vi.mocked(payByStoreCode).mockRejectedValue(new Error("You can't pay your own store"));
    await expect(
      caller().payByStoreCode({ storeCode: 'SHOP', amount: 5, coopId: 'cahootz' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: "You can't pay your own store" });
  });
});

describe('storePay.payRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.user.findFirst).mockResolvedValue({ id: PAYER_ID, deletedAt: null } as any);
    vi.mocked(payRequest).mockResolvedValue({
      success: true, transferId: 't-2', message: 'Paid $7.25 to E2E Shop',
      storeName: 'E2E Shop', amount: 7.25, fee: 0, paidAt: new Date('2026-10-05T15:00:00.000Z'),
    });
  });

  it('pays as the signed-in wallet owner without needing a userId, and returns the receipt', async () => {
    const result = await caller().payRequest({ token: 'tok-1', amount: 7.25 });

    expect(payRequest).toHaveBeenCalledWith({ token: 'tok-1', payerId: PAYER_ID, amount: 7.25 });
    expect(result).toMatchObject({
      transferId: 't-2', storeName: 'E2E Shop', amount: 7.25, fee: 0, paidAt: '2026-10-05T15:00:00.000Z',
    });
  });

  it('never pays from a different account than the signed-in wallet', async () => {
    await expect(
      caller().payRequest({ token: 'tok-1', amount: 7.25, userId: 'someone-else' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(payRequest).not.toHaveBeenCalled();
  });

  it('refuses when the wallet does not belong to an account', async () => {
    vi.mocked(db.user.findFirst).mockResolvedValue(null);
    await expect(caller().payRequest({ token: 'tok-1', amount: 7.25 })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(payRequest).not.toHaveBeenCalled();
  });
});
