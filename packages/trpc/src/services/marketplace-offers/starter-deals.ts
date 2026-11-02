import { auditLogEntry } from "../../lib/audit.js";
import type { Db } from "./shared.js";

const DAY = 24 * 60 * 60 * 1000;
const STARTER_ACTOR = "system:starter-deals";

/**
 * The first group deals, open to every Commons. Cahootz does the work, so
 * there's no vendor to pay: after Stripe's fee the money is split between the
 * member's Commons and Cahootz. Each one repeats on its own (see repeats.ts).
 * The id is the first round's, so a deal is only ever posted once here; after
 * that it reposts itself, and cancelling a round stops it for good.
 */
export const STARTER_DEALS = [
  {
    id: "cahootz-tech-help-r1",
    title: "Tech help for your business",
    description:
      "Get hands-on help with the tech side of your business: your email, website, online payments, social media, Google listing, spreadsheets, or a computer that's acting up. Pick how many hours you want. You pay $30 an hour instead of $50.",
    regularPriceSource: "Cahootz's regular hourly rate",
    quantityPerMember: 10,
    redemptionRules: "Once your card is charged, we'll text or email you to book your first session. Sessions are by phone or video call.",
    refundPolicy: "If we can't get your hours scheduled, we'll refund the hours you didn't use.",
    terms: null,
  },
  {
    id: "cahootz-website-r1",
    title: "A free website for your business",
    description: "We build your business a website for free. You just pay $30 a month to keep it online and up to date, instead of $50.",
    regularPriceSource: "Cahootz's regular monthly price",
    quantityPerMember: 1,
    redemptionRules: "Once your card is charged, we'll reach out to learn about your business and start building.",
    refundPolicy: "If we haven't started your website yet, you can get a full refund.",
    terms: "This deal pays for your first month. After that it's $30 a month, and we'll set that up with you directly. You can stop any time.",
  },
] as const;

/** Posts any starter deal that has never been posted. Safe to run on every sweep. */
export async function ensureStarterDeals(db: Db, now = new Date()) {
  const existing = await db.marketplaceOffer.findMany({
    where: { id: { in: STARTER_DEALS.map((deal) => deal.id) } },
    select: { id: true },
  });
  const posted = new Set(existing.map((offer) => offer.id));
  let created = 0;
  for (const deal of STARTER_DEALS) {
    if (posted.has(deal.id)) continue;
    await db.marketplaceOffer.create({
      data: {
        ...deal,
        offerType: "GROUP_BUY",
        coopId: null,
        vendorName: "Cahootz",
        regularPriceCents: 5000,
        memberPriceCents: 3000,
        vendorPayoutCents: 0,
        commonsSplitBps: 5000,
        minimumCommitments: 20,
        minimumPaidOrders: 1,
        commitmentDeadline: new Date(now.getTime() + 30 * DAY),
        paymentWindowHours: 48,
        fulfillmentMethod: "SERVICE",
        status: "LIVE",
        createdById: STARTER_ACTOR,
        publishedAt: now,
        repeats: true,
        roundDays: 30,
      },
    });
    await db.auditLog.create({
      data: auditLogEntry({ actorId: STARTER_ACTOR, action: "MARKETPLACE_OFFER_PUBLISHED", resource: "MarketplaceOffer", resourceId: deal.id }),
    });
    created++;
  }
  return { created };
}
