/**
 * Deterministic fixture for apps/mobile/e2e/sage-community-rhythm.spec.ts. It stands in for the wake
 * cycle's calendar: it seeds records (a Need post by member B that nobody answered, and an event member A
 * hosted yesterday that B went to), then runs the real buildRhythm + publishRhythmPost for a category under
 * a unique E2E period key, so Sage posts in the Commons feed and alerts members who chose "Notify me".
 * Settings, the feed, muting and alerts are exercised through the real app.
 *
 *   tsx --import ./dotenv.config.js scripts/e2e-sage-community-rhythm.ts seed <runId> <emailA> <emailB>
 *   tsx --import ./dotenv.config.js scripts/e2e-sage-community-rhythm.ts publish <runId> <category> <n> <emailA>
 *   tsx --import ./dotenv.config.js scripts/e2e-sage-community-rhythm.ts cleanup <runId> <emailA> <emailB>
 *
 * Prints one JSON line prefixed with "E2E_RESULT ". Refuses production, non-local databases and non-test accounts.
 */
import { db } from "../../../packages/db/index.js";
import { COMMONS_COOP_ID } from "../../../packages/trpc/src/lib/commons.js";
import {
  buildRhythm, isRhythmCategory, publishRhythmPost, RHYTHM_NOTIFICATION_TYPE, RHYTHM_SOURCE,
} from "../../../packages/trpc/src/services/sage-community-rhythm.js";

const HOUR_MS = 3_600_000;

function assertSafeEnvironment(emails: string[]) {
  if (process.env.NODE_ENV === "production") throw new Error("Community rhythm fixture refuses production");
  if (!emails.every((email) => email.endsWith("@test.cahootz.local"))) throw new Error("Community rhythm fixture only accepts local test accounts");
  const host = (() => { try { return new URL(process.env.DATABASE_URL ?? "").hostname; } catch { return ""; } })();
  if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(host) && process.env.E2E_ALLOW_NONLOCAL_DB !== "1") {
    throw new Error(`Refusing non-local database host "${host}"`);
  }
}

async function member(email: string) {
  const user = await db.user.findUnique({ where: { email }, select: { id: true, name: true, handle: true } });
  if (!user) throw new Error(`Test user not found: ${email}`);
  return user;
}

const needTitle = (runId: string) => `E2E ${runId} need a ladder for gutters`;
const eventTitle = (runId: string) => `E2E ${runId} garden workday`;

async function resetSettings(userIds: string[]) {
  await db.sageRhythmPreference.deleteMany({ where: { userId: { in: userIds } } });
  await db.user.updateMany({ where: { id: { in: userIds } }, data: { nameInSageAppreciation: false } });
}

async function cleanup(runId: string, emails: string[]) {
  const users = await Promise.all(emails.map(member));
  const actions = await db.commonsAction.findMany({
    where: { sourceType: RHYTHM_SOURCE, sourceId: { startsWith: `${COMMONS_COOP_ID}:` }, AND: [{ sourceId: { contains: `:e2e-${runId}-` } }] },
    select: { id: true, sourcePostId: true },
  });
  const postIds = actions.map((action) => action.sourcePostId);
  await db.notification.deleteMany({ where: { type: RHYTHM_NOTIFICATION_TYPE, OR: postIds.map((postId) => ({ data: { path: ["postId"], equals: postId } })) } });
  await db.commonsPost.deleteMany({ where: { id: { in: postIds }, author: { isBot: true } } });
  await db.commonsAction.deleteMany({ where: { id: { in: actions.map((action) => action.id) } } });
  // The seeded need and event posts (the event row cascades with its post).
  await db.commonsPost.deleteMany({ where: { coopId: COMMONS_COOP_ID, title: { in: [needTitle(runId), eventTitle(runId)] } } });
  await resetSettings(users.map((user) => user.id));
  return { removed: actions.length };
}

async function seed(runId: string, emailA: string, emailB: string) {
  const [a, b] = await Promise.all([member(emailA), member(emailB)]);
  await resetSettings([a.id, b.id]);
  const now = Date.now();
  const need = await db.commonsPost.create({
    data: {
      coopId: COMMONS_COOP_ID, circleId: `general:${COMMONS_COOP_ID}`, authorId: b.id, tag: "Need",
      title: needTitle(runId), content: `E2E ${runId}: could anyone lend a ladder this weekend?`, createdAt: new Date(now - 72 * HOUR_MS),
    },
    select: { id: true },
  });
  const eventPost = await db.commonsPost.create({
    data: {
      coopId: COMMONS_COOP_ID, circleId: `general:${COMMONS_COOP_ID}`, authorId: a.id, tag: "Event",
      title: eventTitle(runId), content: `E2E ${runId}: bring gloves.`, createdAt: new Date(now - 72 * HOUR_MS),
    },
    select: { id: true },
  });
  await db.event.create({
    data: {
      postId: eventPost.id, coopId: COMMONS_COOP_ID, startAt: new Date(now - 26 * HOUR_MS), endAt: new Date(now - 24 * HOUR_MS),
      isOnline: false, location: "E2E garden", createdById: a.id,
      hosts: { create: { userId: a.id } }, rsvps: { create: { userId: b.id, status: "GOING" } },
    },
  });
  return { coopId: COMMONS_COOP_ID, needPostId: need.id, eventPostId: eventPost.id, nameA: a.name || a.handle, nameB: b.name || b.handle };
}

async function publish(runId: string, category: string, n: string, emailA: string) {
  if (!isRhythmCategory(category)) throw new Error(`Unknown rhythm category: ${category}`);
  const a = await member(emailA);
  const periodKey = `e2e-${runId}-${n}`;
  const need = await db.commonsPost.findFirst({ where: { coopId: COMMONS_COOP_ID, title: needTitle(runId) }, select: { id: true } });
  // Midweek lists only this run's need, so other local data can't push it out of the post.
  const built = await buildRhythm(COMMONS_COOP_ID, category, periodKey, new Date(), { needPostIds: need ? [need.id] : [] });
  const result = await publishRhythmPost(COMMONS_COOP_ID, category, periodKey, built.text, built.extra);
  if (!result.posted) throw new Error(`Sage didn't post: ${result.reason}`);
  const alertForA = await db.notification.findFirst({
    where: { userId: a.id, type: RHYTHM_NOTIFICATION_TYPE, data: { path: ["postId"], equals: result.postId } }, select: { id: true },
  });
  return { postId: result.postId, title: built.text?.title, alertedA: !!alertForA };
}

async function main() {
  const [command, runId, ...rest] = process.argv.slice(2);
  if (!runId) throw new Error("Usage: e2e-sage-community-rhythm.ts seed|publish|cleanup <runId> ...");
  const emails = command === "publish" ? [rest[2]!] : rest;
  assertSafeEnvironment(emails.filter(Boolean));
  const result = command === "seed" ? await seed(runId, rest[0]!, rest[1]!)
    : command === "publish" ? await publish(runId, rest[0]!, rest[1]!, rest[2]!)
    : command === "cleanup" ? await cleanup(runId, rest)
    : null;
  if (!result) throw new Error("Usage: e2e-sage-community-rhythm.ts seed|publish|cleanup <runId> ...");
  console.log(`E2E_RESULT ${JSON.stringify(result)}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
