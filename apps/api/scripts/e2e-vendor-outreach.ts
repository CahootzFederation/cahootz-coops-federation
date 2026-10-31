/**
 * E2E fixture for the vendor outreach journeys (apps/mobile/e2e/vendor-outreach.spec.ts and
 * discovered-items.spec.ts). Not part of the product; only the Playwright specs call it.
 * Each run uses its own commons id (e2e-outreach-<runId>), so parallel journeys don't collide.
 *
 *   tsx --import ./dotenv.config.js scripts/e2e-vendor-outreach.ts setup <runId>
 *     Records an answered deal question (6 members)
 *     and a member-recommended "E2E <runId> Corner Market" in "E2E Town <runId>", then
 *     runs the real campaign proposal step. Sage proposes a groceries campaign.
 *   ... sweep <runId>
 *     Runs the real outreach sweep for the approved campaign, inside the sending window,
 *     with web search and Cahootz-shop matching off so only the fixture business is found,
 *     and a mail-server lookup that always passes. Email isn't set up in tests, so the
 *     email is saved as a DRY_RUN. Prints the business's reply link token.
 *   ... cleanup <runId>
 *     Deletes the run's question, campaign, business, messages and replies.
 *   ... item-setup <runId>
 *     Adds a product-discovery item for the run's commons ("E2E <runId> Laundry pods",
 *     waiting for review, with price evidence) and a member-recommended
 *     "E2E <runId> Soap Shop" in "E2E Town <runId>" that sells household basics.
 *   ... item-search <runId>
 *     Approves the item and starts its seller search near "E2E Town <runId>" (2 emails),
 *     through the same services as the admin's Approve and Find a seller buttons.
 *   ... item-sweep <runId>
 *     Runs the outreach sweep for the item's seller search, as sweep does. Prints the token.
 *   ... item-search-nowhere <runId>
 *     Like item-search, but near "E2E Nowhere <runId>", where no business is.
 *   ... item-sweep-empty <runId>
 *     Runs the sweep for an active seller search that has no sellers in its area (shop
 *     matching and web search off, as above) and prints how the search ended.
 *   ... item-off-goal <runId>
 *     Adds a second item, "E2E <runId> Party cups", that the bot marked as not fitting the
 *     Commons' goals, with its reason.
 *   ... item-discovery-off <runId>
 *     Turns off product search for the run's profile, as if another admin just did.
 *   ... item-discovery-used <runId>
 *     Turns the profile back on with a limit of 1 search a month and records one finished
 *     scheduled search this month that took 1m 35s, found 2 ideas and has a step-by-step log
 *     (so its monthly searches are used up) and, earlier, one extra search an admin started
 *     with the hint "E2E bulk dish soap".
 *   ... item-discovery-live <runId>
 *     Records a search that's running now, 20 seconds in, with one web search in its log.
 *   ... item-discovery-finish <runId>
 *     Finishes that search with 1 new idea.
 *   ... item-cleanup <runId>
 *     Deletes the items, their profile and discovery runs, seller search, draft offer and the business.
 *
 * Prints one JSON line prefixed with "E2E_RESULT ". Refuses production and non-local databases.
 */
import { createHash } from "node:crypto";

import { db } from "../../../packages/db/index.js";
import { proposeCampaigns } from "../../../packages/trpc/src/services/vendor-outreach/campaigns.js";
import { DEAL_INTEREST_SOURCE } from "../../../packages/trpc/src/services/vendor-outreach/demand.js";
import { replyToken } from "../../../packages/trpc/src/services/vendor-outreach/email-builder.js";
import { reviewItem, startSellerSearch } from "../../../packages/trpc/src/services/vendor-outreach/items.js";
import { runOutreachSweep } from "../../../packages/trpc/src/services/vendor-outreach/outreach-sweep.js";

// Each run gets its own commons id, so other journeys that clean up deal questions
// or E2E businesses in the shared commons never touch this run.
const coopFor = (runId: string) => `e2e-outreach-${runId}`;

function assertSafeTarget() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to run the vendor outreach fixture in production");
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? "").hostname;
    } catch {
      return "";
    }
  })();
  if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(host) && process.env.E2E_ALLOW_NONLOCAL_DB !== "1") {
    throw new Error(`Refusing to run the vendor outreach fixture against non-local database host "${host}"`);
  }
}

const emailFor = (runId: string) => `owner-${runId}@e2e-vendor.test`;

