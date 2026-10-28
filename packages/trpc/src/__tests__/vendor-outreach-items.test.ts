import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/email.js", () => ({ outreachEmailReady: () => false, sendVendorOutreachEmail: vi.fn() }));
vi.mock("../services/slack-notification-service.js", () => ({ sendSlackNotification: vi.fn(async () => true) }));
vi.mock("../services/sage-autonomy.js", () => ({ sageAutonomyAllowed: vi.fn(async () => true) }));

import {
  dealCategoryForItem,
  itemOfferDraft,
  itemQuestionText,
  listCampaignsForAdmin,
  listItemsForAdmin,
  loadReplyPage,
  pickDealItem,
  proposeCampaigns,
  reviewItem,
  startSellerSearch,
  type DealItem,
} from "../services/vendor-outreach/index.js";
import { discoverForCampaign } from "../services/vendor-outreach/discovery.js";
import { buildOutreachEmail, replyToken } from "../services/vendor-outreach/email-builder.js";
import { runOutreachSweep } from "../services/vendor-outreach/outreach-sweep.js";
import { createFakeOutreachDb } from "./fixtures/fake-outreach-db.js";

process.env.SESSION_SECRET = "test-session-secret-for-reply-links";
process.env.WEB_BASE_URL = "https://cahootz.test";

const NOW = new Date("2026-11-03T15:00:00Z");
const DAY = 86_400_000;

function seedItem(db: any, options: { coopId?: string | null; matchStatus?: string; productStatus?: string; expiresAt?: Date | null } = {}) {
  db.tables.commonsProductProfile.push({ id: "profile-family", key: "family", name: "Family", coopId: options.coopId === undefined ? "church" : options.coopId, isEnabled: true });
  db.tables.sourcedProduct.push({
    id: "pods", name: "Laundry pods", description: "Plastic-free laundry detergent pods", category: "Household", brand: "Dropps",
    supplierName: "Dropps", sourceUrl: "https://www.dropps.com/pods", status: options.productStatus ?? "CANDIDATE", imageUrl: null,
  });
  db.tables.commonsProductMatch.push({
    profileId: "profile-family", productId: "pods", status: options.matchStatus ?? "CANDIDATE", fitScore: 90,
    fitReason: "Families buy it every month.", purpose: "Cheaper laundry", displayOrder: 0, createdAt: NOW,
  });
  db.tables.productPriceObservation.push({
    id: "obs1", productId: "pods", sourceUrl: "https://www.dropps.com/pods", comparisonUrl: null, memberShare: "64 pods", peopleNeeded: 12,
    regularPriceCents: 2889, bulkShareCents: 1217, verifiedFacts: ["Public price"], risksOrUnverifiedClaims: ["Shipping not checked"],
    observedAt: NOW, expiresAt: options.expiresAt === undefined ? null : options.expiresAt,
  });
}

