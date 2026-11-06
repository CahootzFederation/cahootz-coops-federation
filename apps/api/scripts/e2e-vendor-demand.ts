/**
 * E2E fixture for the vendor demand journey (apps/mobile/e2e/vendor-demand.spec.ts).
 * Not part of the product; only the Playwright spec calls it.
 *
 *   tsx --import ./dotenv.config.js scripts/e2e-vendor-demand.ts prepare <runId>
 *     In the shared private E2E commons: adds the E2E market admin as a third member
 *     (if they aren't one), writes three public Need posts about groceries from three
 *     members, then runs the real weekly demand check for that commons.
 *   ... rerun
 *     Runs the demand check again (it must not post a second question).
 *   ... cleanup <runId> <addedMember:true|false>
 *     Deletes the run's Need posts, Sage's deal questions in that commons, the run's
 *     business recommendations, and the temporary membership.
 *
 * Prints one JSON line prefixed with "E2E_RESULT ". Refuses production and non-local databases.
 */
import { db } from "../../../packages/db/index.js";
import { askCommonsAboutDeals, DEAL_INTEREST_SOURCE } from "../../../packages/trpc/src/services/vendor-outreach/demand.js";

const COOP_ID = "e2e-private-shared";
const AUTHORS = [
  process.env.E2E_USER_A_EMAIL || "releaseclick1@test.cahootz.local",
  process.env.E2E_USER_B_EMAIL || "releaseclick2@test.cahootz.local",
  "market-admin@test.cahootz.local",
];

function assertSafeTarget() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to run the vendor demand fixture in production");
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? "").hostname;
    } catch {
      return "";
    }
  })();
  if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(host) && process.env.E2E_ALLOW_NONLOCAL_DB !== "1") {
    throw new Error(`Refusing to run the vendor demand fixture against non-local database host "${host}"`);
  }
}

async function clearDealQuestions() {
  const actions = await db.commonsAction.findMany({ where: { coopId: COOP_ID, sourceType: DEAL_INTEREST_SOURCE }, select: { id: true, sourcePostId: true } });
  await db.commonsPost.deleteMany({ where: { id: { in: actions.map((action) => action.sourcePostId) } } });
  await db.commonsActionAudit.deleteMany({ where: { actionId: { in: actions.map((action) => action.id) } } });
  await db.commonsAction.deleteMany({ where: { id: { in: actions.map((action) => action.id) } } });
}

async function prepare(runId: string) {
  // Earlier runs' questions would hold the weekly cooldown; this commons is fixture-only.
  await clearDealQuestions();
  const users = await Promise.all(AUTHORS.map((email) => db.user.findUniqueOrThrow({ where: { email }, select: { id: true } })));
  const third = users[2]!;
  const existing = await db.userCoopMembership.findUnique({ where: { userId_coopId: { userId: third.id, coopId: COOP_ID } } });
  if (!existing) {
    await db.userCoopMembership.create({ data: { userId: third.id, coopId: COOP_ID, status: "ACTIVE", roles: ["member"] } });
  }
  const contents = ["Where can I find rice for less?", "Groceries cost so much lately.", "Anyone want to split a produce box?"];
  for (const [index, user] of users.entries()) {
    await db.commonsPost.create({
      data: { coopId: COOP_ID, circleId: `general:${COOP_ID}`, authorId: user.id, title: `E2E ${runId} need ${index + 1}`, content: contents[index]!, tag: "Need" },
    });
  }
  const result = await askCommonsAboutDeals(COOP_ID, new Date(), db);
  return { addedMember: !existing, result };
}

async function rerun() {
  return { result: await askCommonsAboutDeals(COOP_ID, new Date(), db) };
}

async function cleanup(runId: string, addedMember: string) {
  await db.commonsPost.deleteMany({ where: { coopId: COOP_ID, title: { startsWith: `E2E ${runId}` } } });
  await clearDealQuestions();
  // Only this run's businesses; other journeys add E2E businesses too.
  const prospects = await db.vendorProspect.findMany({ where: { businessName: { startsWith: `E2E ${runId}` } }, select: { id: true } });
  await db.auditLog.deleteMany({ where: { resourceId: { in: prospects.map((prospect) => prospect.id) } } });
  await db.vendorProspect.deleteMany({ where: { id: { in: prospects.map((prospect) => prospect.id) } } });
  if (addedMember === "true") {
    const third = await db.user.findUniqueOrThrow({ where: { email: AUTHORS[2]! }, select: { id: true } });
    await db.userCoopMembership.deleteMany({ where: { userId: third.id, coopId: COOP_ID } });
  }
  return { cleaned: true };
}

async function main() {
  assertSafeTarget();
  const [command, a, b] = process.argv.slice(2);
  let result: unknown;
  if (command === "prepare") result = await prepare(a!);
  else if (command === "rerun") result = await rerun();
  else if (command === "cleanup") result = await cleanup(a!, b ?? "false");
  else throw new Error(`Unknown command ${command}`);
  console.log(`E2E_RESULT ${JSON.stringify(result)}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
