import {
  calculateSharedPurchaseImpact,
  EXAMPLE_COMMONS_GOALS,
} from "./shared-purchase-calculator";

describe("shared purchase impact", () => {
  it("turns one group-spending amount into a Commons estimate and goal progress", () => {
    const impact = calculateSharedPurchaseImpact({
      purchaseAmountCents: 100_000,
    });

    expect(impact).toMatchObject({
      purchaseAmountCents: 100_000,
      peopleCount: 24,
      unitsPerPerson: 1,
      perPersonSpendCents: 4_167,
      commonsShareBasisPoints: 500,
      commonsShareCents: 5_000,
    });
    expect(impact.goalProjections).toEqual([
      expect.objectContaining({
        id: "shared-supplies",
        progressPercent: 50,
        ordersNeeded: 2,
      }),
      expect.objectContaining({
        id: "community-gathering",
        progressPercent: 20,
        ordersNeeded: 5,
      }),
      expect.objectContaining({
        id: "member-reserve",
        progressPercent: 5,
        ordersNeeded: 20,
      }),
      expect.objectContaining({
        id: "commons-venture",
        progressPercent: 1,
        ordersNeeded: 100,
      }),
    ]);
  });

  it("accepts a different group size and planning rate without exposing them as visitor inputs", () => {
    expect(
      calculateSharedPurchaseImpact({
        purchaseAmountCents: 240_000,
        peopleCount: 12,
        commonsShareBasisPoints: 250,
      }),
    ).toMatchObject({
      peopleCount: 12,
      perPersonSpendCents: 20_000,
      commonsShareBasisPoints: 250,
      commonsShareCents: 6_000,
    });
  });

  it("does not create progress from a negative spending amount", () => {
    const impact = calculateSharedPurchaseImpact({
      purchaseAmountCents: -100,
    });

    expect(impact.purchaseAmountCents).toBe(0);
    expect(impact.commonsShareCents).toBe(0);
    expect(
      impact.goalProjections.every(
        (goal) => goal.progressPercent === 0 && goal.ordersNeeded === null,
      ),
    ).toBe(true);
  });

  it("caps the planning rate and goal progress at one hundred percent", () => {
    const impact = calculateSharedPurchaseImpact({
      purchaseAmountCents: 600_000,
      commonsShareBasisPoints: 20_000,
      goals: EXAMPLE_COMMONS_GOALS,
    });

    expect(impact.commonsShareBasisPoints).toBe(10_000);
    expect(impact.commonsShareCents).toBe(600_000);
    expect(
      impact.goalProjections.every(
        (goal) => goal.progressPercent === 100 && goal.ordersNeeded === 1,
      ),
    ).toBe(true);
  });
});
