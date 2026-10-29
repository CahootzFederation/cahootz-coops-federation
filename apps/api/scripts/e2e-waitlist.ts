/**
 * E2E fixture for the homepage waitlist journey
 * (apps/mobile/e2e/homepage-waitlist.spec.ts). Not part of the product; only
 * the Playwright spec calls it.
 *
 *   tsx --import ./dotenv.config.js scripts/e2e-waitlist.ts find <runId>
 *     Prints the waitlist signups whose email contains the run id (email,
 *     commons id and notes) so the spec can confirm what was stored.
 *   tsx --import ./dotenv.config.js scripts/e2e-waitlist.ts cleanup <runId>
 *     Deletes those signups.
 *
 * Prints one JSON line prefixed with "E2E_RESULT ". Only touches throwaway
 * e2e-waitlist-*@test.cahootz.local addresses and refuses production.
 */
import { db } from "../../../packages/db/index.js";

function assertSafeEnvironment() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to run the waitlist fixture in production");
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? "").hostname;
    } catch {
      return "";
    }
  })();
  if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(host) && process.env.E2E_ALLOW_NONLOCAL_DB !== "1") {
    throw new Error(`Refusing to run the waitlist fixture against non-local database host "${host}"`);
  }
}

function runSignups(runId: string) {
  if (!/^[a-z0-9-]+$/i.test(runId)) throw new Error(`Invalid run id ${runId}`);
  return {
    AND: [
      { email: { startsWith: "e2e-waitlist-" } },
      { email: { contains: runId } },
      { email: { endsWith: "@test.cahootz.local" } },
    ],
  };
}

async function find(runId: string) {
  return db.waitlistEntry.findMany({
    where: runSignups(runId),
    orderBy: { email: "asc" },
    select: { email: true, coopId: true, notes: true, name: true },
  });
}

async function cleanup(runId: string) {
  const { count } = await db.waitlistEntry.deleteMany({ where: runSignups(runId) });
  return { deleted: count };
}

async function main() {
  assertSafeEnvironment();
  const [command, runId] = process.argv.slice(2);
  const result =
    command === "find" && runId
      ? await find(runId)
      : command === "cleanup" && runId
        ? await cleanup(runId)
        : (() => {
            throw new Error("Usage: e2e-waitlist.ts find <runId> | cleanup <runId>");
          })();
  console.log(`E2E_RESULT ${JSON.stringify(result)}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
