/**
 * E2E fixture for the Member Deals and Group Buys journeys
 * (apps/mobile/e2e/member-deals.spec.ts, group-buys.spec.ts). Not part of the
 * product; only the Playwright specs call it.
 *
 *   tsx --import ./dotenv.config.js scripts/e2e-marketplace-offers.ts create '<json>'
 *     Creates one offer in the shared private E2E commons on the E2E second
 *     commons shop's product. JSON: { title, offerType, status, minimumCommitments?, quantityPerMember? }
 *   ... steward <on|off>
 *     Makes User B a steward of the E2E commons (on) or puts them back (off).
 *   ... close-commitments <offerId>
 *     Moves the commitment deadline into the past and runs the real sweep.
 *   ... open-payment <offerId>
 *     Closes commitments early (goal met) and opens payment, as the vendor would.
 *   ... cleanup <titlePrefix>
 *     Removes offers whose title starts with the prefix, with their rows and alerts.
 *
 * Prints one JSON line prefixed with "E2E_RESULT ". Refuses production and non-local databases.
 */
import { db } from "../../../packages/db/index.js";
import {
  closeCommitmentsEarly,
  openPayment,
  runOfferSweep,
} from "../../../packages/trpc/src/services/marketplace-offers/index.js";

const COOP_ID = "e2e-private-shared";
const SHOP_NAME = "E2E Second Commons Shop";
const USER_B_EMAIL = process.env.E2E_USER_B_EMAIL || "releaseclick2@test.cahootz.local";
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
    offerType: "MEMBER_DEAL" | "GROUP_BUY";
    status: "LIVE" | "PENDING_STEWARD";
    minimumCommitments?: number;
    quantityPerMember?: number;
  };
  if (!input.title.startsWith("E2E")) throw new Error("Fixture offer titles must start with E2E");
  const store = await db.store.findFirst({
    where: { name: SHOP_NAME, deletedAt: null },
    include: { products: { where: { isActive: true }, take: 1 } },
  });
  const product = store?.products[0];
  if (!store?.businessId || !product) throw new Error("Run pnpm -F @repo/db seed:e2e-marketplace first");
  const isGroupBuy = input.offerType === "GROUP_BUY";
  const minimum = input.minimumCommitments ?? 3;
  const offer = await db.marketplaceOffer.create({
    data: {
      offerType: input.offerType,
      coopId: COOP_ID,
      storeId: store.id,
      productId: product.id,
      businessId: store.businessId,
      title: input.title,
      description: "E2E fixture offer.",
      regularPriceCents: 2400,
      regularPriceSource: "Posted shelf price",
      memberPriceCents: 1800,
      federationFeeBps: 300,
      commonsFeeBps: 200,
      quantityPerMember: input.quantityPerMember ?? 1,
      minimumCommitments: isGroupBuy ? minimum : null,
      minimumPaidOrders: isGroupBuy ? Math.max(1, minimum - 1) : null,
      maximumQuantity: isGroupBuy ? 20 : null,
      commitmentDeadline: isGroupBuy ? new Date(Date.now() + 3 * DAY) : null,
      expiresAt: isGroupBuy ? null : new Date(Date.now() + 7 * DAY),
      fulfillmentMethod: "PICKUP",
      pickupLocation: "E2E fellowship hall",
      refundPolicy: "Full refund if the group buy doesn't happen.",
      status: input.status,
      publishedAt: input.status === "LIVE" ? new Date() : null,
      createdById: "e2e-fixture",
    },
  });
  return { offerId: offer.id, coopId: COOP_ID };
}

async function steward(mode: string) {
  const user = await db.user.findUnique({ where: { email: USER_B_EMAIL }, select: { id: true } });
  if (!user) throw new Error(`No user ${USER_B_EMAIL}; run seed:test-users first`);
  const roles = mode === "on" ? ["member", "steward"] : ["member"];
  await db.userCoopMembership.update({
    where: { userId_coopId: { userId: user.id, coopId: COOP_ID } },
    data: { roles, status: "ACTIVE" },
  });
  return { roles };
}

async function closeCommitments(offerId: string) {
  await db.marketplaceOffer.update({ where: { id: offerId }, data: { commitmentDeadline: new Date(Date.now() - 1000) } });
  const summary = await runOfferSweep(db);
  const offer = await db.marketplaceOffer.findUniqueOrThrow({ where: { id: offerId }, select: { status: true } });
  return { status: offer.status, summary };
}

async function openPaymentWindow(offerId: string) {
  await closeCommitmentsEarly(db, "e2e-fixture", offerId);
  const { paymentDeadline } = await openPayment(db, "e2e-fixture", offerId);
  return { paymentDeadline };
}

async function cleanup(prefix: string) {
  if (!prefix.startsWith("E2E")) throw new Error("Cleanup prefix must start with E2E");
  const offers = await db.marketplaceOffer.findMany({ where: { title: { startsWith: prefix } }, select: { id: true } });
  const ids = offers.map((offer) => offer.id);
  if (ids.length === 0) return { removed: 0 };
  const notifications = await db.notification.findMany({ where: { coopId: COOP_ID }, select: { id: true, data: true } });
  const alertIds = notifications
    .filter((n) => ids.includes(((n.data ?? {}) as { offerId?: string }).offerId ?? ""))
    .map((n) => n.id);
  await db.notification.deleteMany({ where: { id: { in: alertIds } } });
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
  else if (command === "steward") result = await steward(arg!);
  else if (command === "close-commitments") result = await closeCommitments(arg!);
  else if (command === "open-payment") result = await openPaymentWindow(arg!);
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
