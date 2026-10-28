import { describe, expect, it, vi } from "vitest";

import type { ProductDiscoveryCandidate } from "../services/product-discovery.js";
import {
  limitSharedProductsBetweenCatalogs,
  listHomepageProductCatalogs,
  normalizePublicHttpUrl,
  runProductDiscoveryForProfile,
  scoreExistingProductForProfile,
} from "../services/product-discovery.js";

const NOW = new Date("2026-10-27T12:00:00.000Z");

function candidate(
  overrides: Partial<ProductDiscoveryCandidate> = {},
): ProductDiscoveryCandidate {
  return {
    name: "Refillable travel bottle set",
    description: "Four compact refillable bottles supplied by the case.",
    category: "Travel organization",
    brand: "Example Brand",
    supplierName: "Example Supplier",
    imageUrl: "https://supplier.example/bottles.jpg",
    imageAlt: "Four refillable travel bottles",
    sourceUrl: "https://supplier.example/wholesale-bottles",
    comparisonUrl: "https://retailer.example/travel-bottles",
    memberShare: "4 bottles",
    peopleNeeded: 24,
    regularPriceCents: 1200,
    bulkShareCents: 700,
    purpose: "A repeatable travel essential that can be divided by the case.",
    fitScore: 90,
    fitReason: "The product fits the travel and reusable search terms.",
    tone: "mint",
    verifiedFacts: ["The supplier page lists a 24-unit case."],
    risksOrUnverifiedClaims: [
      "Shipping and wholesale eligibility need review.",
    ],
    ...overrides,
  };
}