async function setup(runId: string) {
  const sage = await db.user.findFirst({ where: { isBot: true }, select: { id: true } });
  const action = await db.commonsAction.create({
    data: {
      coopId: coopFor(runId),
      sourceType: DEAL_INTEREST_SOURCE,
      sourceId: `e2e-${runId}`,
      sourcePostId: `e2e-${runId}`,
      sourceAuthorId: sage?.id ?? "e2e",
      contentHash: "groceries",
      position: 0,
      type: "ASK_COMMONS",
      status: "PUBLISHED",
      summary: `E2E ${runId} deal question`,
      confidence: 0.6,
      charterConfigId: "vendor-demand:e2e",
      payload: { dealCategory: "groceries", title: "A better price on groceries?", interestCount: 6, evidence: { kind: "need_posts", postCount: 3, authorCount: 3 } },
    },
  });
  const email = emailFor(runId);
  await db.vendorProspect.create({
    data: {
      businessName: `E2E ${runId} Corner Market`,
      category: "groceries",
      description: "Family-run grocery with a big bulk aisle.",
      email,
      emailNormalized: email,
      domain: "e2e-vendor.test",
      city: `E2E Town ${runId}`,
      sourceType: "MEMBER_REFERRAL",
    },
  });
  await proposeCampaigns(coopFor(runId), new Date(), db);
  const campaign = await db.vendorCampaign.findUniqueOrThrow({ where: { demandActionId: action.id } });
  return { campaignId: campaign.id, area: `E2E Town ${runId}` };
}

async function sweep(runId: string) {
  return sweepCampaign({ coopId: coopFor(runId), area: `E2E Town ${runId}`, sourcedProductId: null }, emailFor(runId));
}

async function sweepCampaign(where: { coopId: string; area: string; sourcedProductId: string | null }, email: string) {
  const campaign = await db.vendorCampaign.findFirstOrThrow({ where });
  // Only the fixture business: switch shop matching and web search off for this run.
  const toggled = await db.prospectSource.findMany({ where: { type: { in: ["CAHOOTZ_SHOP", "WEB_SEARCH"] }, status: "ENABLED" }, select: { id: true } });
  await db.prospectSource.updateMany({ where: { id: { in: toggled.map((source) => source.id) } }, data: { status: "DISABLED" } });
  try {
    const summary = await runOutreachSweep(db, new Date(), {
      ignoreSendingWindow: true,
      resolveMx: async () => true,
      draft: async () => null,
      research: async () => ({ businesses: [], suggestedSources: [] }),
    });
    const row = await db.campaignProspect.findFirstOrThrow({ where: { campaignId: campaign.id, prospect: { emailNormalized: email } } });
    return { summary, token: replyToken(row.id), status: row.status };
  } finally {
    await db.prospectSource.updateMany({ where: { id: { in: toggled.map((source) => source.id) } }, data: { status: "ENABLED" } });
  }
}

async function cleanup(runId: string) {
  const email = emailFor(runId);
  await db.vendorCampaign.deleteMany({ where: { coopId: coopFor(runId), OR: [{ area: `E2E Town ${runId}` }, { demandActionId: { in: (await db.commonsAction.findMany({ where: { sourceId: `e2e-${runId}` }, select: { id: true } })).map((a) => a.id) } }] } });
  await db.commonsAction.deleteMany({ where: { sourceId: `e2e-${runId}` } });
  await db.vendorProspect.deleteMany({ where: { emailNormalized: email } });
  await db.outreachSuppression.deleteMany({ where: { email } });
  return { cleaned: true };
}

const itemIds = (runId: string) => ({ profileId: `e2e-profile-${runId}`, productId: `e2e-item-${runId}`, sellerEmail: `soap-${runId}@e2e-vendor.test` });

async function itemSetup(runId: string) {
  const { profileId, productId, sellerEmail } = itemIds(runId);
  const sourceUrl = `https://e2e-supplier.test/${runId}/laundry-pods`;
  await db.commonsProductProfile.create({
    data: {
      id: profileId, key: `e2e-${runId}`, coopId: coopFor(runId), name: `E2E ${runId} Families`, description: "E2E profile",
      participantLabel: "households", searchPrompt: "E2E", isEnabled: true,
    },
  });
  await db.sourcedProduct.create({
    data: {
      id: productId, sourceKey: createHash("sha256").update(sourceUrl).digest("hex"), sourceUrl, name: `E2E ${runId} Laundry pods`,
      description: "Plastic-free laundry detergent pods.", category: "Household", brand: "E2E Brand", supplierName: "E2E Supplier",
    },
  });
  await db.commonsProductMatch.create({
    data: {
      profileId, productId, fitScore: 88, fitReason: "Families buy laundry soap every month.", purpose: "Cheaper laundry for every household.",
      goalFit: "FITS", goalFitReason: "Helps the goal of cheaper household basics.",
    },
  });
  await db.productPriceObservation.create({
    data: {
      id: `e2e-price-${runId}`, productId, sourceUrl, memberShare: "64 pods", peopleNeeded: 12, regularPriceCents: 2889, bulkShareCents: 1217,
      verifiedFacts: ["Public price on the supplier's page"], risksOrUnverifiedClaims: ["Shipping cost not checked"], evidenceHash: `e2e-${runId}`,
    },
  });
  await db.vendorProspect.create({
    data: {
      businessName: `E2E ${runId} Soap Shop`, category: "household_essentials", description: "Neighborhood shop with bulk cleaning supplies.",
      email: sellerEmail, emailNormalized: sellerEmail, domain: "e2e-vendor.test", city: `E2E Town ${runId}`, sourceType: "MEMBER_REFERRAL",
    },
  });
  return { profileId, productId, coopId: coopFor(runId) };
}

