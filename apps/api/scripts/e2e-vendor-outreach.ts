/**
 * E2E fixture for the vendor outreach journey (apps/mobile/e2e/vendor-outreach.spec.ts).
 * Not part of the product; only the Playwright spec calls it.
 *
 *   tsx --import ./dotenv.config.js scripts/e2e-vendor-outreach.ts setup <runId>
 *     In the shared private E2E commons: records an answered deal question (6 members)
 *     and a member-recommended "E2E <runId> Corner Market" in "E2E Town <runId>", then
 *     runs the real campaign proposal step. Sage proposes a groceries campaign.
 *   ... sweep <runId>
 *     Runs the real outreach sweep for the approved campaign, inside the sending window,
 *     with web search and Cahootz-shop matching off so only the fixture business is found,
 *     and a mail-server lookup that always passes. Email isn't set up in tests, so the
 *     email is saved as a DRY_RUN. Prints the business's reply link token.
 *   ... cleanup <runId>
 *     Deletes the run's question, campaign, business, messages and replies.
 *
 * Prints one JSON line prefixed with "E2E_RESULT ". Refuses production and non-local databases.
 */
import { db } from "../../../packages/db/index.js";
import { proposeCampaigns } from "../../../packages/trpc/src/services/vendor-outreach/campaigns.js";
import { DEAL_INTEREST_SOURCE } from "../../../packages/trpc/src/services/vendor-outreach/demand.js";
import { replyToken } from "../../../packages/trpc/src/services/vendor-outreach/email-builder.js";
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
  const campaign = await db.vendorCampaign.findFirstOrThrow({ where: { coopId: coopFor(runId), area: `E2E Town ${runId}` } });
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
    const row = await db.campaignProspect.findFirstOrThrow({ where: { campaignId: campaign.id, prospect: { emailNormalized: emailFor(runId) } } });
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

async function main() {
  assertSafeTarget();
  const [command, runId] = process.argv.slice(2);
  if (!runId) throw new Error("Usage: e2e-vendor-outreach.ts <setup|sweep|cleanup> <runId>");
  const result = command === "setup" ? await setup(runId) : command === "sweep" ? await sweep(runId) : command === "cleanup" ? await cleanup(runId) : null;
  if (!result) throw new Error(`Unknown command ${command}`);
  console.log(`E2E_RESULT ${JSON.stringify(result)}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
