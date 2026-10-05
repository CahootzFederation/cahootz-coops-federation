/**
 * E2E fixture for the application reference journey
 * (apps/mobile/e2e/onboarding-usability.spec.ts). Not part of the product;
 * only the Playwright spec calls it.
 *
 *   tsx --import ./dotenv.config.js scripts/e2e-application-reference.ts lookup <email>
 *     Prints the reference saved on that applicant's newest application.
 *   tsx --import ./dotenv.config.js scripts/e2e-application-reference.ts cleanup <email>
 *     Deletes the throwaway applicant with their applications and memberships.
 *
 * Prints one JSON line prefixed with "E2E_RESULT ". Only touches throwaway
 * e2e-…@test.cahootz.local accounts, and refuses production.
 */
import { db } from "../../../packages/db/index.js";

const THROWAWAY_EMAIL = /^e2e-[a-z0-9-]+@test\.cahootz\.local$/;

function assertSafeEnvironment() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run the application reference fixture in production");
  }
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? "").hostname;
    } catch {
      return "";
    }
  })();
  if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(host) && process.env.E2E_ALLOW_NONLOCAL_DB !== "1") {
    throw new Error(`Refusing to run the application reference fixture against non-local database host "${host}"`);
  }
}

function assertThrowaway(email: string) {
  if (!THROWAWAY_EMAIL.test(email)) {
    throw new Error(`Only throwaway e2e-…@test.cahootz.local accounts are allowed, not ${email}`);
  }
}

async function lookup(email: string) {
  assertThrowaway(email);
  const application = await db.application.findFirst({
    where: { user: { email } },
    orderBy: { createdAt: "desc" },
    select: { id: true, referenceCode: true },
  });
  return { applicationId: application?.id ?? null, referenceCode: application?.referenceCode ?? null };
}

async function cleanup(email: string) {
  assertThrowaway(email);
  const user = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return { deleted: 0 };
  await db.$transaction([
    db.session.deleteMany({ where: { userId: user.id } }),
    db.loginCode.deleteMany({ where: { email } }),
    db.application.deleteMany({ where: { userId: user.id } }),
    db.userCoopMembership.deleteMany({ where: { userId: user.id } }),
    db.user.deleteMany({ where: { id: user.id } }),
  ]);
  return { deleted: 1 };
}

async function main() {
  assertSafeEnvironment();
  const [command, email] = process.argv.slice(2);
  const result =
    command === "lookup" && email
      ? await lookup(email)
      : command === "cleanup" && email
        ? await cleanup(email)
        : (() => {
            throw new Error("Usage: e2e-application-reference.ts lookup <email> | cleanup <email>");
          })();
  console.log(`E2E_RESULT ${JSON.stringify(result)}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
