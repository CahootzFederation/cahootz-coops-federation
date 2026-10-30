import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/sage-community-memory.js", () => ({ retrieveCommunityInsights: vi.fn(async () => []) }));
vi.mock("../services/sage-community-question.js", () => ({ countQuestionResponders: vi.fn(async () => 6) }));
vi.mock("../lib/bot.js", () => ({ ensureSageBotUser: vi.fn(async () => ({ id: "sage-bot" })) }));

import { retrieveCommunityInsights } from "../services/sage-community-memory.js";
import {
  askCommonsAboutDeals,
  businessDomain,
  countDealInterest,
  DEAL_CATEGORIES,
  dealCategoriesInText,
  dealCategoryForTheme,
  dealQuestionText,
  MAX_REFERRALS_PER_DAY,
  needPostEvidence,
  pickDealQuestion,
  recommendBusiness,
} from "../services/vendor-outreach/index.js";

const NOW = new Date("2026-11-02T05:00:00Z");
const DAY = 86_400_000;

describe("deal categories", () => {
  it("maps need themes and words in posts to deal categories", () => {
    expect(dealCategoryForTheme("food_access")?.key).toBe("groceries");
    expect(dealCategoryForTheme("transportation_access")?.key).toBe("auto_repair");
    expect(dealCategoriesInText("Anyone know where to get diapers cheaper?")).toEqual(["baby_supplies"]);
    expect(dealCategoriesInText("Need a mechanic for my brakes")).toEqual(["auto_repair"]);
    expect(dealCategoriesInText("Looking for a ride to church")).toEqual([]);
  });

  it("never maps health or money needs", () => {
    const themes = DEAL_CATEGORIES.flatMap((category) => category.themes);
    expect(themes).not.toContain("health");
    expect(themes).not.toContain("money");
    expect(dealCategoriesInText("I need help paying rent and my medicine")).toEqual([]);
  });

  it("writes questions with no counts, names or links", () => {
    for (const category of DEAL_CATEGORIES) {
      const text = dealQuestionText(category.key)!;
      expect(text.body).not.toMatch(/\d+ (members|people|households)/);
      expect(text.body).not.toMatch(/https?:|@/);
      expect(text.body).toContain("Nobody pays anything");
    }
  });
});

describe("choosing what to ask", () => {
  const post = (id: string, authorId: string, content: string) => ({ id, authorId, title: "Need", content });

  it("only counts public Need posts raised by at least 3 different members", () => {
    expect(needPostEvidence([post("p1", "a", "rice"), post("p2", "a", "groceries"), post("p3", "b", "produce")])).toEqual([]);
    const [evidence] = needPostEvidence([post("p1", "a", "rice"), post("p2", "b", "groceries"), post("p3", "c", "produce")]);
    expect(evidence).toMatchObject({ kind: "need_posts", categoryKey: "groceries", postCount: 3, authorCount: 3 });
  });

  it("waits a week after any question and 60 days before asking about the same thing", () => {
    const groceries = { kind: "need_posts" as const, categoryKey: "groceries", postCount: 3, authorCount: 3, postIds: [] };
    const baby = { kind: "need_posts" as const, categoryKey: "baby_supplies", postCount: 4, authorCount: 4, postIds: [] };
    expect(pickDealQuestion([groceries], [{ categoryKey: null, createdAt: new Date(NOW.getTime() - 3 * DAY) }], NOW)).toBeNull();
    expect(pickDealQuestion([groceries, baby], [{ categoryKey: "baby_supplies", createdAt: new Date(NOW.getTime() - 30 * DAY) }], NOW)?.categoryKey).toBe("groceries");
    expect(pickDealQuestion([groceries, baby], [], NOW)?.categoryKey).toBe("baby_supplies");
  });

  it("prefers a community pattern over Need posts", () => {
    const posts = { kind: "need_posts" as const, categoryKey: "baby_supplies", postCount: 9, authorCount: 9, postIds: [] };
    const pattern = { kind: "community_pattern" as const, categoryKey: "groceries", observationId: "obs", confidence: 0.6 };
    expect(pickDealQuestion([posts, pattern], [], NOW)?.categoryKey).toBe("groceries");
  });
});

type ItemMatch = { productId: string; name: string; category: string; description?: string; supplierName?: string; price?: Record<string, unknown> | null };

