import { DEFAULT_OFFER_PRICING } from "@repo/validators/marketplace-offers";

import {
  BLUES_OF_AMERICA_PRODUCTS,
  calculateProductSplit,
  COMMONS_CATALOGS,
  commonsPlanningRateBps,
  FAMILY_COMMONS_PRODUCTS,
  PLANET_BUY_PRODUCTS,
  TRAVELER_COMMONS_PRODUCTS,
} from "./group-buy-product-calculator";

describe("Commons product split", () => {
  it("keeps Planet first, Blues last, and gives every Commons a focused catalog", () => {
    expect(COMMONS_CATALOGS.map(({ name }) => name)).toEqual([
      "Planet Commons",
      "Traveler Commons",
      "Family Commons",
      "Blues of America",
    ]);
    expect(PLANET_BUY_PRODUCTS).toHaveLength(8);
    expect(TRAVELER_COMMONS_PRODUCTS).toHaveLength(4);
    expect(FAMILY_COMMONS_PRODUCTS).toHaveLength(4);
    expect(BLUES_OF_AMERICA_PRODUCTS).toHaveLength(4);
    for (const catalog of COMMONS_CATALOGS) {
      expect(catalog.fundingExamples).toHaveLength(3);
    }
    expect(TRAVELER_COMMONS_PRODUCTS.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "Travel laundry bags",
        "Personal safety alarm",
        "Rechargeable misting fan",
      ]),
    );
    expect(FAMILY_COMMONS_PRODUCTS.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "Laundry pods",
        "Insulated kids lunch bag",
        "30-piece food container set",
      ]),
    );
    expect(BLUES_OF_AMERICA_PRODUCTS.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "Union-printed reusable tote",
        "Fair Trade chocolate bar",
        "Organic Fair Trade coffee",
        "Recycled paper towels",
      ]),
    );
  });

  it("shares no more than two products between any pair of Commons", () => {
    for (
      let leftIndex = 0;
      leftIndex < COMMONS_CATALOGS.length;
      leftIndex += 1
    ) {
      const left = COMMONS_CATALOGS[leftIndex];
      if (!left) continue;

      const uniqueToLeft = left.products.filter((product) =>
        COMMONS_CATALOGS.every(
          (catalog) =>
            catalog.id === left.id ||
            !catalog.products.some(({ id }) => id === product.id),
        ),
      );
      expect(uniqueToLeft.length).toBeGreaterThanOrEqual(2);

      for (
        let rightIndex = leftIndex + 1;
        rightIndex < COMMONS_CATALOGS.length;
        rightIndex += 1
      ) {
        const right = COMMONS_CATALOGS[rightIndex];
        if (!right) continue;
        const rightProductIds = new Set(right.products.map(({ id }) => id));
        const shared = left.products.filter(({ id }) =>
          rightProductIds.has(id),
        );
        expect(shared.length).toBeLessThanOrEqual(2);
      }
    }
  });

  it("covers distinct everyday categories instead of repeating one aisle", () => {
    const categories = new Set(
      PLANET_BUY_PRODUCTS.map((product) => product.category),
    );

    expect(categories.size).toBeGreaterThanOrEqual(7);
    expect(PLANET_BUY_PRODUCTS.map((product) => product.name)).toEqual(
      expect.arrayContaining([
        "Organic Fair Trade coffee",
        "Solid shampoo bar",
        "Vegan soap bar",
        "Wool dryer balls",
      ]),
    );
  });

  it("uses the same price rule as real offers: seller, card fee, then the Commons and Cahootz", () => {
    for (const catalog of COMMONS_CATALOGS) {
      for (const product of catalog.products) {
        const split = calculateProductSplit(product);

        expect(
          split.vendorCents +
            split.stripeFeeCents +
            split.commonsCutCents +
            split.cahootzCutCents,
        ).toBe(split.memberPriceCents);
        expect(split.memberPriceCents + split.memberSavingsCents).toBe(
          split.regularPriceCents,
        );
        // No deal shown loses the Commons or Cahootz money.
        expect(split.commonsCutCents).toBeGreaterThan(0);
        expect(split.cahootzCutCents).toBeGreaterThan(0);
      }
    }
  });

  it("calculates the laundry-pod example shown in the hero", () => {
    const laundryPods = PLANET_BUY_PRODUCTS.find(
      ({ id }) => id === "laundry-pods",
    );

    if (!laundryPods) {
      throw new Error("Laundry-pod fixture is missing");
    }

    expect(calculateProductSplit(laundryPods)).toEqual({
      packSize: 1,
      regularPriceCents: 2889,
      vendorCents: 1217,
      stripeFeeCents: 77,
      commonsCutCents: 167,
      cahootzCutCents: 168,
      memberSavingsCents: 1260,
      memberPriceCents: 1629,
      membersNeeded: 12,
    });
  });

  it("sells a cheap item in packs so the card fee doesn't eat the savings", () => {
    const coffee = PLANET_BUY_PRODUCTS.find(
      ({ id }) => id === "organic-coffee",
    );

    if (!coffee) {
      throw new Error("Organic-coffee fixture is missing");
    }

    const split = calculateProductSplit(coffee);
    expect(split.packSize).toBe(2);
    expect(split.vendorCents).toBe(2 * coffee.bulkShareCents);
    expect(split.regularPriceCents).toBe(2 * coffee.regularPriceCents);
    expect(split.membersNeeded).toBe(Math.ceil(coffee.peopleNeeded / 2));
    expect(split.memberPriceCents).toBeGreaterThanOrEqual(1500);
  });

  it("uses the platform admin's margin", () => {
    const mistingFan = TRAVELER_COMMONS_PRODUCTS.find(
      ({ id }) => id === "water-fan",
    );

    if (!mistingFan) {
      throw new Error("Traveler misting-fan fixture is missing");
    }

    const standard = calculateProductSplit(mistingFan);
    const lower = calculateProductSplit(mistingFan, {
      ...DEFAULT_OFFER_PRICING,
      itemMarginBps: 1000,
      itemMinOrderCents: 0,
    });
    expect(lower.memberPriceCents).toBeLessThan(standard.memberPriceCents);
    expect(lower.commonsCutCents).toBeLessThan(standard.commonsCutCents);
  });

  it("shows the regular price when there is no bulk discount", () => {
    expect(
      calculateProductSplit({
        regularPriceCents: 1200,
        bulkShareCents: 1400,
      }),
    ).toMatchObject({
      commonsCutCents: 0,
      cahootzCutCents: 0,
      memberSavingsCents: 0,
      memberPriceCents: 1200,
    });
  });

  it("works out the Commons planning rate from the deals shown", () => {
    const rate = commonsPlanningRateBps(COMMONS_CATALOGS);
    expect(rate).toBeGreaterThan(0);
    expect(rate).toBeLessThan(2000);
    expect(commonsPlanningRateBps([])).toBeNull();
  });
});
