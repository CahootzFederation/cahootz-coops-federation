/**
 * E2E fixture for the in-app feedback journey
 * (apps/mobile/e2e/posting-and-feedback.spec.ts). Not part of the product;
 * only the Playwright spec calls it.
 *
 *   tsx --import ./dotenv.config.js scripts/e2e-feedback.ts find <runId>
 *     Prints the saved report whose message contains the run id (category,
 *     message, reporter email) so the spec can confirm what was stored.
 *   tsx --import ./dotenv.config.js scripts/e2e-feedback.ts cleanup <runId>
 *     Deletes reports from seeded test accounts whose message contains the run id.
 *
 * Prints one JSON line prefixed with "E2E_RESULT ". Refuses anything but
 * seeded test accounts and refuses production.
 */
import { db } from "../../../packages/db/index.js";

const TEST_EMAIL_SUFFIX = "@test.cahootz.local";

function assertSafeEnvironment() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to run the feedback fixture in production");
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? "").hostname;
    } catch {
      return "";
    }
  })();
  if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(host) && process.env.E2E_ALLOW_NONLOCAL_DB !== "1") {
    throw new Error(`Refusing to run the feedback fixture against non-local database host "${host}"`);
  }
}

function runReports(runId: string) {
  if (!/^[a-z0-9-]+$/i.test(runId)) throw new Error(`Invalid run id ${runId}`);
  return {
    message: { contains: runId },
    user: { email: { endsWith: TEST_EMAIL_SUFFIX } },
  };
}

async function find(runId: string) {
  const report = await db.appFeedback.findFirst({
    where: runReports(runId),
    orderBy: { createdAt: "desc" },
    select: { category: true, message: true, platform: true, user: { select: { email: true } } },
  });
  return report
    ? { category: report.category, message: report.message, platform: report.platform, email: report.user?.email ?? null }
    : null;
}

async function cleanup(runId: string) {
  const { count } = await db.appFeedback.deleteMany({ where: runReports(runId) });
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
            throw new Error("Usage: e2e-feedback.ts find <runId> | cleanup <runId>");
          })();
  console.log(`E2E_RESULT ${JSON.stringify(result)}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
