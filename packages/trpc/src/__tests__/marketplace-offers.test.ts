import { beforeEach, describe, expect, it, vi } from "vitest";

import { estimateStripeFeeCents, offerInputSchema, offerSavings, splitOfferPayment } from "@repo/validators/marketplace-offers";

vi.mock("../services/treasury-ledger-service.js", () => ({
  recordFederationFee: vi.fn(async () => ({})),
  recordFederationFeeRefund: vi.fn(async () => ({})),
  recordFeeCollection: vi.fn(async () => ({})),
  recordRefund: vi.fn(async () => ({})),
  recordStripeFeeShortfall: vi.fn(async () => ({})),
}));

import { calculateOfferPricing } from "../services/checkout-pricing-service.js";
import { recordFederationFee, recordFederationFeeRefund, recordFeeCollection, recordRefund, recordStripeFeeShortfall } from "../services/treasury-ledger-service.js";
import {
  cancelCommitment,
  canTransition,
  commitToOffer,
  handleOfferPaymentRefunded,
  handleOfferPaymentSucceeded,
  listOffersForSteward,
  mySavings,
  openPayment,
  runOfferSweep,
  stewardApprove,
} from "../services/marketplace-offers/index.js";
import { createFakeOfferDb, seedOfferWorld } from "./fixtures/fake-offer-db.js";

const DAY_MS = 86_400_000;

function fakeStripe() {
  return {
    refunds: { create: vi.fn(async () => ({ id: "re_1" })) },
    paymentIntents: { cancel: vi.fn(async () => ({})) },
    checkout: { sessions: { expire: vi.fn(async () => ({})) } },
    charges: { retrieve: vi.fn(async () => ({ balance_transaction: { fee: 134 } })) },
  } as any;
}

describe("offer pricing", () => {
  it("charges the member price with no markup, pays the vendor their fixed amount, and splits the rest after Stripe", () => {
    const breakdown = calculateOfferPricing({ memberUnitCents: 1800, quantity: 2, vendorUnitCents: 1500, commonsSplitBps: 5000 });
    expect(breakdown).toMatchObject({
      listedAmount: 3600,
      chargedAmount: 3600,
      platformMarkupAmount: 0,
      merchantSettlementAmount: 3000,
      estimatedStripeFeeAmount: 134,
      treasuryFeeAmount: 233,
      federationFeeAmount: 233,
    });
  });

  it("estimates Stripe's fee as 2.9% plus 30 cents", () => {
    expect(estimateStripeFeeCents(1800)).toBe(82);
    expect(estimateStripeFeeCents(3600)).toBe(134);
  });

  it("splits what's left by the offer's Commons share, and never lets the Commons go negative", () => {
    expect(splitOfferPayment({ chargedCents: 1800, vendorCents: 1500, stripeFeeCents: 82, commonsSplitBps: 7000 })).toMatchObject({ remainderCents: 218, commonsCents: 152, cahootzCents: 66 });
    expect(splitOfferPayment({ chargedCents: 1000, vendorCents: 950, stripeFeeCents: 59, commonsSplitBps: 5000 })).toMatchObject({ remainderCents: -9, commonsCents: 0, cahootzCents: -9 });
  });

  it("works out savings once, rounding the percent down", () => {
    expect(offerSavings(2400, 1800)).toEqual({ savingsCents: 600, savingsPercent: 25 });
    expect(offerSavings(2999, 2000, 3)).toEqual({ savingsCents: 2997, savingsPercent: 33 });
  });
});

describe("offer input rules", () => {
  const base = {
    offerType: "GROUP_BUY" as const,
    productId: "p1",
    title: "Rice",
    regularPriceCents: 2400,
    regularPriceSource: "Shelf price",
    memberPriceCents: 1800,
    vendorPayoutCents: 1500,
    minimumCommitments: 10,
    minimumPaidOrders: 8,
    commitmentDeadline: "2026-11-01T00:00:00Z",
  };

  it("accepts a complete Group Buy", () => {
    expect(offerInputSchema.safeParse(base).success).toBe(true);
  });

  it("rejects a member price that isn't a saving", () => {
    const result = offerInputSchema.safeParse({ ...base, memberPriceCents: 2400 });
    expect(result.success).toBe(false);
  });

  it("rejects a vendor amount that leaves nothing after Stripe's fee", () => {
    expect(offerInputSchema.safeParse({ ...base, vendorPayoutCents: 1800 }).success).toBe(false);
    expect(offerInputSchema.safeParse({ ...base, vendorPayoutCents: 1750 }).success).toBe(false);
    expect(offerInputSchema.safeParse({ ...base, vendorPayoutCents: 1900 }).success).toBe(false);
  });

  it("rejects a paid minimum above the commitment minimum", () => {
    expect(offerInputSchema.safeParse({ ...base, minimumPaidOrders: 11 }).success).toBe(false);
  });

  it("needs an end date for a Member Deal", () => {
    expect(offerInputSchema.safeParse({ ...base, offerType: "MEMBER_DEAL" }).success).toBe(false);
    expect(offerInputSchema.safeParse({ ...base, offerType: "MEMBER_DEAL", expiresAt: "2026-11-30" }).success).toBe(true);
  });
});

