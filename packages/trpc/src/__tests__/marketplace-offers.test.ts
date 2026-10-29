import { beforeEach, describe, expect, it, vi } from "vitest";

import { estimateStripeFeeCents, offerInputSchema, offerSavings, splitOfferPayment } from "@repo/validators/marketplace-offers";

// Charging a saved card settles on the spot; the real version writes through the shared db.
vi.mock("../services/payment-orchestration-service.js", () => ({
  processSuccessfulPayment: vi.fn(async () => ({})),
}));

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
  closeCommitmentsEarly,
  getOfferForAdmin,
  handleOfferPaymentRefunded,
  handleOfferPaymentSucceeded,
  mySavings,
  recordVendorPayout,
  runOfferSweep,
  publishOffer,
  sendWeeklyDealsDigest,
  digestText,
} from "../services/marketplace-offers/index.js";
import { createFakeOfferDb, seedOfferWorld } from "./fixtures/fake-offer-db.js";

const DAY_MS = 86_400_000;
const ADDRESS = { name: "Member One", line1: "1 Main St", line2: null, city: "Atlanta", state: "GA", postalCode: "30310" };

function fakeStripe() {
  return {
    refunds: { create: vi.fn(async () => ({ id: "re_1" })) },
    paymentIntents: {
      cancel: vi.fn(async () => ({})),
      // pm_member_2's card is declined; every other saved card goes through.
      create: vi.fn(async (params: any) => {
        if (params.payment_method === "pm_member_2") throw Object.assign(new Error("Your card was declined."), { code: "card_declined" });
        return { id: `pi_${params.metadata.offerCommitmentId}`, status: "succeeded", latest_charge: "ch_1" };
      }),
    },
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
    vendorName: "Corner Market",
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

  it("only takes group buys, each naming its vendor", () => {
    expect(offerInputSchema.safeParse({ ...base, offerType: "MEMBER_DEAL" }).success).toBe(false);
    const { vendorName: _vendorName, ...noVendor } = base;
    expect(offerInputSchema.safeParse(noVendor).success).toBe(false);
  });
});

describe("offer status rules", () => {
  it("only allows listed moves", () => {
    // The goal is met: straight to charging saved cards, no vendor step in the app.
    expect(canTransition("GROUP_BUY", "LIVE", "PAYMENT_OPEN")).toBe(true);
    expect(canTransition("GROUP_BUY", "FULFILLED", "CANCELLED")).toBe(false);
    // Member Deals aren't offered anymore; an old one can only be cancelled.
    expect(canTransition("MEMBER_DEAL", "DRAFT", "LIVE")).toBe(false);
    expect(canTransition("MEMBER_DEAL", "LIVE", "CANCELLED")).toBe(true);
    // A platform admin publishes a draft straight to members; there's no steward step.
    expect(canTransition("GROUP_BUY", "DRAFT", "LIVE")).toBe(true);
    expect(canTransition("GROUP_BUY", "DRAFT", "PENDING_STEWARD")).toBe(false);
  });
});

