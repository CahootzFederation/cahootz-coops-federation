/**
 * E2E fixture for the payment receipts journey
 * (apps/mobile/e2e/receipts.spec.ts). Not part of the product; only the
 * Playwright spec calls it.
 *
 *   tsx --import ./dotenv.config.js scripts/e2e-receipts.ts setup <coopId> <runId>
 *     Inserts one COMPLETED store payment from the first fixture account to the
 *     second, dated two days ago, with the note "E2E receipt <runId>" and the
 *     store name "E2E Receipt Store <runId>". No money moves: this is only a
 *     database row, with no blockchain transaction, card charge or Receipt.
 *   tsx --import ./dotenv.config.js scripts/e2e-receipts.ts cleanup <runId>
 *     Deletes the payment(s) that setup created for that run.
 *
 * Prints one JSON line prefixed with "E2E_RESULT ". Only touches payments
 * between the two @test.cahootz.local fixture accounts whose note starts with
 * "E2E receipt ", and refuses production and non-local databases.
 */
import { db } from "../../../packages/db/index.js";

const RUN_ID = /^[a-z0-9]{4,24}$/;
const NOTE_PREFIX = "E2E receipt ";
const STORE_NAME_PREFIX = "E2E Receipt Store ";
const PAYER_EMAIL = process.env.E2E_USER_A_EMAIL || "releaseclick1@test.cahootz.local";
const RECIPIENT_EMAIL = process.env.E2E_USER_B_EMAIL || "releaseclick2@test.cahootz.local";
const TEST_DOMAIN = "@test.cahootz.local";

function assertSafeEnvironment() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run the receipts fixture in production");
  }
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? "").hostname;
    } catch {
      return "";
    }
  })();
  if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(host) && process.env.E2E_ALLOW_NONLOCAL_DB !== "1") {
    throw new Error(`Refusing to run the receipts fixture against non-local database host "${host}"`);
  }
  for (const email of [PAYER_EMAIL, RECIPIENT_EMAIL]) {
    if (!email.endsWith(TEST_DOMAIN)) {
      throw new Error(`Only ${TEST_DOMAIN} fixture accounts are allowed, not ${email}`);
    }
  }
}

function assertRunId(runId: string) {
  if (!RUN_ID.test(runId)) throw new Error(`Unexpected run id ${runId}`);
}

async function fixtureUsers() {
  const [payer, recipient] = await Promise.all([
    db.user.findUnique({ where: { email: PAYER_EMAIL }, select: { id: true, name: true } }),
    db.user.findUnique({ where: { email: RECIPIENT_EMAIL }, select: { id: true, name: true } }),
  ]);
  if (!payer) throw new Error(`Fixture payer ${PAYER_EMAIL} not found`);
  if (!recipient) throw new Error(`Fixture recipient ${RECIPIENT_EMAIL} not found`);
  if (payer.id === recipient.id) throw new Error("The payer and recipient must be different accounts");
  return { payer, recipient };
}

async function setup(coopId: string, runId: string) {
  assertRunId(runId);
  if (!/^[a-z0-9-]{1,64}$/.test(coopId)) throw new Error(`Unexpected commons id ${coopId}`);
  const { payer, recipient } = await fixtureUsers();

  // Two days ago at 2:30 PM local time, so the row isn't "today" in History.
  const createdAt = new Date();
  createdAt.setDate(createdAt.getDate() - 2);
  createdAt.setHours(14, 30, 0, 0);

  const amountUSD = 12.34;
  const transfer = await db.p2PTransfer.create({
    data: {
      senderId: payer.id,
      recipientId: recipient.id,
      coopId,
      amountUSD,
      amountUC: amountUSD,
      fundingSource: "BALANCE",
      status: "COMPLETED",
      transferType: "STORE",
      transferMetadata: { storeName: `${STORE_NAME_PREFIX}${runId}` },
      note: `${NOTE_PREFIX}${runId}`,
      createdAt,
      completedAt: createdAt,
    },
    select: { id: true, amountUSD: true, createdAt: true },
  });

  return {
    id: transfer.id,
    amount: transfer.amountUSD,
    createdAt: transfer.createdAt.toISOString(),
    storeName: `${STORE_NAME_PREFIX}${runId}`,
    note: `${NOTE_PREFIX}${runId}`,
    recipientName: recipient.name,
  };
}

async function cleanup(runId: string) {
  assertRunId(runId);
  const { payer, recipient } = await fixtureUsers();
  const result = await db.p2PTransfer.deleteMany({
    where: {
      senderId: payer.id,
      recipientId: recipient.id,
      note: `${NOTE_PREFIX}${runId}`,
      blockchainTxHash: null,
      receipt: { is: null },
    },
  });
  return { deleted: result.count };
}

async function main() {
  assertSafeEnvironment();
  const [command, first, second] = process.argv.slice(2);
  const result =
    command === "setup" && first && second
      ? await setup(first, second)
      : command === "cleanup" && first
        ? await cleanup(first)
        : (() => {
            throw new Error("Usage: e2e-receipts.ts setup <coopId> <runId> | cleanup <runId>");
          })();
  console.log(`E2E_RESULT ${JSON.stringify(result)}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
