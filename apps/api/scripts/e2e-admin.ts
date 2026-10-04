/**
 * E2E fixture for the platform admin journey (apps/mobile/e2e/admin-commons-ai.spec.ts). Not part of
 * the product; only the Playwright spec calls it.
 *
 *   tsx --import ./dotenv.config.js scripts/e2e-admin.ts login-code <email>
 *     Issues a one-time admin login code for a seeded test admin (an @test.cahootz.local address on
 *     the PLATFORM_ADMIN_EMAILS allowlist), standing in for the email a real admin would receive.
 *     The admin still signs in through the real login page.
 *   tsx --import ./dotenv.config.js scripts/e2e-admin.ts reset-limits <coopId>
 *     Puts the Commons' Sage autonomy limits back to the defaults.
 *
 * Prints one JSON line prefixed with "E2E_RESULT ". Refuses production and non-local databases.
 */
import { randomInt } from "node:crypto";
import { db } from "../../../packages/db/index.js";
import { isPlatformAdminEmail } from "../../../packages/trpc/src/lib/admin-config.js";

function assertSafeEnvironment() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to run the admin fixture in production");
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? "").hostname;
    } catch {
      return "";
    }
  })();
  if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(host) && process.env.E2E_ALLOW_NONLOCAL_DB !== "1") {
    throw new Error(`Refusing to run the admin fixture against non-local database host "${host}"`);
  }
}

async function loginCode(email: string) {
  const normalized = email.trim().toLowerCase();
  if (!/^[a-z0-9_-]+@test\.cahootz\.local$/.test(normalized)) throw new Error("Only seeded test accounts can get a fixture login code");
  if (!isPlatformAdminEmail(normalized)) throw new Error(`${normalized} is not on PLATFORM_ADMIN_EMAILS; add it for local and CI E2E runs`);
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.loginCode.create({ data: { email: normalized, code, expiresAt: new Date(Date.now() + 10 * 60 * 1000) } });
  return { code };
}

async function resetLimits(coopId: string) {
  await db.commonsAgentSetting.updateMany({
    where: { coopId }, data: { autonomyMonthlyUsdLimit: 5, autonomyMonthlyCallLimit: 2000 },
  });
  return { reset: true };
}

async function main() {
  assertSafeEnvironment();
  const [command, first] = process.argv.slice(2);
  const result =
    command === "login-code" && first ? await loginCode(first)
      : command === "reset-limits" && first ? await resetLimits(first)
        : (() => { throw new Error("Usage: e2e-admin.ts login-code <email> | reset-limits <coopId>"); })();
  console.log(`E2E_RESULT ${JSON.stringify(result)}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
