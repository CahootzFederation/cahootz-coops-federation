import { describe, expect, it, vi } from "vitest";

import type { ProductDiscoveryCandidate } from "../services/product-discovery.js";
import {
  buildDiscoveryInput,
  buildDiscoveryInstructions,
  buildDiscoveryQuery,
  limitSharedProductsBetweenCatalogs,
  listHomepageProductCatalogs,
  normalizePublicHttpUrl,
  pickCandidates,
  ProductDiscoveryOutputSchema,
  progressFromModelEvent,
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

  it("lets an admin's extra search run past the monthly limit without counting it or moving the schedule", async () => {
    function fakeDatabase(monthlyRunLimit: number) {
      return {
        commonsProductProfile: {
          findUnique: vi.fn().mockResolvedValue({
            id: "profile-traveler", key: "traveler", coopId: null, name: "Traveler Commons", description: "Travel essentials",
            searchPrompt: "Find travel essentials", searchTerms: ["travel"], excludedTerms: [], maxCandidatesPerRun: 4,
            monthlyRunLimit, isEnabled: true,
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        productDiscoveryRun: {
          create: vi.fn().mockResolvedValue({ id: "run-1", status: "RUNNING" }),
          // Five scheduled searches already finished this month.
          count: vi.fn().mockResolvedValue(5),
          update: vi.fn().mockResolvedValue({}),
          findUnique: vi.fn(),
          updateMany: vi.fn(),
        },
        commonsProductMatch: { findMany: vi.fn().mockResolvedValue([]) },
        sourcedProduct: { findMany: vi.fn().mockResolvedValue([]) },
        aIEvaluation: { create: vi.fn().mockResolvedValue({}) },
        $transaction: vi.fn().mockImplementation((operations) => Promise.all(operations)),
      };
    }
    const provider = { discover: vi.fn().mockResolvedValue({ candidates: [] }) };

    const scheduled = fakeDatabase(5);
    const skipped = await runProductDiscoveryForProfile({
      profileKey: "traveler", trigger: "scheduled", idempotencyKey: "scheduled:traveler", now: NOW, database: scheduled as never, provider,
    });
    expect(skipped).toMatchObject({ status: "skipped_limit" });
    // Only non-admin searches count toward the limit.
    expect(scheduled.productDiscoveryRun.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ status: "SUCCEEDED", trigger: { not: "admin" } }),
    });

    // Even a limit of 0, which stops every scheduled search, doesn't stop an admin's.
    const admin = fakeDatabase(0);
    const extra = await runProductDiscoveryForProfile({
      profileKey: "traveler", trigger: "admin", idempotencyKey: "admin:traveler:1", now: NOW, database: admin as never, provider,
    });
    expect(extra).toMatchObject({ status: "succeeded" });
    expect(provider.discover).toHaveBeenCalledTimes(1);
    expect(admin.productDiscoveryRun.create).toHaveBeenCalledWith({ data: expect.objectContaining({ trigger: "admin" }) });
    expect(admin.productDiscoveryRun.count).not.toHaveBeenCalled();
    expect(admin.commonsProductProfile.update).not.toHaveBeenCalled();
  });

  it("checks every find against the linked Commons' charter and goals, and keeps a few that miss", async () => {
    function fakeDatabase(coopId: string | null) {
      const matches: Array<Record<string, unknown>> = [];
      let n = 0;
      return {
        matches,
        coopConfig: {
          findFirst: vi.fn().mockResolvedValue({
            charterText: "We buy from Black-owned and local businesses first. No tobacco or alcohol.",
            missionGoals: [
              { key: "health", label: "Better health", description: "Cheaper healthy food for families" },
              { key: "wealth", label: "Keep money local", priorityWeight: 2 },
            ],
          }),
        },
        commonsProductProfile: {
          findUnique: vi.fn().mockResolvedValue({
            id: "profile-family", key: "family", coopId, name: "Family Commons", description: "Household needs",
            searchPrompt: "Find household staples", searchTerms: ["household"], excludedTerms: [], maxCandidatesPerRun: 2,
            monthlyRunLimit: 5, isEnabled: true,
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        productDiscoveryRun: {
          create: vi.fn().mockResolvedValue({ id: "run-1", status: "RUNNING" }),
          count: vi.fn().mockResolvedValue(0),
          update: vi.fn().mockResolvedValue({}),
          findUnique: vi.fn(),
          updateMany: vi.fn(),
        },
        commonsProductMatch: {
          findMany: vi.fn().mockResolvedValue([]),
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockImplementation(({ data }) => {
            matches.push(data);
            return Promise.resolve({});
          }),
        },
        sourcedProduct: {
          findMany: vi.fn().mockResolvedValue([]),
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockImplementation(() => Promise.resolve({ id: `p${++n}`, status: "CANDIDATE" })),
        },
        productPriceObservation: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
        aIEvaluation: { create: vi.fn().mockResolvedValue({}) },
        $transaction: vi.fn().mockImplementation((operations) => Promise.all(operations)),
      };
    }
    const found = (name: string, goalFit: "fits" | "does_not_fit") =>
      candidate({ name, sourceUrl: `https://supplier.example/${name}`, goalFit, goalFitReason: `${name} reason` });
    const results = [
      found("rice", "fits"), found("beans", "fits"), found("oats", "fits"),
      found("cigars", "does_not_fit"), found("wine", "does_not_fit"), found("vape", "does_not_fit"),
    ];

    const linked = fakeDatabase("family-coop");
    const provider = { discover: vi.fn().mockResolvedValue({ candidates: results }) };
    await runProductDiscoveryForProfile({ profileKey: "family", idempotencyKey: "a", now: NOW, database: linked as never, provider });
    // The search gets the charter and goals.
    expect(provider.discover).toHaveBeenCalledWith(expect.objectContaining({
      commons: {
        charter: "We buy from Black-owned and local businesses first. No tobacco or alcohol.",
        goals: [
          { label: "Better health", description: "Cheaper healthy food for families" },
          { label: "Keep money local", description: "" },
        ],
      },
    }));
    // Up to the run's limit of finds that fit, plus up to two that don't, each with its reason.
    expect(linked.matches.map((m) => [m.goalFit, m.goalFitReason])).toEqual([
      ["FITS", "rice reason"], ["FITS", "beans reason"],
      ["DOES_NOT_FIT", "cigars reason"], ["DOES_NOT_FIT", "wine reason"],
    ]);
    expect(linked.matches.every((m) => m.status === "CANDIDATE")).toBe(true);

    // A profile with no Commons has nothing to check, so the bot's verdict is ignored.
    const unlinked = fakeDatabase(null);
    const plain = { discover: vi.fn().mockResolvedValue({ candidates: results }) };
    await runProductDiscoveryForProfile({ profileKey: "family", idempotencyKey: "b", now: NOW, database: unlinked as never, provider: plain });
    expect(plain.discover).toHaveBeenCalledWith(expect.objectContaining({ commons: null }));
    expect(unlinked.coopConfig.findFirst).not.toHaveBeenCalled();
    expect(unlinked.matches.map((m) => m.goalFit)).toEqual([null, null]);
  });

  function simpleDatabase(updates: Array<Record<string, unknown>> = [], observations: Array<Record<string, unknown>> = []) {
    return {
      commonsProductProfile: {
        findUnique: vi.fn().mockResolvedValue({
          id: "p", key: "traveler", coopId: null, name: "Traveler", description: "Travel", searchPrompt: "Find travel gear",
          searchTerms: [], excludedTerms: [], maxCandidatesPerRun: 4, monthlyRunLimit: 5, isEnabled: true,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      productDiscoveryRun: {
        create: vi.fn().mockResolvedValue({ id: "r", status: "RUNNING" }),
        count: vi.fn().mockResolvedValue(0),
        update: vi.fn().mockImplementation(({ data }) => { updates.push(data); return Promise.resolve({}); }),
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
      commonsProductMatch: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
      sourcedProduct: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "n", status: "CANDIDATE" }) },
      productPriceObservation: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(({ data }) => { observations.push(data); return Promise.resolve({}); }),
      },
      aIEvaluation: { create: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn().mockImplementation((operations) => Promise.all(operations)),
    };
  }

  it("never rejects the model's whole answer over one bad field", () => {
    const parsed = ProductDiscoveryOutputSchema.parse({
      candidates: [
        { ...candidate(), memberShare: 64, fitScore: "85", tone: "neon", name: "x".repeat(500) },
        { name: "Half a find", fitScore: "not a number", verifiedFacts: "not a list" },
      ],
    });
    expect(parsed.candidates).toHaveLength(2);
    expect(parsed.candidates[0]).toMatchObject({ memberShare: "64", fitScore: 85, tone: undefined });
    expect(parsed.candidates[1]).toMatchObject({ name: "Half a find", fitScore: undefined, verifiedFacts: undefined });
  });

  it("keeps the finds the bot saved along the way when its final answer is missing", () => {
    const a = candidate({ name: "A", sourceUrl: "https://supplier.example/a" });
    const b = candidate({ name: "B", sourceUrl: "https://supplier.example/b" });
    expect(pickCandidates([a], [b])).toEqual([a]);
    // Saved twice, kept once.
    expect(pickCandidates(undefined, [a, b, a])).toEqual([a, b]);
    expect(pickCandidates([], [b])).toEqual([b]);
  });

  it("drops only the incomplete find and keeps the rest", async () => {
    const updates: Array<Record<string, unknown>> = [];
    const created: Array<Record<string, unknown>> = [];
    const { fitScore: _missing, ...noScore } = candidate({ name: "No score", sourceUrl: "https://supplier.example/no-score" });
    await runProductDiscoveryForProfile({
      profileKey: "traveler", idempotencyKey: "partial", now: NOW, database: simpleDatabase(updates, created) as never,
      provider: { discover: vi.fn().mockResolvedValue({ candidates: [noScore as ProductDiscoveryCandidate, candidate()] }) },
    });
    expect(created).toHaveLength(1);
    const final = updates.find((u) => u.status === "SUCCEEDED")!;
    expect((final.progress as Array<{ text: string }>).map((e) => e.text)).toContain(
      "The bot returned 2 finds, 1 dropped for missing details (a price, link, score or reason). Saving them now.",
    );
  });

  it("trims a wordy find to the stored limits instead of dropping it", async () => {
    const created: Array<Record<string, unknown>> = [];
    const wordy = candidate({ memberShare: "One kit per person, ".repeat(20) });
    await runProductDiscoveryForProfile({
      profileKey: "traveler", idempotencyKey: "w", now: NOW, database: simpleDatabase([], created) as never,
      provider: { discover: vi.fn().mockResolvedValue({ candidates: [wordy] }) },
    });
    expect(created).toHaveLength(1);
    expect((created[0].memberShare as string).length).toBeLessThanOrEqual(120);
  });

  it("logs each step, search, page and find as the run goes, and keeps the log on the finished run", async () => {
    const updates: Array<Record<string, unknown>> = [];
    await runProductDiscoveryForProfile({
      profileKey: "traveler", idempotencyKey: "log", now: NOW, database: simpleDatabase(updates) as never,
      provider: {
        discover: vi.fn().mockImplementation(async ({ onProgress }) => {
          onProgress({ kind: "search", text: "bulk travel bottles wholesale" });
          onProgress({ kind: "page", text: "supplier.example", url: "https://supplier.example/wholesale-bottles" });
          onProgress({ kind: "find", text: "Refillable travel bottle set from Example Supplier" });
          return { candidates: [candidate()] };
        }),
      },
    });
    // Progress is saved while it runs, not only at the end.
    expect(updates.filter((u) => "progress" in u && !("status" in u)).length).toBeGreaterThan(0);
    const final = updates.find((u) => u.status === "SUCCEEDED")!;
    expect((final.progress as Array<{ kind: string; text: string }>).map((e) => `${e.kind}: ${e.text}`)).toEqual([
      "step: Checking ideas other Commons already use",
      "step: Searching the web",
      "search: bulk travel bottles wholesale",
      "page: supplier.example",
      "find: Refillable travel bottle set from Example Supplier",
      "step: The bot returned 1 find. Saving them now.",
      "step: Done. 1 new idea to review.",
    ]);
  });

  it("puts an admin's one-time hint first in the brief and keeps it on the run", async () => {
    const updates: Array<Record<string, unknown>> = [];
    const database = simpleDatabase(updates);
    const provider = { discover: vi.fn().mockResolvedValue({ candidates: [] }) };
    await runProductDiscoveryForProfile({
      profileKey: "traveler", trigger: "admin", idempotencyKey: "hint", hint: "  rolling carry-on bags  ", now: NOW, database: database as never, provider,
    });
    expect(database.productDiscoveryRun.create).toHaveBeenCalledWith({ data: expect.objectContaining({ hint: "rolling carry-on bags" }) });
    expect(provider.discover.mock.calls[0][0].query).toContain('an admin asked you to look for: "rolling carry-on bags"');
    const final = updates.find((u) => u.status === "SUCCEEDED")!;
    expect((final.progress as Array<{ text: string }>).map((e) => e.text)).toContain("Following your hint: rolling carry-on bags");

    expect(buildDiscoveryQuery({ searchPrompt: "Find gear", searchTerms: [], excludedTerms: [], maxCandidatesPerRun: 4 })).not.toContain("admin asked");
  });

  it("reads web searches and page visits from the model's live stream", () => {
    const done = (action: Record<string, unknown>) => ({ type: "response.output_item.done", item: { type: "web_search_call", action } });
    expect(progressFromModelEvent(done({ type: "search", query: "bulk rice wholesale" }))).toEqual({ kind: "search", text: "bulk rice wholesale" });
    expect(progressFromModelEvent(done({ type: "open_page", url: "https://www.webstaurantstore.com/rice" }))).toEqual({
      kind: "page", text: "webstaurantstore.com", url: "https://www.webstaurantstore.com/rice",
    });
    expect(progressFromModelEvent(done({ type: "open_page", url: "javascript:alert(1)" }))).toBeNull();
    expect(progressFromModelEvent({ type: "response.output_text.delta" })).toBeNull();
  });

  it("puts the charter and goals in the bot's brief only when there is a Commons to check", () => {
    const commons = { charter: "Local first.", goals: [{ label: "Keep money local", description: "" }] };
    const input = buildDiscoveryInput({ profile: { name: "Family Commons", description: "Households" }, query: "Find staples", commons, today: NOW });
    expect(input).toContain("Commons goals:\n- Keep money local\nCommons charter:\nLocal first.");
    expect(buildDiscoveryInstructions(4, commons)).toMatch(/up to 2 strong deals you came across that don't fit/);
    expect(buildDiscoveryInput({ profile: { name: "Family Commons", description: "Households" }, query: "Find staples", commons: null, today: NOW })).not.toContain("charter");
    expect(buildDiscoveryInstructions(4, null)).toContain("Leave goalFit and goalFitReason out.");
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
