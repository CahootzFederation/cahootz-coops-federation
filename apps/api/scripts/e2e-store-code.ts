/**
 * E2E fixture for the pay-a-store-by-code journey
 * (apps/mobile/e2e/store-code-pay.spec.ts). Not part of the product;
 * only the Playwright spec calls it.
 *
 *   tsx --import ./dotenv.config.js scripts/e2e-store-code.ts setup <coopId> <code>
 *     Creates a throwaway APPROVED quick-pay store named "E2E Quick Pay <code>"
 *     in that commons, owned by the second fixture account (never the payer).
 *   tsx --import ./dotenv.config.js scripts/e2e-store-code.ts cleanup <code>
 *     Deletes the throwaway store(s) with that code.
 *
 * Prints one JSON line prefixed with "E2E_RESULT ". Only touches stores whose
 * code matches E2EQP… and whose name starts with "E2E Quick Pay", and refuses
 * production and non-local databases.
 */
import { db } from "../../../packages/db/index.js";

const THROWAWAY_CODE = /^E2EQP[A-Z0-9]{3,12}$/;
const STORE_NAME_PREFIX = "E2E Quick Pay ";
const OWNER_EMAIL = process.env.E2E_USER_B_EMAIL || "releaseclick2@test.cahootz.local";
const PAYER_EMAIL = process.env.E2E_USER_A_EMAIL || "releaseclick1@test.cahootz.local";

function assertSafeEnvironment() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run the store code fixture in production");
  }
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? "").hostname;
    } catch {
      return "";
    }
  })();
  if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(host) && process.env.E2E_ALLOW_NONLOCAL_DB !== "1") {
    throw new Error(`Refusing to run the store code fixture against non-local database host "${host}"`);
  }
}

function assertThrowawayCode(code: string) {
  if (!THROWAWAY_CODE.test(code)) {
    throw new Error(`Only throwaway E2EQP… store codes are allowed, not ${code}`);
  }
}

async function setup(coopId: string, code: string) {
  assertThrowawayCode(code);
  if (!/^[a-z0-9-]{1,64}$/.test(coopId)) throw new Error(`Unexpected commons id ${coopId}`);

  const owner = await db.user.findUnique({ where: { email: OWNER_EMAIL }, select: { id: true } });
  if (!owner) throw new Error(`Fixture store owner ${OWNER_EMAIL} not found`);
  const payer = await db.user.findUnique({ where: { email: PAYER_EMAIL }, select: { id: true } });
  if (payer?.id === owner.id) throw new Error("The store owner must not be the payer");

  const store = await db.store.create({
    data: {
      ownerId: owner.id,
      coopId,
      name: `${STORE_NAME_PREFIX}${code}`,
      description: "Throwaway store for the E2E pay-by-code journey.",
      shortCode: code,
      acceptsQuickPay: true,
      status: "APPROVED",
    },
    select: { id: true, name: true, shortCode: true, coopId: true },
  });
  return store;
}

async function cleanup(code: string) {
  assertThrowawayCode(code);
  const result = await db.store.deleteMany({
    where: { shortCode: code, name: { startsWith: STORE_NAME_PREFIX } },
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
            throw new Error("Usage: e2e-store-code.ts setup <coopId> <code> | cleanup <code>");
          })();
  console.log(`E2E_RESULT ${JSON.stringify(result)}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
