import {
  BLUES_OF_AMERICA_PRODUCTS,
  calculateProductSplit,
  COMMONS_CATALOGS,
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

  it("reconciles the buyer savings and both cuts to the public retail price", () => {
    for (const catalog of COMMONS_CATALOGS) {
      for (const product of catalog.products) {
        const split = calculateProductSplit(product);

        expect(
          split.bulkShareCents +
            split.commonsCutCents +
            split.cahootzCutCents +
            split.memberSavingsCents,
        ).toBe(split.regularPriceCents);
        expect(split.memberPriceCents + split.memberSavingsCents).toBe(
          split.regularPriceCents,
        );
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

    expect(calculateProductSplit(laundryPods)).toMatchObject({
      bulkShareCents: 1217,
      commonsCutCents: 167,
      cahootzCutCents: 167,
      memberSavingsCents: 1338,
      memberPriceCents: 1551,
    });
  });

  it("calculates the organic-coffee shared price", () => {
    const coffee = PLANET_BUY_PRODUCTS.find(
      ({ id }) => id === "organic-coffee",
    );

    if (!coffee) {
      throw new Error("Organic-coffee fixture is missing");
    }

    expect(calculateProductSplit(coffee)).toMatchObject({
      bulkShareCents: 694,
      commonsCutCents: 51,
      cahootzCutCents: 51,
      memberSavingsCents: 403,
      memberPriceCents: 796,
    });
  });

  it("calculates a Traveler Commons shared price", () => {
    const mistingFan = TRAVELER_COMMONS_PRODUCTS.find(
      ({ id }) => id === "water-fan",
    );

    if (!mistingFan) {
      throw new Error("Traveler misting-fan fixture is missing");
    }

    expect(calculateProductSplit(mistingFan)).toMatchObject({
      bulkShareCents: 1096,
      commonsCutCents: 60,
      cahootzCutCents: 60,
      memberSavingsCents: 483,
      memberPriceCents: 1216,
    });
  });

  it("does not create negative savings when there is no bulk discount", () => {
    expect(
      calculateProductSplit({
        regularPriceCents: 1200,
        bulkShareCents: 1400,
      }),
    ).toMatchObject({
      grossDiscountCents: 0,
      commonsCutCents: 0,
      cahootzCutCents: 0,
      memberSavingsCents: 0,
      memberPriceCents: 1400,
    });
  });
});