async function itemSearch(runId: string) {
  const { profileId, productId } = itemIds(runId);
  await reviewItem(db, "e2e-fixture", { profileId, productId, decision: "approve" });
  return startSellerSearch(db, "e2e-fixture", { profileId, productId, area: `E2E Town ${runId}`, maxEmails: 2 });
}

/** Like item-search, but near "E2E Nowhere <runId>", where no business is. */
async function itemSearchNowhere(runId: string) {
  const { profileId, productId } = itemIds(runId);
  await reviewItem(db, "e2e-fixture", { profileId, productId, decision: "approve" });
  return startSellerSearch(db, "e2e-fixture", { profileId, productId, area: `E2E Nowhere ${runId}`, maxEmails: 2 });
}

async function itemSweep(runId: string) {
  const { productId, sellerEmail } = itemIds(runId);
  return sweepCampaign({ coopId: coopFor(runId), area: `E2E Town ${runId}`, sourcedProductId: productId }, sellerEmail);
}

/** Runs the real sweep for a seller search the admin started somewhere with no sellers; reports how it ended. */
async function itemSweepEmpty(runId: string) {
  const { productId } = itemIds(runId);
  const campaign = await db.vendorCampaign.findFirstOrThrow({ where: { coopId: coopFor(runId), sourcedProductId: productId, status: "ACTIVE" } });
  const toggled = await db.prospectSource.findMany({ where: { type: { in: ["CAHOOTZ_SHOP", "WEB_SEARCH"] }, status: "ENABLED" }, select: { id: true } });
  await db.prospectSource.updateMany({ where: { id: { in: toggled.map((source) => source.id) } }, data: { status: "DISABLED" } });
  try {
    await runOutreachSweep(db, new Date(), {
      ignoreSendingWindow: true,
      resolveMx: async () => true,
      draft: async () => null,
      research: async () => ({ businesses: [], suggestedSources: [] }),
    });
  } finally {
    await db.prospectSource.updateMany({ where: { id: { in: toggled.map((source) => source.id) } }, data: { status: "ENABLED" } });
  }
  const ended = await db.vendorCampaign.findUniqueOrThrow({ where: { id: campaign.id }, select: { status: true, endReason: true, area: true } });
  return ended;
}

async function itemOffGoal(runId: string) {
  const { profileId } = itemIds(runId);
  const productId = `e2e-offgoal-${runId}`;
  const sourceUrl = `https://e2e-supplier.test/${runId}/party-cups`;
  await db.sourcedProduct.create({
    data: {
      id: productId, sourceKey: createHash("sha256").update(sourceUrl).digest("hex"), sourceUrl, name: `E2E ${runId} Party cups`,
      description: "Single-use plastic cups by the case.", category: "Party supplies", brand: "E2E Brand", supplierName: "E2E Supplier",
    },
  });
  await db.commonsProductMatch.create({
    data: {
      profileId, productId, fitScore: 60, fitReason: "Families host parties.", purpose: "Cheaper party cups.",
      goalFit: "DOES_NOT_FIT", goalFitReason: "Single-use plastic works against the goal to waste less.",
    },
  });
  await db.productPriceObservation.create({
    data: {
      id: `e2e-offgoal-price-${runId}`, productId, sourceUrl, memberShare: "500 cups", peopleNeeded: 10, regularPriceCents: 4000, bulkShareCents: 2000,
      verifiedFacts: ["Public case price"], risksOrUnverifiedClaims: [], evidenceHash: `e2e-offgoal-${runId}`,
    },
  });
  return { productId };
}

async function itemDiscoveryOff(runId: string) {
  await db.commonsProductProfile.update({ where: { id: itemIds(runId).profileId }, data: { isEnabled: false } });
  return { off: true };
}