describe("offer status rules", () => {
  it("only allows listed moves", () => {
    expect(canTransition("GROUP_BUY", "LIVE", "AWAITING_VENDOR")).toBe(true);
    expect(canTransition("GROUP_BUY", "LIVE", "PAYMENT_OPEN")).toBe(false);
    expect(canTransition("GROUP_BUY", "FULFILLED", "CANCELLED")).toBe(false);
    expect(canTransition("MEMBER_DEAL", "LIVE", "AWAITING_VENDOR")).toBe(false);
    expect(canTransition("MEMBER_DEAL", "PAUSED", "LIVE")).toBe(true);
  });
});

describe("Group Buy commitments", () => {
  let db: any;
  beforeEach(() => {
    db = createFakeOfferDb();
    seedOfferWorld(db);
  });

  it("commits without charging and keeps one row per member on a double tap", async () => {
    await commitToOffer(db, { userId: "member_1", offerId: "offer_1", quantity: 1 });
    await commitToOffer(db, { userId: "member_1", offerId: "offer_1", quantity: 1 });
    expect(db.tables.offerCommitment).toHaveLength(1);
    expect(db.tables.offerCommitment[0]).toMatchObject({ status: "COMMITTED", quantity: 1, contactName: "member 1" });
    expect(db.tables.offerCommitment[0].savingsCents ?? 0).toBe(0);
    expect(db.tables.marketplaceOffer[0].committedQuantity).toBe(1);
    expect(db.tables.commerceTransaction).toHaveLength(0);
    expect(db.$executeRaw).toHaveBeenCalled(); // took the offer lock
  });

  it("refuses commitments past the cap", async () => {
    await commitToOffer(db, { userId: "member_1", offerId: "offer_1", quantity: 2 });
    await commitToOffer(db, { userId: "member_2", offerId: "offer_1", quantity: 2 });
    await expect(commitToOffer(db, { userId: "member_3", offerId: "offer_1", quantity: 2 })).rejects.toThrow("Only 1 left");
    expect(db.tables.marketplaceOffer[0].committedQuantity).toBe(4);
  });

  it("refuses more than the per-member limit", async () => {
    await expect(commitToOffer(db, { userId: "member_1", offerId: "offer_1", quantity: 3 })).rejects.toThrow("up to 2");
  });

  it("refuses people who aren't members", async () => {
    await expect(commitToOffer(db, { userId: "outsider", offerId: "offer_1", quantity: 1 })).rejects.toThrow("Only members");
  });

  it("tells committers once when the goal is reached", async () => {
    await commitToOffer(db, { userId: "member_1", offerId: "offer_1", quantity: 2 });
    const result = await commitToOffer(db, { userId: "member_2", offerId: "offer_1", quantity: 1 });
    expect(result.thresholdReached).toBe(true);
    await commitToOffer(db, { userId: "member_3", offerId: "offer_1", quantity: 1 });
    const notices = db.tables.notification.filter((n: any) => n.type === "GROUP_BUY_THRESHOLD_REACHED");
    expect(notices.map((n: any) => n.userId).sort()).toEqual(["member_1", "member_2"]);
  });

  it("lets a member cancel before the deadline and frees the spot", async () => {
    await commitToOffer(db, { userId: "member_1", offerId: "offer_1", quantity: 2 });
    await cancelCommitment(db, { userId: "member_1", offerId: "offer_1" });
    expect(db.tables.offerCommitment[0].status).toBe("CANCELLED");
    expect(db.tables.marketplaceOffer[0].committedQuantity).toBe(0);
  });

  it("doesn't let a member cancel after the deadline", async () => {
    await commitToOffer(db, { userId: "member_1", offerId: "offer_1", quantity: 1 });
    db.tables.marketplaceOffer[0].commitmentDeadline = new Date(Date.now() - 1000);
    await expect(cancelCommitment(db, { userId: "member_1", offerId: "offer_1" })).rejects.toThrow("deadline has passed");
  });
});

