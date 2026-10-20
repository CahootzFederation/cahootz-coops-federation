/**
 * E2E fixture for the @mention scroll journey (apps/mobile/e2e/mention-suggestions-scroll.spec.ts).
 * Not part of the product; only the Playwright spec calls it.
 *
 *   tsx --import ./dotenv.config.js scripts/e2e-mention-members.ts seed <runId>
 *     Adds six throwaway test members to the original Commons, marked as just
 *     active, so the @mention list has more people than fit on screen.
 *   tsx --import ./dotenv.config.js scripts/e2e-mention-members.ts cleanup <runId>
 *     Deletes those members.
 *
 * Prints one JSON line prefixed with "E2E_RESULT ". Only touches its own
 * *@test.cahootz.local accounts and refuses production.
 */
import { db } from "../../../packages/db/index.js";

const COOP_ID = "cahootz";
const MEMBER_COUNT = 6;

function assertSafeEnvironment() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to run the mention members fixture in production");
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? "").hostname;
    } catch {
      return "";
    }
  })();
  if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(host) && process.env.E2E_ALLOW_NONLOCAL_DB !== "1") {
    throw new Error(`Refusing to run the mention members fixture against non-local database host "${host}"`);
  }
}

function runKey(runId: string) {
  const key = runId.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!key) throw new Error("A run id is required");
  return key;
}

function emailFor(key: string, index: number) {
  return `e2emention${key}n${index}@test.cahootz.local`;
}

async function seed(runId: string) {
  const key = runKey(runId);
  const now = new Date();
  const handles: string[] = [];
  for (let index = 1; index <= MEMBER_COUNT; index += 1) {
    const handle = `e2emention${key}n${index}`;
    const user = await db.user.create({
      data: { email: emailFor(key, index), name: `E2E Mention ${index}`, handle, status: "ACTIVE", roles: ["member"] },
    });
    await db.userCoopMembership.create({
      data: { userId: user.id, coopId: COOP_ID, status: "ACTIVE", roles: ["member"], joinedAt: now, lastActiveAt: now },
    });
    handles.push(handle);
  }
  return { handles };
}

async function cleanup(runId: string) {
  const key = runKey(runId);
  const emails = Array.from({ length: MEMBER_COUNT }, (_, i) => emailFor(key, i + 1));
  const users = await db.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
  const userIds = users.map((user) => user.id);
  await db.$transaction([
    db.userCoopMembership.deleteMany({ where: { userId: { in: userIds } } }),
    db.user.deleteMany({ where: { id: { in: userIds } } }),
  ]);
  return { members: userIds.length };
}

async function main() {
  assertSafeEnvironment();
  const [command, runId] = process.argv.slice(2);
  const result =
    command === "seed" && runId
      ? await seed(runId)
      : command === "cleanup" && runId
        ? await cleanup(runId)
        : (() => {
            throw new Error("Usage: e2e-mention-members.ts seed <runId> | cleanup <runId>");
          })();
  console.log(`E2E_RESULT ${JSON.stringify(result)}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
