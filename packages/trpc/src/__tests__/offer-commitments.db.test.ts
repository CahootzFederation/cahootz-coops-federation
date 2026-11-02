import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Group Buy commitments under real concurrency, against a real Postgres
 * database. Skipped unless TEST_DATABASE_URL is set (see vitest.db.config.ts).
 */
const enabled = !!process.env.TEST_DATABASE_URL;
const run = `e2e-offer-db-${Date.now()}`;
const COOP = `${run}-coop`;
const MEMBERS = 30;
const CAP = 25;
const ADDRESS = { name: "E2E member", line1: "1 Test St", line2: null, city: "Atlanta", state: "GA", postalCode: "30310" };

describe.skipIf(!enabled)("Group Buy commitments in Postgres", () => {
  let db: typeof import("@repo/db").db;
  let commitToOffer: typeof import("../services/marketplace-offers/index.js").commitToOffer;
  let offerId: string;
  const userIds: string[] = [];

  beforeAll(async () => {
    ({ db } = await import("@repo/db"));
    ({ commitToOffer } = await import("../services/marketplace-offers/index.js"));
    for (let i = 0; i < MEMBERS; i++) {
      const user = await db.user.create({ data: { email: `${run}-m${i}@test.cahootz.local`, name: `E2E member ${i}` } });
      userIds.push(user.id);
      await db.userCoopMembership.create({ data: { userId: user.id, coopId: COOP, status: "ACTIVE" } });
      // Committing needs a saved card; it's never charged here.
      await db.paymentMethod.create({
        data: { userId: user.id, stripePaymentMethodId: `pm_${run}_${i}`, type: "card", brand: "visa", last4: "4242", expiryMonth: 12, expiryYear: 2034, isDefault: true },
      });
    }
    const offer = await db.marketplaceOffer.create({
      data: {
        offerType: "GROUP_BUY",
        coopId: COOP,
        vendorName: "E2E vendor",
        title: "E2E rice group buy",
        regularPriceCents: 2400,
        regularPriceSource: "Shelf price",
        memberPriceCents: 1800,
        vendorPayoutCents: 1500,
        minimumCommitments: 10,
        minimumPaidOrders: 8,
        maximumQuantity: CAP,
        quantityPerMember: 1,
        commitmentDeadline: new Date(Date.now() + 86_400_000),
        status: "LIVE",
        createdById: "e2e",
      },
    });
    offerId = offer.id;
  });

  afterAll(async () => {
    if (!db) return;
    await db.notification.deleteMany({ where: { coopId: COOP } });
    await db.auditLog.deleteMany({ where: { resourceId: offerId } });
    await db.marketplaceOffer.deleteMany({ where: { coopId: COOP } });
    await db.userCoopMembership.deleteMany({ where: { coopId: COOP } });
    await db.user.deleteMany({ where: { email: { startsWith: run } } });
    await db.$disconnect();
  });

  it("never lets more members in than the cap, even all at once", async () => {
    const results = await Promise.allSettled(
      userIds.map((userId) => commitToOffer(db, { userId, offerId, quantity: 1, shippingAddress: ADDRESS })),
    );
    const accepted = results.filter((r) => r.status === "fulfilled").length;
    const refused = results.filter((r) => r.status === "rejected");
    expect(accepted).toBe(CAP);
    expect(refused).toHaveLength(MEMBERS - CAP);
    refused.forEach((r) => expect((r as PromiseRejectedResult).reason.message).toMatch(/full|left/));

    const rows = await db.offerCommitment.findMany({ where: { offerId, status: "COMMITTED" } });
    const offer = await db.marketplaceOffer.findUniqueOrThrow({ where: { id: offerId } });
    expect(rows).toHaveLength(CAP);
    expect(offer.committedQuantity).toBe(rows.reduce((sum, row) => sum + row.quantity, 0));
    // The goal notice went out once per committed member, not once per request.
    const notices = await db.notification.count({ where: { coopId: COOP, type: "GROUP_BUY_THRESHOLD_REACHED" } });
    expect(notices).toBeLessThanOrEqual(CAP);
  });

  it("keeps one row when the same member taps commit several times at once", async () => {
    const member = userIds[0]!;
    const before = await db.offerCommitment.count({ where: { offerId, userId: member } });
    await Promise.allSettled([1, 2, 3, 4, 5].map(() => commitToOffer(db, { userId: member, offerId, quantity: 1, shippingAddress: ADDRESS })));
    const after = await db.offerCommitment.count({ where: { offerId, userId: member } });
    expect(before).toBeLessThanOrEqual(1);
    expect(after).toBe(1);
    const offer = await db.marketplaceOffer.findUniqueOrThrow({ where: { id: offerId } });
    expect(offer.committedQuantity).toBe(CAP);
  });
});