describe("product discovery", () => {
  it("caps shared homepage products at two for every pair of Commons", () => {
    const product = (id: string) => ({ id }) as never;
    const catalogs = [
      {
        id: "planet",
        name: "Planet Commons",
        description: "Planet",
        participantLabel: "households",
        products: [
          product("shared-1"),
          product("shared-2"),
          product("shared-3"),
        ],
      },
      {
        id: "family",
        name: "Family Commons",
        description: "Family",
        participantLabel: "households",
        products: [
          product("family-only"),
          product("shared-1"),
          product("shared-2"),
          product("shared-3"),
        ],
      },
    ];

    expect(
      limitSharedProductsBetweenCatalogs(catalogs)[1]?.products.map(
        ({ id }) => id,
      ),
    ).toEqual(["family-only", "shared-1", "shared-2"]);
  });

  it("accepts only public HTTP(S) source URLs", () => {
    expect(
      normalizePublicHttpUrl("https://supplier.example/item#details"),
    ).toBe("https://supplier.example/item");
    expect(normalizePublicHttpUrl("javascript:alert(1)")).toBeNull();
    expect(normalizePublicHttpUrl("not a url")).toBeNull();
  });

  it("scores verified products for cross-Commons reuse and honors exclusions", () => {
    const profile = {
      searchPrompt: "Find reusable travel essentials",
      searchTerms: ["portable", "travel", "reusable"],
      excludedTerms: ["restricted"],
    };

    expect(
      scoreExistingProductForProfile(profile, {
        name: "Reusable travel bottle",
        description: "A portable refillable bottle for trips.",
        category: "Travel",
        brand: "Example",
      }),
    ).toBeGreaterThanOrEqual(20);
    expect(
      scoreExistingProductForProfile(profile, {
        name: "Restricted travel item",
        description: "Portable and reusable.",
        category: "Travel",
        brand: "Example",
      }),
    ).toBe(0);
  });

  it("stores external and cross-Commons results as candidates, never approved offers", async () => {
    const createdMatches: Array<Record<string, unknown>> = [];
    const createdProducts: Array<Record<string, unknown>> = [];
    const createdObservations: Array<Record<string, unknown>> = [];
    const runUpdates: Array<Record<string, unknown>> = [];
    const database = {
      commonsProductProfile: {
        findUnique: vi.fn().mockResolvedValue({
          id: "profile-traveler",
          key: "traveler",
          coopId: null,
          name: "Traveler Commons",
          description: "Travel essentials",
          searchPrompt: "Find reusable travel essentials",
          searchTerms: ["travel", "portable", "reusable"],
          excludedTerms: [],
          maxCandidatesPerRun: 4,
          monthlyRunLimit: 5,
          isEnabled: true,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      productDiscoveryRun: {
        create: vi.fn().mockResolvedValue({
          id: "run-1",
          status: "RUNNING",
        }),
        count: vi.fn().mockResolvedValue(0),
        update: vi.fn().mockImplementation(({ data }) => {
          runUpdates.push(data);
          return Promise.resolve({});
        }),
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
      commonsProductMatch: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(({ data }) => {
          createdMatches.push(data);
          return Promise.resolve({});
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      sourcedProduct: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "verified-product",
            name: "Reusable packing cubes",
            description: "Portable travel organizers.",
            category: "Travel",
            brand: "Existing Brand",
          },
        ]),
        findUnique: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({
          id: "rejected-product",
          status: "REJECTED",
        }),
        create: vi.fn().mockImplementation(({ data }) => {
          createdProducts.push(data);
          return Promise.resolve({
            id: "new-product",
            status: data.status,
          });
        }),
      },
      productPriceObservation: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(({ data }) => {
          createdObservations.push(data);
          return Promise.resolve({});
        }),
      },
      aIEvaluation: { create: vi.fn().mockResolvedValue({}) },
      $transaction: vi
        .fn()
        .mockImplementation((operations) => Promise.all(operations)),
    };

    const result = await runProductDiscoveryForProfile({
      profileKey: "traveler",
      trigger: "scheduled",
      idempotencyKey: "scheduled:traveler:2026-10-27",
      now: NOW,
      database: database as never,
      provider: {
        discover: vi.fn().mockResolvedValue({
          candidates: [
            candidate(),
            candidate({
              name: "Rejected bottle set",
              sourceUrl: "https://supplier.example/rejected-bottles",
            }),
          ],
          rawInput: { query: "test" },
          rawOutput: { candidates: 2 },
        }),
      },
    });

    expect(result).toMatchObject({
      status: "succeeded",
      crossCommonsCount: 1,
      savedProductCount: 1,
      savedMatchCount: 2,
    });
    expect(createdProducts[0]).toMatchObject({
      status: "CANDIDATE",
    });
    expect(createdMatches).toHaveLength(2);
    expect(createdMatches.every(({ status }) => status === "CANDIDATE")).toBe(
      true,
    );
    expect(createdObservations).toHaveLength(1);
    expect(runUpdates).toContainEqual(
      expect.objectContaining({ status: "SUCCEEDED" }),
    );
  });

  it("maps only approved, verified, source-backed matches to the homepage", async () => {
    const database = {
      commonsProductProfile: {
        findMany: vi.fn().mockResolvedValue([
          {
            key: "family",
            name: "Family Commons",
            description: "Shared household staples.",
            participantLabel: "households",
            productMatches: [
              {
                purpose: "A recurring household staple.",
                tone: "pear",
                product: {
                  sourceKey: "seed:laundry-pods",
                  sourceUrl: "https://supplier.example/laundry",
                  name: "Laundry pods",
                  category: "Laundry",
                  brand: "Example",
                  imageUrl: "https://supplier.example/laundry.jpg",
                  imageAlt: "Laundry pods",
                  priceObservations: [
                    {
                      comparisonUrl: null,
                      memberShare: "64 pods",
                      peopleNeeded: 12,
                      regularPriceCents: 2800,
                      bulkShareCents: 1200,
                    },
                  ],
                },
              },
            ],
          },
        ]),
      },
    };

    await expect(
      listHomepageProductCatalogs(NOW, database as never),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "family",
        name: "Family Commons",
        products: [
          expect.objectContaining({
            name: "Laundry pods",
            regularPriceCents: 2800,
            bulkShareCents: 1200,
          }),
        ],
      }),
    ]);
  });
});