async function itemDiscoveryUsed(runId: string) {
  const { profileId } = itemIds(runId);
  await db.commonsProductProfile.update({ where: { id: profileId }, data: { isEnabled: true, monthlyRunLimit: 1 } });
  const now = new Date();
  const started = new Date(now.getTime() - 95_000);
  const earlier = new Date(now.getTime() - 300_000);
  const at = (seconds: number) => new Date(started.getTime() + seconds * 1_000).toISOString();
  await db.productDiscoveryRun.createMany({
    data: [
      {
        profileId, idempotencyKey: `e2e:${runId}:used`, status: "SUCCEEDED", trigger: "scheduled", query: "E2E",
        candidateCount: 2, savedProductCount: 2, savedMatchCount: 2, startedAt: started, finishedAt: now,
        progress: [
          { at: at(0), kind: "step", text: "Searching the web" },
          { at: at(12), kind: "search", text: "E2E bulk laundry pods" },
          { at: at(30), kind: "page", text: "e2e-supplier.test", url: `https://e2e-supplier.test/${runId}/laundry-pods` },
          { at: at(70), kind: "find", text: `E2E ${runId} Laundry pods from E2E Supplier`, url: `https://e2e-supplier.test/${runId}/laundry-pods` },
          { at: at(95), kind: "step", text: "Done. 2 new ideas to review." },
        ],
      },
      { profileId, idempotencyKey: `e2e:${runId}:extra`, status: "SUCCEEDED", trigger: "admin", query: "E2E", hint: "E2E bulk dish soap", startedAt: earlier, finishedAt: earlier },
    ],
  });
  return { used: true };
}

async function itemDiscoveryLive(runId: string) {
  const started = new Date(Date.now() - 20_000);
  await db.productDiscoveryRun.create({
    data: {
      profileId: itemIds(runId).profileId, idempotencyKey: `e2e:${runId}:live`, status: "RUNNING", trigger: "admin", query: "E2E", startedAt: started,
      progress: [
        { at: started.toISOString(), kind: "step", text: "Searching the web" },
        { at: new Date(started.getTime() + 8_000).toISOString(), kind: "search", text: "E2E party supplies wholesale" },
      ],
    },
  });
  return { live: true };
}

async function itemDiscoveryFinish(runId: string) {
  const run = await db.productDiscoveryRun.findUniqueOrThrow({ where: { idempotencyKey: `e2e:${runId}:live` } });
  const progress = Array.isArray(run.progress) ? run.progress : [];
  await db.productDiscoveryRun.update({
    where: { id: run.id },
    data: {
      status: "SUCCEEDED", candidateCount: 1, savedProductCount: 1, savedMatchCount: 1, finishedAt: new Date(),
      progress: [...progress, { at: new Date().toISOString(), kind: "step", text: "Done. 1 new idea to review." }],
    },
  });
  return { finished: true };
}

async function itemCleanup(runId: string) {
  const { profileId, productId, sellerEmail } = itemIds(runId);
  await db.marketplaceOffer.deleteMany({ where: { sourcedProductId: productId, status: "DRAFT" } });
  await db.vendorCampaign.deleteMany({ where: { coopId: coopFor(runId) } });
  await db.commonsAction.deleteMany({ where: { coopId: coopFor(runId) } });
  await db.vendorProspect.deleteMany({ where: { emailNormalized: sellerEmail } });
  await db.outreachSuppression.deleteMany({ where: { email: sellerEmail } });
  await db.sourcedProduct.deleteMany({ where: { id: { in: [productId, `e2e-offgoal-${runId}`] } } });
  await db.commonsProductProfile.deleteMany({ where: { id: profileId } });
  return { cleaned: true };
}

const COMMANDS: Record<string, (runId: string) => Promise<unknown>> = {
  setup, sweep, cleanup, "item-setup": itemSetup, "item-search": itemSearch, "item-sweep": itemSweep, "item-search-nowhere": itemSearchNowhere, "item-sweep-empty": itemSweepEmpty,
  "item-off-goal": itemOffGoal, "item-discovery-off": itemDiscoveryOff,
  "item-discovery-live": itemDiscoveryLive, "item-discovery-finish": itemDiscoveryFinish, "item-discovery-used": itemDiscoveryUsed, "item-cleanup": itemCleanup,
};

async function main() {
  assertSafeTarget();
  const [command, runId] = process.argv.slice(2);
  const run = command ? COMMANDS[command] : undefined;
  if (!runId || !run) throw new Error(`Usage: e2e-vendor-outreach.ts <${Object.keys(COMMANDS).join("|")}> <runId>`);
  const result = await run(runId);
  console.log(`E2E_RESULT ${JSON.stringify(result)}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