function demandDb(overrides: { members?: number; posts?: Array<Record<string, string>>; items?: ItemMatch[] } = {}) {
  const actions: any[] = [];
  const posts: any[] = [];
  const db: any = {
    actions,
    posts,
    userCoopMembership: { count: vi.fn(async () => overrides.members ?? 12) },
    commonsAction: {
      findMany: vi.fn(async ({ where }: any) =>
        actions.filter((a) => (!where.sourceType || a.sourceType === where.sourceType) && (!where.status?.not || a.status !== where.status.not)),
      ),
      create: vi.fn(async ({ data }: any) => {
        if (actions.some((a) => a.sourceType === data.sourceType && a.sourceId === data.sourceId && a.contentHash === data.contentHash)) {
          throw Object.assign(new Error("dup"), { code: "P2002" });
        }
        const row = { id: `act${actions.length + 1}`, createdAt: NOW, ...data };
        actions.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => Object.assign(actions.find((a) => a.id === where.id), data)),
    },
    commonsActionAudit: { create: vi.fn(async () => ({})) },
    platformConfig: { findMany: vi.fn(async () => []) },
    // Approved product-discovery items for this Commons (none unless a test adds them).
    commonsProductMatch: {
      findMany: vi.fn(async () =>
        (overrides.items ?? []).map((item) => ({
          productId: item.productId,
          product: { id: item.productId, name: item.name, supplierName: item.supplierName ?? "Bulk Co", category: item.category, description: item.description ?? "" },
        })),
      ),
    },
    productPriceObservation: {
      findFirst: vi.fn(async ({ where }: any) => {
        const item = (overrides.items ?? []).find((candidate) => candidate.productId === where.productId);
        if (!item || item.price === null) return null;
        return { memberShare: "64 pods", regularPriceCents: 2889, bulkShareCents: 1217, peopleNeeded: 12, sourceUrl: "https://bulk.example/pods", observedAt: NOW, ...item.price };
      }),
    },
    commonsPost: {
      findMany: vi.fn(async () => overrides.posts ?? []),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `post${posts.length + 1}`, ...data };
        posts.push(row);
        return row;
      }),
    },
  };
  return db;
}

describe("weekly demand check", () => {
  beforeEach(() => vi.mocked(retrieveCommunityInsights).mockResolvedValue([]));
  const needPosts = [
    { id: "p1", authorId: "a", title: "Need", content: "Where can I get rice cheaper?" },
    { id: "p2", authorId: "b", title: "Need", content: "Groceries are so expensive" },
    { id: "p3", authorId: "c", title: "Ask", content: "Anyone splitting a produce box?" },
  ];

  it("posts one fixed question to the whole Commons and nothing more on a rerun", async () => {
    const db = demandDb({ posts: needPosts });
    const first = await askCommonsAboutDeals("church", NOW, db);
    expect(first).toMatchObject({ asked: true, categoryKey: "groceries", evidence: "need_posts" });
    expect(db.posts).toHaveLength(1);
    expect(db.posts[0]).toMatchObject({ circleId: "general:church", authorId: "sage-bot", classification: "sage_deal_interest", title: "A better price on groceries?" });
    expect(db.actions[0]).toMatchObject({ type: "ASK_COMMONS", status: "PUBLISHED", sourcePostId: "post1" });

    const second = await askCommonsAboutDeals("church", NOW, db);
    expect(second.asked).toBe(false);
    expect(db.posts).toHaveLength(1);
  });

  it("asks about a community pattern without exposing it", async () => {
    vi.mocked(retrieveCommunityInsights).mockResolvedValue([{ id: "obs1", themeKey: "childcare_and_care", summary: "x", confidence: 0.7, goalLabels: [] }]);
    const db = demandDb();
    const result = await askCommonsAboutDeals("church", NOW, db);
    expect(result).toMatchObject({ asked: true, categoryKey: "baby_supplies", evidence: "community_pattern" });
    expect(db.actions[0].payload.evidence).toEqual({ kind: "community_pattern" });
    expect(db.actions[0].originObservationId).toBe("obs1");
  });

  it("names an approved item, with its price, when there's no other demand", async () => {
    const db = demandDb({ items: [{ productId: "pods", name: "Laundry pods", category: "Household", description: "Concentrated laundry detergent pods" }] });
    const result = await askCommonsAboutDeals("church", NOW, db);
    expect(result).toMatchObject({ asked: true, categoryKey: "household_essentials", productId: "pods", evidence: "approved_item" });
    expect(db.posts[0].title).toBe("A group deal on Laundry pods?");
    expect(db.posts[0].content).toContain("Laundry pods (64 pods) runs about $28.89 on its own. If 12 of us buy together, it could come to about $16.29 each.");
    expect(db.posts[0].content).toContain("prices we found online");
    expect(db.actions[0].payload).toMatchObject({ dealCategory: "household_essentials", sourcedProductId: "pods", evidence: { kind: "approved_item" } });

    // A week later it doesn't ask about the same item again.
    expect((await askCommonsAboutDeals("church", new Date(NOW.getTime() + 8 * DAY), db)).asked).toBe(false);
  });

  it("names an item in the category members are already asking about", async () => {
    const db = demandDb({
      posts: needPosts,
      items: [
        { productId: "pods", name: "Laundry pods", category: "Household", description: "detergent" },
        { productId: "rice", name: "Jasmine rice, 25 lb", category: "Pantry", description: "rice" },
      ],
    });
    const result = await askCommonsAboutDeals("church", NOW, db);
    expect(result).toMatchObject({ asked: true, categoryKey: "groceries", productId: "rice", evidence: "need_posts" });
    expect(db.posts[0].title).toBe("A group deal on Jasmine rice, 25 lb?");
  });

  it("doesn't ask about an item when card fees would eat most of the savings", async () => {
    const db = demandDb({ items: [{ productId: "bag", name: "Kids lunch bag", category: "School", price: { regularPriceCents: 530, bulkShareCents: 450 } }] });
    expect((await askCommonsAboutDeals("church", NOW, db)).asked).toBe(false);
  });

  it("skips items whose price evidence has run out", async () => {
    const db = demandDb({ items: [{ productId: "pods", name: "Laundry pods", category: "Household", price: null }] });
    expect((await askCommonsAboutDeals("church", NOW, db)).asked).toBe(false);
  });

  it("skips small Commons and Commons with no clear demand", async () => {
    expect((await askCommonsAboutDeals("tiny", NOW, demandDb({ members: 2, posts: needPosts }))).asked).toBe(false);
    expect((await askCommonsAboutDeals("quiet", NOW, demandDb())).asked).toBe(false);
  });

  it("records the public answer count once a question has been up a week", async () => {
    const db = demandDb();
    db.actions.push({ id: "old", sourceType: "deal_interest", status: "PUBLISHED", sourcePostId: "post9", payload: { dealCategory: "groceries" }, createdAt: new Date(NOW.getTime() - 8 * DAY) });
    expect(await countDealInterest("church", NOW, db)).toEqual({ counted: 1 });
    expect(db.actions[0].payload).toMatchObject({ dealCategory: "groceries", interestCount: 6 });
    expect(await countDealInterest("church", NOW, db)).toEqual({ counted: 0 });
  });
});

