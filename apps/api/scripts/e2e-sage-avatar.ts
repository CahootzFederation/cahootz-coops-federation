/**
 * E2E fixture for the Sage avatar journey (apps/mobile/e2e/sage-avatar.spec.ts).
 * Not part of the product; only the Playwright spec calls it.
 *
 *   tsx --import ./dotenv.config.js scripts/e2e-sage-avatar.ts seed
 *     Makes sure the original Commons' Sage account exists (it is otherwise
 *     created lazily, the first time someone posts or mentions Sage) and
 *     prints its user id.
 *   tsx --import ./dotenv.config.js scripts/e2e-sage-avatar.ts cleanup <dmGroupId>
 *     Deletes a test account's direct message with Sage, with its decision
 *     trails and message alerts.
 *
 * Prints one JSON line prefixed with "E2E_RESULT ". Refuses anything but
 * seeded test accounts and refuses production.
 */
import { db } from "../../../packages/db/index.js";
import { ensureSageBotUser } from "../../../packages/trpc/src/lib/bot.js";

const TEST_EMAIL_SUFFIX = "@test.cahootz.local";
const COOP_ID = "cahootz";

function assertSafeEnvironment() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to run the Sage avatar fixture in production");
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? "").hostname;
    } catch {
      return "";
    }
  })();
  if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(host) && process.env.E2E_ALLOW_NONLOCAL_DB !== "1") {
    throw new Error(`Refusing to run the Sage avatar fixture against non-local database host "${host}"`);
  }
}

async function seed() {
  const sage = await ensureSageBotUser(db, COOP_ID);
  return { sageUserId: sage.id };
}

async function cleanup(dmGroupId: string) {
  const group = await db.group.findUnique({
    where: { id: dmGroupId },
    select: { kind: true, members: { select: { user: { select: { email: true, isBot: true } } } } },
  });
  if (!group) return { directMessages: 0 };
  const humans = group.members.filter((member) => !member.user.isBot);
  if (group.kind !== "DIRECT" || !humans.every((member) => member.user.email.endsWith(TEST_EMAIL_SUFFIX))) {
    throw new Error("Only a test account's direct message can be deleted");
  }
  await db.$transaction([
    db.notification.deleteMany({ where: { data: { path: ["groupId"], equals: dmGroupId } } }),
    db.sageDecisionTrail.deleteMany({ where: { circleId: dmGroupId } }),
    db.group.delete({ where: { id: dmGroupId } }),
  ]);
  return { directMessages: 1 };
}

async function main() {
  assertSafeEnvironment();
  const [command, first] = process.argv.slice(2);
  const result =
    command === "seed"
      ? await seed()
      : command === "cleanup" && first
        ? await cleanup(first)
        : (() => {
            throw new Error("Usage: e2e-sage-avatar.ts seed | cleanup <dmGroupId>");
          })();
  console.log(`E2E_RESULT ${JSON.stringify(result)}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