describe("offer payments", () => {
  let db: any;
  let stripe: any;
  beforeEach(() => {
    vi.mocked(recordFederationFee).mockClear();
    vi.mocked(recordFeeCollection).mockClear();
    vi.mocked(recordRefund).mockClear();
    vi.mocked(recordFederationFeeRefund).mockClear();
    vi.mocked(recordStripeFeeShortfall).mockClear();
    db = createFakeOfferDb();
    stripe = fakeStripe();
    seedOfferWorld(db, { status: "PAYMENT_OPEN", paymentDeadline: new Date(Date.now() + 3600_000) });
    db.tables.offerCommitment.push({
      id: "c1",
      offerId: "offer_1",
      userId: "member_1",
      quantity: 2,
      status: "PAYMENT_PENDING",
      regularUnitCents: 2400,
      memberUnitCents: 1800,
      savingsCents: 0,
      commerceTransactionId: "tx_1",
      contactName: "member 1",
    });
    db.tables.commerceTransaction.push({
      id: "tx_1",
      offerId: "offer_1",
      customerId: "member_1",
      coopId: "church",
      status: "COMPLETED",
      chargedAmount: 36,
      merchantSettlementAmount: 30,
      refundedAmount: 0,
      treasuryFeeAmount: 0,
      federationFeeAmount: 0,
      processingFeeAmount: 1.34,
      currency: "USD",
      stripePaymentIntentId: "pi_1",
    });
  });

  it("marks the spot paid and records the saving and federation share", async () => {
    const result = await handleOfferPaymentSucceeded(db, "tx_1", stripe);
    expect(result).toMatchObject({ outcome: "PAID", savingsCents: 1200 });
    expect(db.tables.offerCommitment[0]).toMatchObject({ status: "PAID", savingsCents: 1200 });
    // $36 paid, Stripe kept $1.34, vendor gets $30: $4.66 left, split 50/50.
    expect(recordFeeCollection).toHaveBeenCalledWith(expect.objectContaining({ coopId: "church", amount: 2.33 }));
    expect(recordFederationFee).toHaveBeenCalledWith(expect.objectContaining({ coopId: "church", amount: 2.33 }));
    expect(db.tables.commerceTransaction[0]).toMatchObject({ treasuryFeeAmount: 2.33, federationFeeAmount: 2.33 });
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });

  it("waits for Stripe's real fee before recording any shares", async () => {
    db.tables.commerceTransaction[0].processingFeeAmount = null;
    await handleOfferPaymentSucceeded(db, "tx_1", stripe);
    expect(recordFeeCollection).not.toHaveBeenCalled();
    expect(recordFederationFee).not.toHaveBeenCalled();
  });

  it("records a shortfall for Cahootz when Stripe's fee is bigger than what's left", async () => {
    Object.assign(db.tables.commerceTransaction[0], { merchantSettlementAmount: 35, processingFeeAmount: 1.34 });
    await handleOfferPaymentSucceeded(db, "tx_1", stripe);
    expect(recordFeeCollection).not.toHaveBeenCalled();
    expect(recordStripeFeeShortfall).toHaveBeenCalledWith(expect.objectContaining({ amount: 0.34 }));
  });

  it("refunds a payment that lands after the window closed", async () => {
    db.tables.marketplaceOffer[0].status = "FAILED";
    const result = await handleOfferPaymentSucceeded(db, "tx_1", stripe);
    expect(result.outcome).toBe("REFUNDED_LATE_OR_DUPLICATE");
    expect(stripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: "pi_1", reverse_transfer: true }),
      { idempotencyKey: "offer-refund:tx_1" },
    );
    expect(db.tables.offerCommitment[0].savingsCents).toBe(0);
  });

  it("refunds a second payment for a spot that's already paid", async () => {
    db.tables.offerCommitment[0].status = "PAID";
    db.tables.offerCommitment[0].commerceTransactionId = "tx_other";
    const result = await handleOfferPaymentSucceeded(db, "tx_1", stripe);
    expect(result.outcome).toBe("REFUNDED_LATE_OR_DUPLICATE");
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
  });

  it("removes the saving on a full refund and shrinks it on a partial one", async () => {
    await handleOfferPaymentSucceeded(db, "tx_1", stripe);
    // What the ledger credited at payment time; refunds reverse it in proportion.
    db.tables.treasuryLedgerEntry.push(
      { sourceTransactionId: "tx_1", direction: "CREDIT", sourceTransactionType: "COMMERCE_FEE", amount: 2.33 },
      { sourceTransactionId: "tx_1", direction: "CREDIT", sourceTransactionType: "FEDERATION_FEE", amount: 2.33 },
    );
    await handleOfferPaymentRefunded(db, { transactionId: "tx_1", refundedAmount: 9, chargedAmount: 36, incrementalRatio: 0.25, idempotencyKey: "ch:900" });
    expect(db.tables.offerCommitment[0]).toMatchObject({ status: "PAID", savingsCents: 900 });
    await handleOfferPaymentRefunded(db, { transactionId: "tx_1", refundedAmount: 36, chargedAmount: 36, incrementalRatio: 0.75, idempotencyKey: "ch:3600" });
    expect(db.tables.offerCommitment[0]).toMatchObject({ status: "REFUNDED", savingsCents: 0 });
    expect(recordFederationFeeRefund).toHaveBeenCalledTimes(2);
    expect(recordRefund).toHaveBeenCalledWith(expect.objectContaining({ amount: 2.33 * 0.25, idempotencyKey: "ch:900" }));
  });

  it("only counts paid offers in a member's savings", async () => {
    db.tables.offerCommitment.push({ id: "c2", offerId: "offer_1", userId: "member_1", quantity: 1, status: "COMMITTED", savingsCents: 0, memberUnitCents: 1800 });
    await handleOfferPaymentSucceeded(db, "tx_1", stripe);
    const savings = await mySavings(db, "member_1");
    expect(savings.totalSavingsCents).toBe(1200);
    expect(savings.offers).toHaveLength(1);
  });
});