function referralDb({ member = true, recent = 0 } = {}) {
  const prospects: any[] = [];
  const referrals: any[] = [];
  const db: any = {
    prospects,
    referrals,
    userCoopMembership: { findUnique: vi.fn(async () => (member ? { status: "ACTIVE", roles: ["member"] } : null)) },
    vendorReferral: {
      count: vi.fn(async () => recent),
      findUnique: vi.fn(async ({ where }: any) =>
        referrals.find((r) => r.prospectId === where.prospectId_referredByUserId.prospectId && r.referredByUserId === where.prospectId_referredByUserId.referredByUserId) ?? null,
      ),
      create: vi.fn(async ({ data }: any) => {
        referrals.push(data);
        return data;
      }),
    },
    vendorProspect: {
      findUnique: vi.fn(async ({ where }: any) => prospects.find((p) => p.emailNormalized === where.emailNormalized) ?? null),
      findFirst: vi.fn(async ({ where }: any) => prospects.find((p) => p.domain === where.domain) ?? null),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `vp${prospects.length + 1}`, ...data };
        prospects.push(row);
        return row;
      }),
    },
    auditLog: { create: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (fn: any) => fn(db)),
  };
  return db;
}

describe("recommending a business", () => {
  const input = {
    coopId: "church",
    businessName: "Corner Market",
    category: "groceries",
    website: "https://www.cornermarket.com/about",
    mayNameReferrer: false,
    confirmedPublicContact: true as const,
  };

  it("saves a prospect and the member's referral", async () => {
    const db = referralDb();
    const result = await recommendBusiness(db, "member_1", input, NOW);
    expect(result).toMatchObject({ duplicate: false, alreadyKnown: false });
    expect(db.prospects[0]).toMatchObject({ businessName: "Corner Market", domain: "cornermarket.com", sourceType: "MEMBER_REFERRAL", category: "groceries" });
    expect(db.referrals[0]).toMatchObject({ referredByUserId: "member_1", coopId: "church", mayNameReferrer: false });
  });

  it("adds a second member's referral to the same business instead of a duplicate", async () => {
    const db = referralDb();
    await recommendBusiness(db, "member_1", input, NOW);
    const second = await recommendBusiness(db, "member_2", { ...input, website: "cornermarket.com" }, NOW);
    expect(second).toMatchObject({ alreadyKnown: true, duplicate: false });
    expect(db.prospects).toHaveLength(1);
    expect(db.referrals).toHaveLength(2);
    const again = await recommendBusiness(db, "member_2", input, NOW);
    expect(again.duplicate).toBe(true);
    expect(db.referrals).toHaveLength(2);
  });

  it("needs a way to reach the business and the contact confirmation", async () => {
    const db = referralDb();
    await expect(recommendBusiness(db, "member_1", { ...input, website: undefined }, NOW)).rejects.toThrow(/website, email or phone/);
    await expect(recommendBusiness(db, "member_1", { ...input, confirmedPublicContact: false as any }, NOW)).rejects.toThrow();
  });

  it("only lets members of the Commons recommend, a few times a day", async () => {
    await expect(recommendBusiness(referralDb({ member: false }), "outsider", input, NOW)).rejects.toThrow(/Only members/);
    await expect(recommendBusiness(referralDb({ recent: MAX_REFERRALS_PER_DAY }), "member_1", input, NOW)).rejects.toThrow(/Try again tomorrow/);
  });

  it("doesn't treat free mail providers as a business domain", () => {
    expect(businessDomain(undefined, "owner@gmail.com")).toBeNull();
    expect(businessDomain(undefined, "hello@cornermarket.com")).toBe("cornermarket.com");
  });
});
