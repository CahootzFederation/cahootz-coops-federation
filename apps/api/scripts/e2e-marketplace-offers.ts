/**
 * E2E fixture for the Group Buys journeys
 * (apps/mobile/e2e/group-buy-admin.spec.ts, group-buys.spec.ts). Not part of the
 * product; only the Playwright specs call it.
 *
 *   tsx --import ./dotenv.config.js scripts/e2e-marketplace-offers.ts create '<json>'
 *     Creates one offer in the shared private E2E commons from the vendor "E2E Corner
 *     Market" (vendors never sign up). JSON: { title, status, minimumCommitments?, quantityPerMember?,
 *     everyCommons?, service?, repeats? }. status is DRAFT (a platform admin publishes it in the
 *     web admin) or LIVE. everyCommons opens it to every Commons, service means nothing ships
 *     (no address), and repeats posts a fresh copy when it hits its goal or ends short.
 *   ... digest
 *     Sends this week's group buys notice for the E2E commons, as Monday's job does.
 *     Clears the commons' claim rows first, so it sends even if it already ran this week.
 *   ... close-commitments <offerId>
 *     Moves the commitment deadline into the past and runs the real sweep.
 *   ... sweep
 *     Runs the real 15-minute sweep once (closes repeating deals that hit their goal).
 *   ... close-early <offerId>
 *     Closes commitments early (goal met) and charges every saved card, as an admin would.
 *   ... save-card <email>
 *     Gives a test member a saved card, as if they added one with Stripe. It's a stand-in
 *     with no Stripe customer, so charging it fails the way a declined card does.
 *   ... card-reset <email>
 *     Removes a test member's saved cards and delivery address.
 *   ... orders <offerId>
 *     Prints each order's status and delivery address.
 *   ... cleanup <titlePrefix>
 *     Removes offers whose title starts with the prefix, with their rows and alerts.
 *
 * Prints one JSON line prefixed with "E2E_RESULT ". Refuses production and non-local databases.
 */
import { db } from "../../../packages/db/index.js";
import {
  closeCommitmentsEarly,
  runOfferSweep,
  sendWeeklyDealsDigest,
} from "../../../packages/trpc/src/services/marketplace-offers/index.js";

const COOP_ID = "e2e-private-shared";
const VENDOR_NAME = "E2E Corner Market";
const DAY = 24 * 60 * 60 * 1000;

function assertSafeTarget() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to run the offers fixture in production");
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? "").hostname;
    } catch {
      return "";
    }
  })();
  if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(host) && process.env.E2E_ALLOW_NONLOCAL_DB !== "1") {
    throw new Error(`Refusing to run the offers fixture against non-local database host "${host}"`);
  }
}

async function create(raw: string) {
  const input = JSON.parse(raw) as {
    title: string;
    status: "LIVE" | "DRAFT";
    minimumCommitments?: number;
    quantityPerMember?: number;
    everyCommons?: boolean;
    service?: boolean;
    repeats?: boolean;
  };
  if (!input.title.startsWith("E2E")) throw new Error("Fixture offer titles must start with E2E");
  const minimum = input.minimumCommitments ?? 3;
  const offer = await db.marketplaceOffer.create({
    data: {
      offerType: "GROUP_BUY",
      coopId: input.everyCommons ? null : COOP_ID,
      vendorName: VENDOR_NAME,
      vendorEmail: "orders@e2e-corner-market.test",
      title: input.title,
      description: "E2E fixture offer.",
      regularPriceCents: 2400,
      regularPriceSource: "Posted shelf price",
      memberPriceCents: 1800,
      vendorPayoutCents: 1500,
      commonsSplitBps: 5000,
      quantityPerMember: input.quantityPerMember ?? 1,
      minimumCommitments: minimum,
      minimumPaidOrders: Math.max(1, minimum - 1),
      maximumQuantity: 20,
      commitmentDeadline: new Date(Date.now() + 3 * DAY),
      fulfillmentMethod: input.service ? "SERVICE" : "DELIVERY",
      repeats: input.repeats ?? false,
      roundDays: input.repeats ? 30 : null,
      refundPolicy: "Full refund if the group buy doesn't happen.",
      status: input.status,
      publishedAt: input.status === "LIVE" ? new Date() : null,
      createdById: "e2e-fixture",
    },
  });
  return { offerId: offer.id, coopId: COOP_ID };
}