describe("offer sweep", () => {
  let db: any;
  let stripe: any;
  beforeEach(() => {
    db = createFakeOfferDb();
    stripe = fakeStripe();
  });

  function commit(userId: string, quantity: number, status = "COMMITTED", extra: Record<string, unknown> = {}) {
    db.tables.offerCommitment.push({
      id: `c_${userId}`,
      offerId: "offer_1",
      userId,
      quantity,
      status,
      regularUnitCents: 2400,
      memberUnitCents: 1800,
      savingsCents: status === "PAID" ? 600 * quantity : 0,
      ...extra,
    });
  }

  it("expires a Group Buy that missed its goal and tells committers they weren't charged", async () => {
    seedOfferWorld(db, { commitmentDeadline: new Date(Date.now() - 1000) });
    commit("member_1", 1);
    const result = await runOfferSweep(db, new Date(), stripe);
    expect(result.groupBuysExpired).toBe(1);
    expect(db.tables.marketplaceOffer[0].status).toBe("EXPIRED");
    const notice = db.tables.notification.find((n: any) => n.type === "GROUP_BUY_EXPIRED");
    expect(notice.body).toContain("weren't charged");
  });

  it("hands a Group Buy that met its goal to the vendor", async () => {
    seedOfferWorld(db, { commitmentDeadline: new Date(Date.now() - 1000) });
    commit("member_1", 2);
    commit("member_2", 1);
    const result = await runOfferSweep(db, new Date(), stripe);
    expect(result.groupBuysClosed).toBe(1);
    expect(db.tables.marketplaceOffer[0].status).toBe("AWAITING_VENDOR");
    expect(db.tables.notification.some((n: any) => n.userId === "vendor_1" && n.type === "VENDOR_OFFER_READY_TO_CONFIRM")).toBe(true);
    // A second run does nothing new.
    await runOfferSweep(db, new Date(), stripe);
    expect(db.tables.notification.filter((n: any) => n.type === "VENDOR_OFFER_READY_TO_CONFIRM")).toHaveLength(1);
  });

  it("confirms a Group Buy with enough payments and releases unpaid spots", async () => {
    seedOfferWorld(db, { status: "PAYMENT_OPEN", paymentDeadline: new Date(Date.now() - 1000) });
    commit("member_1", 2, "PAID");
    commit("member_2", 1, "COMMITTED");
    const result = await runOfferSweep(db, new Date(), stripe);
    expect(result.groupBuysConfirmed).toBe(1);
    expect(db.tables.marketplaceOffer[0].status).toBe("CONFIRMED");
    expect(db.tables.offerCommitment.find((c: any) => c.userId === "member_2").status).toBe("LAPSED");
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });

  it("calls off a Group Buy that's short on payments and refunds everyone who paid", async () => {
    seedOfferWorld(db, { status: "PAYMENT_OPEN", paymentDeadline: new Date(Date.now() - 1000) });
    commit("member_1", 1, "PAID", { commerceTransactionId: "tx_1" });
    commit("member_2", 2, "COMMITTED");
    db.tables.commerceTransaction.push({ id: "tx_1", offerId: "offer_1", status: "COMPLETED", stripePaymentIntentId: "pi_1" });
    const result = await runOfferSweep(db, new Date(), stripe);
    expect(result.groupBuysFailed).toBe(1);
    expect(db.tables.marketplaceOffer[0].status).toBe("FAILED");
    expect(stripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: "pi_1", reverse_transfer: true }),
      { idempotencyKey: "offer-refund:tx_1" },
    );
  });

  it("expires Member Deals past their end date", async () => {
    seedOfferWorld(db, { offerType: "MEMBER_DEAL", expiresAt: new Date(Date.now() - 1000), commitmentDeadline: null });
    const result = await runOfferSweep(db, new Date(), stripe);
    expect(result.dealsExpired).toBe(1);
    expect(db.tables.marketplaceOffer[0].status).toBe("EXPIRED");
  });

  it("fills in Stripe's fee on paid offer orders that are missing it", async () => {
    seedOfferWorld(db, { offerType: "MEMBER_DEAL", expiresAt: new Date(Date.now() + DAY_MS), commitmentDeadline: null });
    db.tables.commerceTransaction.push({ id: "tx_fee", offerId: "offer_1", status: "COMPLETED", stripeChargeId: "ch_1", processingFeeAmount: null });
    const result = await runOfferSweep(db, new Date(), stripe);
    expect(result.processingFeesFilled).toBe(1);
    expect(db.tables.commerceTransaction[0].processingFeeAmount).toBe(1.34);
    expect(stripe.charges.retrieve).toHaveBeenCalledWith("ch_1", { expand: ["balance_transaction"] });
  });

  it("sends each payment reminder once", async () => {
    seedOfferWorld(db, { status: "PAYMENT_OPEN", paymentDeadline: new Date(Date.now() + 20 * 3600_000) });
    commit("member_1", 1);
    await runOfferSweep(db, new Date(), stripe);
    await runOfferSweep(db, new Date(), stripe);
    expect(db.tables.notification.filter((n: any) => n.type === "GROUP_BUY_PAYMENT_REMINDER")).toHaveLength(1);
  });
});