describe("discovered items", () => {
  let db: any;
  beforeEach(() => {
    db = createFakeOutreachDb();
    for (const table of ["commonsProductProfile", "sourcedProduct", "commonsProductMatch", "productPriceObservation", "commonsAction", "vendorCampaign", "vendorProspect", "campaignProspect", "outreachMessage", "prospectSource", "auditLog"]) {
      db.tables[table] ??= [];
    }
  });

  it("maps an item to a deal category from its own words, or to everyday goods", () => {
    expect(dealCategoryForItem({ category: "Household", name: "Laundry pods", description: "laundry detergent" })).toBe("household_essentials");
    expect(dealCategoryForItem({ category: "Travel", name: "Packing cubes", description: "Zip cubes for a suitcase" })).toBe("other");
  });

  it("writes the item question from the bot's prices, labeled as what we found online", () => {
    const text = itemQuestionText({
      productId: "pods", name: "Laundry pods", supplierName: "Dropps", memberShare: "64 pods", regularPriceCents: 2889,
      bulkShareCents: 1217, peopleNeeded: 12, sourceUrl: "https://www.dropps.com/pods", observedAt: NOW.toISOString(),
    });
    expect(text.title).toBe("A group buy on Laundry pods?");
    expect(text.body).toContain("about $28.89 on its own");
    expect(text.body).toContain("If 12 of us buy together, it could come to about $12.17 each.");
    expect(text.body).toContain("final price depends on the seller");
    expect(text.body).toContain("Nobody pays anything");
    expect(text.body).not.toMatch(/https?:/);
  });

  it("picks an item that matches the demand, or the best one not asked about lately", () => {
    const item = (productId: string, categoryKey: string) => ({ productId, categoryKey, name: productId }) as DealItem;
    const pods = item("pods", "household_essentials");
    const rice = item("rice", "groceries");
    const cubes = item("cubes", "other");
    const groceryDemand = { kind: "need_posts" as const, categoryKey: "groceries", postCount: 3, authorCount: 3, postIds: [] };
    expect(pickDealItem(groceryDemand, [pods, rice], [], NOW)?.productId).toBe("rice");
    expect(pickDealItem(groceryDemand, [pods], [], NOW)).toBeNull();
    expect(pickDealItem(null, [pods, rice], [], NOW)?.productId).toBe("pods");
    const askedPods = { categoryKey: "household_essentials", productId: "pods", createdAt: new Date(NOW.getTime() - 20 * DAY) };
    expect(pickDealItem(null, [pods, rice], [askedPods], NOW)?.productId).toBe("rice");
    // "Everyday goods" items aren't held back by an earlier everyday-goods question.
    expect(pickDealItem(null, [cubes], [{ categoryKey: "other", productId: "other-item", createdAt: new Date(NOW.getTime() - 20 * DAY) }], NOW)?.productId).toBe("cubes");
  });

  it("lets a platform admin approve an item, which marks it checked", async () => {
    seedItem(db);
    const [row] = await listItemsForAdmin(db, NOW);
    expect(row).toMatchObject({ name: "Laundry pods", coopId: "church", status: "CANDIDATE", categoryKey: "household_essentials" });
    expect(row.price).toMatchObject({ bulkShareCents: 1217, peopleNeeded: 12, risks: ["Shipping not checked"], expired: false });

    await reviewItem(db, "admin", { profileId: "profile-family", productId: "pods", decision: "approve" }, NOW);
    expect(db.tables.commonsProductMatch[0]).toMatchObject({ status: "APPROVED", approvedBy: "admin" });
    expect(db.tables.sourcedProduct[0]).toMatchObject({ status: "VERIFIED", lastVerifiedAt: NOW });
    expect(db.tables.auditLog.at(-1)).toMatchObject({ action: "SOURCED_PRODUCT_APPROVED", resourceId: "pods" });
    await expect(reviewItem(db, "admin", { profileId: "profile-family", productId: "pods", decision: "approve" }, NOW)).rejects.toThrow(/already reviewed/);
  });

  it("won't approve an item with an out-of-date price or one turned down everywhere", async () => {
    seedItem(db, { expiresAt: new Date(NOW.getTime() - DAY) });
    await expect(reviewItem(db, "admin", { profileId: "profile-family", productId: "pods", decision: "approve" }, NOW)).rejects.toThrow(/out of date/);
    await reviewItem(db, "admin", { profileId: "profile-family", productId: "pods", decision: "reject", everywhere: true }, NOW);
    expect(db.tables.commonsProductMatch[0].status).toBe("REJECTED");
    expect(db.tables.sourcedProduct[0].status).toBe("REJECTED");
    expect(await listItemsForAdmin(db, NOW)).toHaveLength(0);
  });

  it("starts a seller search for an approved item, once, and only for a linked Commons", async () => {
    seedItem(db, { matchStatus: "CANDIDATE" });
    const input = { profileId: "profile-family", productId: "pods", area: "Atlanta, GA", maxEmails: 3 };
    await expect(startSellerSearch(db, "admin", input, NOW)).rejects.toThrow(/Approve this item/);
    db.tables.commonsProductMatch[0].status = "APPROVED";

    const { campaignId } = await startSellerSearch(db, "admin", input, NOW);
    const campaign = db.tables.vendorCampaign.find((row: any) => row.id === campaignId);
    expect(campaign).toMatchObject({
      coopId: "church", status: "ACTIVE", offerType: "GROUP_BUY", category: "household_essentials", sourcedProductId: "pods",
      area: "Atlanta, GA", maxEmails: 3, approvedById: "admin", demandEvidence: { source: "discovered_item", interestCount: 0 },
    });
    expect(campaign.expiresAt.getTime() - NOW.getTime()).toBe(30 * DAY);
    expect(campaign.searchTerms).toContain("Laundry pods");
    await expect(startSellerSearch(db, "admin", input, NOW)).rejects.toThrow(/already a seller search/);
    expect((await listCampaignsForAdmin(db))[0].item).toMatchObject({ id: "pods", name: "Laundry pods" });
  });

  it("refuses a seller search for an item whose profile isn't linked to a Commons", async () => {
    seedItem(db, { coopId: null, matchStatus: "APPROVED" });
    await expect(startSellerSearch(db, "admin", { profileId: "profile-family", productId: "pods", area: "Atlanta" }, NOW)).rejects.toThrow(/isn't linked to a Commons/);
  });

  it("turns an answered item question into a Group Buy campaign for that item", async () => {
    seedItem(db, { matchStatus: "APPROVED", productStatus: "VERIFIED" });
    db.tables.commonsAction.push({
      id: "q1", coopId: "church", sourceType: "deal_interest", status: "PUBLISHED", sourcePostId: "post1", createdAt: NOW,
      payload: { dealCategory: "household_essentials", sourcedProductId: "pods", item: { productId: "pods", name: "Laundry pods" }, interestCount: 7, evidence: { kind: "approved_item" } },
    });
    await proposeCampaigns("church", NOW, db);
    expect(db.tables.vendorCampaign[0]).toMatchObject({
      status: "PROPOSED", offerType: "GROUP_BUY", sourcedProductId: "pods", searchTerms: ["Laundry pods", "household essentials"],
      demandEvidence: { interestCount: 7, item: { name: "Laundry pods" } },
    });
  });

  it("asks web research to look for the item, including the supplier's wholesale contact", async () => {
    seedItem(db, { matchStatus: "APPROVED" });
    const { campaignId } = await startSellerSearch(db, "admin", { profileId: "profile-family", productId: "pods", area: "Atlanta, GA" }, NOW);
    db.tables.prospectSource.push({ id: "web", type: "WEB_SEARCH", name: "Web search", status: "ENABLED", config: {} });
    const research = vi.fn(async () => ({ businesses: [], suggestedSources: [] }));
    await discoverForCampaign(db, campaignId, { now: NOW, research, resolveMx: async () => true });
    expect(research).toHaveBeenCalledWith(expect.objectContaining({
      area: "Atlanta, GA",
      // The fake database returns whole rows for a select, so only check the fields research uses.
      item: expect.objectContaining({ name: "Laundry pods", supplierName: "Dropps", sourceUrl: "https://www.dropps.com/pods" }),
    }));
  });

  it("names the item in the email and on the reply page, without a member count it doesn't have", async () => {
    const email = buildOutreachEmail({
      step: "FIRST", businessName: "Corner Market", categoryLabel: "household essentials", itemName: "Laundry pods", area: "Atlanta",
      interestCount: 0, offerType: "GROUP_BUY", replyUrl: "https://x/v/t", unsubscribeUrl: "https://x/v/t?unsubscribe=1", postalAddress: "1 Main St",
    });
    expect(email.subject).toBe("Local households looking for Laundry pods");
    expect(email.text).toContain("Households in a community near Atlanta want to buy Laundry pods together.");
    expect(email.text).not.toMatch(/0 households/);

    seedItem(db, { matchStatus: "APPROVED" });
    const { campaignId } = await startSellerSearch(db, "admin", { profileId: "profile-family", productId: "pods", area: "Atlanta" }, NOW);
    db.tables.vendorProspect.push({ id: "shop", businessName: "Corner Market", email: "owner@corner.test", emailNormalized: "owner@corner.test", status: "FOUND" });
    db.tables.campaignProspect.push({ id: "cp1", campaignId, prospectId: "shop", status: "QUEUED", personalLine: null, replyTokenHash: null, createdAt: NOW });
    db.tables.vendorCampaign[0].discoveredAt = NOW;
    await runOutreachSweep(db, NOW, { ignoreSendingWindow: true, draft: async () => null, resolveMx: async () => true });
    expect(db.tables.outreachMessage[0]).toMatchObject({ status: "DRY_RUN", subject: "Local households looking for Laundry pods" });
    expect((await loadReplyPage(db, replyToken("cp1"))).categoryLabel).toBe("Laundry pods");
  });

  it("fills in a Group Buy draft from the item, with the price source", async () => {
    seedItem(db, { matchStatus: "APPROVED" });
    expect(await itemOfferDraft(db, "pods", NOW)).toEqual({
      sourcedProductId: "pods",
      title: "Laundry pods",
      description: "Plastic-free laundry detergent pods",
      regularPriceCents: 2889,
      memberPriceCents: 1217,
      minimumCommitments: 12,
      memberShare: "64 pods",
      regularPriceSource: "Dropps price on 2026-11-03: https://www.dropps.com/pods",
    });
  });
});