async function digest() {
  await db.offerDigestSend.deleteMany({ where: { coopId: COOP_ID } });
  return sendWeeklyDealsDigest(db, new Date(), { coopIds: [COOP_ID] });
}

async function closeCommitments(offerId: string) {
  await db.marketplaceOffer.update({ where: { id: offerId }, data: { commitmentDeadline: new Date(Date.now() - 1000) } });
  const summary = await runOfferSweep(db);
  const offer = await db.marketplaceOffer.findUniqueOrThrow({ where: { id: offerId }, select: { status: true } });
  return { status: offer.status, summary };
}

async function closeEarly(offerId: string) {
  const charges = await closeCommitmentsEarly(db, "e2e-fixture", offerId);
  const offer = await db.marketplaceOffer.findUniqueOrThrow({ where: { id: offerId }, select: { status: true } });
  return { status: offer.status, charges };
}

async function testMember(email: string) {
  if (!email.endsWith("@test.cahootz.local")) throw new Error("Only test.cahootz.local members");
  return db.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
}

async function saveCard(email: string) {
  const user = await testMember(email);
  await db.paymentMethod.updateMany({ where: { userId: user.id }, data: { isDefault: false } });
  await db.paymentMethod.upsert({
    where: { stripePaymentMethodId: `pm_e2e_${user.id}` },
    create: { userId: user.id, stripePaymentMethodId: `pm_e2e_${user.id}`, type: "card", brand: "visa", last4: "4242", expiryMonth: 12, expiryYear: 2034, isDefault: true },
    update: { isDefault: true },
  });
  return { userId: user.id };
}

async function cardReset(email: string) {
  const user = await testMember(email);
  const cards = await db.paymentMethod.deleteMany({ where: { userId: user.id } });
  const addresses = await db.userShippingAddress.deleteMany({ where: { userId: user.id } });
  return { cards: cards.count, addresses: addresses.count };
}

async function orders(offerId: string) {
  const rows = await db.offerCommitment.findMany({
    where: { offerId },
    select: { status: true, quantity: true, shippingAddress: true, chargeError: true, user: { select: { email: true } } },
  });
  return rows.map(({ user, ...row }) => ({ email: user.email, ...row }));
}

async function cleanup(prefix: string) {
  if (!prefix.startsWith("E2E")) throw new Error("Cleanup prefix must start with E2E");
  const offers = await db.marketplaceOffer.findMany({ where: { title: { startsWith: prefix } }, select: { id: true } });
  const ids = offers.map((offer) => offer.id);
  if (ids.length === 0) return { removed: 0 };
  // An every-Commons offer's alerts go to each member's own Commons, so match on the offer, not the Commons.
  const notifications = await db.notification.findMany({
    where: { OR: ids.map((id) => ({ data: { path: ["offerId"], equals: id } })) },
    select: { id: true },
  });
  const alertIds = notifications.map((n) => n.id);
  await db.notification.deleteMany({ where: { id: { in: alertIds } } });
  // Weekly deals notices that listed this run's offers.
  await db.notification.deleteMany({ where: { coopId: COOP_ID, type: "OFFER_WEEKLY_DIGEST", body: { contains: prefix } } });
  await db.auditLog.deleteMany({ where: { resourceId: { in: ids } } });
  await db.commerceTransaction.updateMany({ where: { offerId: { in: ids } }, data: { offerId: null } });
  await db.marketplaceOffer.deleteMany({ where: { id: { in: ids } } });
  return { removed: ids.length, alerts: alertIds.length };
}

async function main() {
  assertSafeTarget();
  const [command, arg] = process.argv.slice(2);
  let result: unknown;
  if (command === "create") result = await create(arg!);
  else if (command === "digest") result = await digest();
  else if (command === "close-commitments") result = await closeCommitments(arg!);
  else if (command === "close-early") result = await closeEarly(arg!);
  else if (command === "sweep") result = await runOfferSweep(db);
  else if (command === "save-card") result = await saveCard(arg!);
  else if (command === "card-reset") result = await cardReset(arg!);
  else if (command === "orders") result = await orders(arg!);
  else if (command === "cleanup") result = await cleanup(arg!);
  else throw new Error(`Unknown command ${command}`);
  console.log(`E2E_RESULT ${JSON.stringify(result)}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