describe("stewards and vendors", () => {
  let db: any;
  beforeEach(() => {
    db = createFakeOfferDb();
    seedOfferWorld(db, { status: "PENDING_STEWARD" });
    db.marketplaceOffer.findMany = vi.fn(async () =>
      db.tables.marketplaceOffer.map((o: any) => ({ ...o, store: { id: "store_1", name: "Corner Market" }, product: { id: "product_1", name: "Rice", imageUrl: null } })),
    );
  });

  it("lets only a steward approve an offer", async () => {
    await expect(stewardApprove(db, "member_1", "offer_1")).rejects.toThrow("steward");
    await stewardApprove(db, "steward_1", "offer_1");
    expect(db.tables.marketplaceOffer[0]).toMatchObject({ status: "LIVE", stewardApprovedById: "steward_1" });
  });

  it("shows stewards totals, never who joined", async () => {
    db.tables.marketplaceOffer[0].status = "LIVE";
    await commitToOffer(db, { userId: "member_1", offerId: "offer_1", quantity: 2 });
    const [offer] = await listOffersForSteward(db, "steward_1", "church");
    expect(offer).toMatchObject({ committedQuantity: 2, householdCount: 1 });
    const serialized = JSON.stringify(offer);
    expect(serialized).not.toContain("member_1");
    expect(serialized).not.toContain("555-0100");
    expect(offer).not.toHaveProperty("commitments");
  });

  it("opens a payment window when the vendor confirms", async () => {
    Object.assign(db.tables.marketplaceOffer[0], { status: "AWAITING_VENDOR" });
    db.tables.offerCommitment.push({ id: "c1", offerId: "offer_1", userId: "member_1", quantity: 1, status: "COMMITTED" });
    const now = new Date("2026-11-01T12:00:00Z");
    const { paymentDeadline } = await openPayment(db, "vendor_1", "offer_1", now);
    expect(paymentDeadline.toISOString()).toBe("2026-11-04T12:00:00.000Z");
    expect(db.tables.marketplaceOffer[0].status).toBe("PAYMENT_OPEN");
    expect(db.tables.notification.find((n: any) => n.type === "GROUP_BUY_PAYMENT_OPEN").userId).toBe("member_1");
  });
});