describe("Group Buy commitments", () => {
  let db: any;
  beforeEach(() => {
    db = createFakeOfferDb();
    seedOfferWorld(db);
  });

  it("commits without charging and keeps one row per member on a double tap", async () => {
    await commitToOffer(db, { userId: "member_1", offerId: "offer_1", quantity: 1, shippingAddress: ADDRESS });
    await commitToOffer(db, { userId: "member_1", offerId: "offer_1", quantity: 1, shippingAddress: ADDRESS });
    expect(db.tables.offerCommitment).toHaveLength(1);
    expect(db.tables.offerCommitment[0]).toMatchObject({
      status: "COMMITTED",
      quantity: 1,
      contactName: "member 1",
      shippingAddress: ADDRESS,
      stripePaymentMethodId: "pm_member_1",
    });
    expect(db.tables.offerCommitment[0].savingsCents ?? 0).toBe(0);
    expect(db.tables.marketplaceOffer[0].committedQuantity).toBe(1);
    expect(db.tables.commerceTransaction).toHaveLength(0);
    expect(db.$executeRaw).toHaveBeenCalled(); // took the offer lock
  });

  it("refuses commitments past the cap", async () => {
    await commitToOffer(db, { userId: "member_1", offerId: "offer_1", quantity: 2, shippingAddress: ADDRESS });
    await commitToOffer(db, { userId: "member_2", offerId: "offer_1", quantity: 2, shippingAddress: ADDRESS });
    await expect(commitToOffer(db, { userId: "member_3", offerId: "offer_1", quantity: 2, shippingAddress: ADDRESS })).rejects.toThrow("Only 1 left");
    expect(db.tables.marketplaceOffer[0].committedQuantity).toBe(4);
  });

  it("refuses more than the per-member limit", async () => {
    await expect(commitToOffer(db, { userId: "member_1", offerId: "offer_1", quantity: 3, shippingAddress: ADDRESS })).rejects.toThrow("up to 2");
  });

  it("needs a saved card, and keeps the address for the member's next order", async () => {
    db.tables.paymentMethod = db.tables.paymentMethod.filter((m: any) => m.userId !== "member_1");
    await expect(commitToOffer(db, { userId: "member_1", offerId: "offer_1", quantity: 1, shippingAddress: ADDRESS })).rejects.toThrow("Add a card first");
    await commitToOffer(db, { userId: "member_2", offerId: "offer_1", quantity: 1, shippingAddress: ADDRESS });
    expect(db.tables.userShippingAddress).toEqual([expect.objectContaining({ userId: "member_2", postalCode: "30310" })]);
  });

  it("refuses people who aren't members", async () => {
    await expect(commitToOffer(db, { userId: "outsider", offerId: "offer_1", quantity: 1, shippingAddress: ADDRESS })).rejects.toThrow("Only members");
  });

  it("tells committers once when the goal is reached", async () => {
    await commitToOffer(db, { userId: "member_1", offerId: "offer_1", quantity: 2, shippingAddress: ADDRESS });
    const result = await commitToOffer(db, { userId: "member_2", offerId: "offer_1", quantity: 1, shippingAddress: ADDRESS });
    expect(result.thresholdReached).toBe(true);
    await commitToOffer(db, { userId: "member_3", offerId: "offer_1", quantity: 1, shippingAddress: ADDRESS });
    const notices = db.tables.notification.filter((n: any) => n.type === "GROUP_BUY_THRESHOLD_REACHED");
    expect(notices.map((n: any) => n.userId).sort()).toEqual(["member_1", "member_2"]);
  });

  it("lets a member cancel before the deadline and frees the spot", async () => {
    await commitToOffer(db, { userId: "member_1", offerId: "offer_1", quantity: 2, shippingAddress: ADDRESS });
    await cancelCommitment(db, { userId: "member_1", offerId: "offer_1" });
    expect(db.tables.offerCommitment[0].status).toBe("CANCELLED");
    expect(db.tables.marketplaceOffer[0].committedQuantity).toBe(0);
  });

  it("doesn't let a member cancel after the deadline", async () => {
    await commitToOffer(db, { userId: "member_1", offerId: "offer_1", quantity: 1, shippingAddress: ADDRESS });
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

  it("refunds a payment that lands after the window closed, from Cahootz's own balance", async () => {
    db.tables.marketplaceOffer[0].status = "FAILED";
    const result = await handleOfferPaymentSucceeded(db, "tx_1", stripe);
    expect(result.outcome).toBe("REFUNDED_LATE_OR_DUPLICATE");
    expect(stripe.refunds.create).toHaveBeenCalledWith(
      expect.not.objectContaining({ reverse_transfer: true }),
      { idempotencyKey: "offer-refund:tx_1" },
    );
    expect(stripe.refunds.create.mock.calls[0][0]).toMatchObject({ payment_intent: "pi_1" });
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

  it("charges every saved card when a Group Buy meets its goal, and a declined card gets a way to pay", async () => {
    seedOfferWorld(db, { commitmentDeadline: new Date(Date.now() - 1000) });
    commit("member_1", 2, "COMMITTED", { stripePaymentMethodId: "pm_member_1" });
    commit("member_2", 1, "COMMITTED", { stripePaymentMethodId: "pm_member_2" });
    const result = await runOfferSweep(db, new Date(), stripe);
    expect(result.groupBuysClosed).toBe(1);
    expect(db.tables.marketplaceOffer[0]).toMatchObject({ status: "PAYMENT_OPEN" });
    expect(db.tables.marketplaceOffer[0].paymentDeadline).toBeInstanceOf(Date);

    // Charged off-session to Cahootz's own account: no shop, no transfer.
    expect(stripe.paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 3600, customer: "cus_member_1", payment_method: "pm_member_1", off_session: true, confirm: true }),
      { idempotencyKey: "offer-charge:c_member_1" },
    );
    expect(stripe.paymentIntents.create.mock.calls[0][0]).not.toHaveProperty("transfer_data");
    expect(db.tables.commerceTransaction[0]).toMatchObject({ businessId: null, merchantSettlementAmount: 30, chargedAmount: 36 });
    expect(db.tables.offerCommitment.find((c: any) => c.userId === "member_1")).toMatchObject({ status: "PAID", savingsCents: 1200 });

    const declined = db.tables.offerCommitment.find((c: any) => c.userId === "member_2");
    expect(declined).toMatchObject({ status: "COMMITTED", chargeError: "Your card was declined." });
    expect(db.tables.notification.find((n: any) => n.userId === "member_2" && n.title.includes("didn't go through")).body).toContain("Your card was declined.");

    // A second run charges nobody twice.
    await runOfferSweep(db, new Date(), stripe);
    expect(stripe.paymentIntents.create).toHaveBeenCalledTimes(2);
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
    expect(stripe.refunds.create.mock.calls[0][0]).toMatchObject({ payment_intent: "pi_1" });
    expect(stripe.refunds.create.mock.calls[0][1]).toEqual({ idempotencyKey: "offer-refund:tx_1" });
  });

  it("fills in Stripe's fee on paid offer orders that are missing it", async () => {
    seedOfferWorld(db);
    db.tables.commerceTransaction.push({ id: "tx_fee", offerId: "offer_1", status: "COMPLETED", stripeChargeId: "ch_1", processingFeeAmount: null });
    const result = await runOfferSweep(db, new Date(), stripe);
    expect(result.processingFeesFilled).toBe(1);
    expect(db.tables.commerceTransaction[0].processingFeeAmount).toBe(1.34);
    expect(stripe.charges.retrieve).toHaveBeenCalledWith("ch_1", { expand: ["balance_transaction"] });
  });

  it("reminds a member whose card was declined to pay, once", async () => {
    seedOfferWorld(db, { status: "PAYMENT_OPEN", paymentDeadline: new Date(Date.now() + 20 * 3600_000) });
    commit("member_1", 1, "COMMITTED", { chargeError: "Your card was declined." });
    commit("member_2", 1, "PAYMENT_PENDING");
    await runOfferSweep(db, new Date(), stripe);
    await runOfferSweep(db, new Date(), stripe);
    expect(db.tables.notification.filter((n: any) => n.type === "GROUP_BUY_PAYMENT_REMINDER")).toHaveLength(1);
  });
});

describe("publishing and vendors", () => {
  let db: any;
  beforeEach(() => {
    db = createFakeOfferDb();
    seedOfferWorld(db, { status: "DRAFT" });
  });

  it("lets a platform admin publish a draft straight to members", async () => {
    const now = new Date();
    await publishOffer(db, "admin_1", "offer_1", now);
    expect(db.tables.marketplaceOffer[0]).toMatchObject({ status: "LIVE", publishedAt: now });
    expect(db.tables.auditLog.at(-1)).toMatchObject({ action: "MARKETPLACE_OFFER_PUBLISHED", actorId: "admin_1" });
    await expect(publishOffer(db, "admin_1", "offer_1", now)).rejects.toThrow();
  });

  it("won't publish a draft whose end date has passed", async () => {
    const late = new Date(db.tables.marketplaceOffer[0].commitmentDeadline.getTime() + DAY_MS);
    await expect(publishOffer(db, "admin_1", "offer_1", late)).rejects.toThrow("end date has already passed");
    expect(db.tables.marketplaceOffer[0].status).toBe("DRAFT");
  });

  it("lets an admin close early once the goal is met, which charges saved cards", async () => {
    const stripe = fakeStripe();
    Object.assign(db.tables.marketplaceOffer[0], { status: "LIVE" });
    db.tables.offerCommitment.push(
      { id: "c1", offerId: "offer_1", userId: "member_1", quantity: 2, status: "COMMITTED", stripePaymentMethodId: "pm_member_1", regularUnitCents: 2400, memberUnitCents: 1800 },
      { id: "c3", offerId: "offer_1", userId: "member_3", quantity: 1, status: "COMMITTED", stripePaymentMethodId: "pm_member_3", regularUnitCents: 2400, memberUnitCents: 1800 },
    );
    const charges = await closeCommitmentsEarly(db, "admin_1", "offer_1", stripe, new Date("2026-11-01T12:00:00Z"));
    expect(charges).toEqual({ paid: 2, processing: 0, failed: 0 });
    expect(db.tables.marketplaceOffer[0]).toMatchObject({ status: "PAYMENT_OPEN" });
    expect(db.tables.marketplaceOffer[0].paymentDeadline.toISOString()).toBe("2026-11-03T12:00:00.000Z");
  });

  it("refuses to close early before the goal is met", async () => {
    Object.assign(db.tables.marketplaceOffer[0], { status: "LIVE" });
    await expect(closeCommitmentsEarly(db, "admin_1", "offer_1", fakeStripe())).rejects.toThrow("hasn't hit its goal");
  });

  it("lists orders with addresses for the vendor, and tracks what Cahootz owes them", async () => {
    db.tables.offerCommitment.push(
      { id: "c1", offerId: "offer_1", userId: "member_1", quantity: 2, status: "PAID", contactName: "member 1", contactPhone: "555-0100", shippingAddress: ADDRESS, committedAt: new Date() },
      { id: "c2", offerId: "offer_1", userId: "member_2", quantity: 1, status: "COMMITTED", contactName: "member 2", chargeError: "Your card was declined.", committedAt: new Date() },
      { id: "c3", offerId: "offer_1", userId: "member_3", quantity: 1, status: "CANCELLED", committedAt: new Date() },
    );
    await recordVendorPayout(db, "admin_1", "offer_1", { amountCents: 1000, paidAt: new Date("2026-11-05"), method: "Zelle" });
    await expect(recordVendorPayout(db, "admin_1", "offer_1", { amountCents: 0, paidAt: new Date(), method: "Zelle" })).rejects.toThrow("Enter the amount");
    const offer = await getOfferForAdmin(db, "offer_1");
    expect(offer.orders.map((o) => o.commitmentId)).toEqual(["c1", "c2"]);
    expect(offer.orders[0]).toMatchObject({ paid: true, address: ADDRESS, phone: "555-0100" });
    // Two units sold at $15.00 each, $10.00 paid so far.
    expect(offer.vendorPay).toEqual({ unitsSold: 2, earnedCents: 3000, paidCents: 1000, owedCents: 2000 });
    expect(db.tables.auditLog.at(-1)).toMatchObject({ action: "OFFER_VENDOR_PAID", actorId: "admin_1" });
  });
});

describe("weekly group buys notice", () => {
  const now = new Date("2026-11-02T15:00:00Z");
  const deal = (overrides: Record<string, unknown> = {}) => ({
    title: "Rice", status: "LIVE", regularPriceCents: 2400, memberPriceCents: 1800,
    committedQuantity: 3, minimumCommitments: 10, commitmentDeadline: new Date("2026-11-07T22:00:00Z"), paymentDeadline: null,
    ...overrides,
  });

  it("lists up to three deals in plain lines", () => {
    const text = digestText([
      deal(),
      deal({ title: "Laundry pods", committedQuantity: 8, minimumCommitments: 12, commitmentDeadline: new Date("2026-11-06T22:00:00Z") }),
      deal({ title: "Coffee", status: "PAYMENT_OPEN", memberPriceCents: 850, regularPriceCents: 1200 }),
      deal({ title: "Soap" }),
    ]);
    expect(text.title).toBe("This week's group buys");
    expect(text.body.split("\n")).toEqual([
      "Rice: $18.00, save 25%. 3 of 10 joined, closes Sat, Nov 7",
      "Laundry pods: $18.00, save 25%. 8 of 12 joined, closes Fri, Nov 6",
      "Coffee: it's happening, $8.50 each (save 29%)",
      "Plus 1 more in the marketplace.",
    ]);
  });

  it("tells every active member of a Commons with a group buy going, once a week", async () => {
    const db: any = createFakeOfferDb();
    seedOfferWorld(db, { status: "LIVE" });
    const members = db.tables.userCoopMembership.filter((m: any) => m.coopId === "church" && m.status === "ACTIVE").map((m: any) => m.userId);
    const first = await sendWeeklyDealsDigest(db, now);
    expect(first).toMatchObject({ commons: 1, sent: members.length });
    const notices = db.tables.notification.filter((n: any) => n.type === "OFFER_WEEKLY_DIGEST");
    expect(notices.map((n: any) => n.userId).sort()).toEqual([...members].sort());
    expect(notices[0]).toMatchObject({ coopId: "church", title: "This week's group buys", data: { coopId: "church", lane: "marketplace" } });
    expect((await sendWeeklyDealsDigest(db, now)).sent).toBe(0);
    // A new week sends again.
    expect((await sendWeeklyDealsDigest(db, new Date(now.getTime() + 7 * DAY_MS))).sent).toBe(members.length);
  });

  it("stays quiet when a Commons has no group buy going", async () => {
    const db: any = createFakeOfferDb();
    seedOfferWorld(db, { status: "DRAFT" });
    expect(await sendWeeklyDealsDigest(db, now)).toEqual({ commons: 0, sent: 0 });
  });
});
