import { normalizeHomepageVariant } from "./homepage-experiment";

describe("homepage experiment variant", () => {
  it("accepts the two PostHog multivariate values", () => {
    expect(normalizeHomepageVariant("community")).toBe("community");
    expect(normalizeHomepageVariant("group-buy")).toBe("group-buy");
  });

  it("supports a boolean rollout and falls back on unknown values", () => {
    expect(normalizeHomepageVariant(true)).toBe("group-buy");
    expect(normalizeHomepageVariant(false)).toBe("community");
    expect(normalizeHomepageVariant("unknown")).toBeNull();
    expect(normalizeHomepageVariant(undefined)).toBeNull();
  });
});
