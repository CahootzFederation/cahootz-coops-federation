import { describe, expect, it } from "vitest";

import {
  checkOfferMargin,
  DEFAULT_OFFER_PRICING,
  makeOfferInputSchema,
  suggestItemOfferPrice,
  worstCaseStripeFeeCents,
} from "../marketplace-offers";

const base = {
  offerType: "MEMBER_DEAL" as const,
  productId: "p1",
  title: "Rice",
  regularPriceCents: 2400,
  regularPriceSource: "Posted shelf price",
  memberPriceCents: 1800,
  vendorPayoutCents: 1500,
  expiresAt: "2026-12-30",
};

describe("no deal loses the Commons or Cahootz money", () => {
  it("uses the worst-case card fee of 4.4% plus 30 cents", () => {
    expect(worstCaseStripeFeeCents(1800)).toBe(109);
    expect(worstCaseStripeFeeCents(0)).toBe(0);
  });

  it("accepts a deal where each side keeps at least the minimum at the worst-case fee", () => {
    expect(checkOfferMargin({ memberPriceCents: 1800, vendorPayoutCents: 1500, commonsSplitBps: 5000, minShareCents: 10 }).ok).toBe(true);
    expect(makeOfferInputSchema().safeParse(base).success).toBe(true);
  });

  it("refuses a thin margin that only works with a cheap card, and says how to fix it", () => {
    // $18.00 - $16.75 = $1.25: enough at 2.9% + 30¢ ($0.82), not at 4.4% + 30¢ ($1.09).
    const check = checkOfferMargin({ memberPriceCents: 1800, vendorPayoutCents: 1675, commonsSplitBps: 5000, minShareCents: 10 });
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.minMemberPriceCents).toBeGreaterThan(1800);
    expect(check.maxVendorPayoutCents).toBeLessThan(1675);
    expect(check.message).toMatch(/^With a pricier card, Stripe could take up to \$1\.09, leaving the Commons \$0\.08 and Cahootz \$0\.08\. Each side needs at least \$0\.10 per unit/);
    // The suggested fixes actually pass.
    expect(checkOfferMargin({ memberPriceCents: check.minMemberPriceCents!, vendorPayoutCents: 1675, commonsSplitBps: 5000, minShareCents: 10 }).ok).toBe(true);
    expect(checkOfferMargin({ memberPriceCents: 1800, vendorPayoutCents: check.maxVendorPayoutCents!, commonsSplitBps: 5000, minShareCents: 10 }).ok).toBe(true);
    const parsed = makeOfferInputSchema().safeParse({ ...base, vendorPayoutCents: 1675 });
    expect(parsed.success).toBe(false);
  });

  it("refuses a split that gives one side nothing", () => {
    for (const commonsSplitBps of [0, 10000]) {
      const check = checkOfferMargin({ memberPriceCents: 1800, vendorPayoutCents: 1000, commonsSplitBps, minShareCents: 10 });
      expect(check.ok).toBe(false);
      if (!check.ok) expect(check.message).toBe("The Commons and Cahootz each need a share. Set the Commons share between 1% and 99%.");
    }
  });

  it("uses the admin's minimum share", () => {
    expect(makeOfferInputSchema({ minShareCents: 50 }).safeParse({ ...base, vendorPayoutCents: 1650 }).success).toBe(false);
    expect(makeOfferInputSchema({ minShareCents: 5 }).safeParse({ ...base, vendorPayoutCents: 1650 }).success).toBe(true);
  });
});

describe("suggested price for a discovered item", () => {
  it("keeps about 80% of the discount for members and covers Stripe's fee", () => {
    // Laundry pods: $28.89 regular, $12.17 bulk.
    const pods = suggestItemOfferPrice({ regularPriceCents: 2889, bulkPriceCents: 1217 })!;
    expect(pods).toMatchObject({ packSize: 1, vendorPayoutCents: 1217, memberPriceCents: 1629, qualifies: true });
    expect(pods.stripeFeeCents).toBe(77);
    expect(pods.commonsCents + pods.cahootzCents).toBe(1629 - 77 - 1217);
    expect(pods.savingsPercent).toBe(43);
  });

  it("sells cheap items in packs so one payment is big enough", () => {
    // Travel toothbrush: $1.42 regular, $0.57 bulk.
    const brush = suggestItemOfferPrice({ regularPriceCents: 142, bulkPriceCents: 57 })!;
    expect(brush.packSize).toBe(12);
    expect(brush.vendorPayoutCents).toBe(684);
    expect(brush.memberPriceCents).toBeLessThan(brush.regularPriceCents);
    expect(brush.qualifies).toBe(true);
  });

  it("flags items where card fees eat the savings, and skips ones that cost more than regular", () => {
    // Kids lunch bag: $5.30 regular, $4.50 bulk. Packs still save under 15%.
    const bag = suggestItemOfferPrice({ regularPriceCents: 530, bulkPriceCents: 450 })!;
    expect(bag.qualifies).toBe(false);
    expect(suggestItemOfferPrice({ regularPriceCents: 500, bulkPriceCents: 500 })).toBeNull();
  });

  it("always passes the money check it suggests", () => {
    const cases: Array<[number, number]> = [[2889, 1217], [142, 57], [3900, 2730], [1699, 1096], [729, 542]];
    for (const [regular, bulk] of cases) {
      const suggestion = suggestItemOfferPrice({ regularPriceCents: regular, bulkPriceCents: bulk });
      if (!suggestion) continue;
      expect(checkOfferMargin({ memberPriceCents: suggestion.memberPriceCents, vendorPayoutCents: suggestion.vendorPayoutCents, commonsSplitBps: 5000, minShareCents: DEFAULT_OFFER_PRICING.minShareCents }).ok).toBe(true);
    }
  });
});
