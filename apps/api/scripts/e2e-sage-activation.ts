/**
 * Deterministic fixture for apps/mobile/e2e/sage-activation.spec.ts: Sage's new-member activation journey.
 * The journey needs a member with no history (any post, reply or RSVP since joining counts as activated),
 * so it uses a throwaway member instead of the shared fixture accounts. Each command moves the member's
 * join date to the point a real day would reach, then runs the real sweep or wake handler.
 *
 *   create <email> <runId>                 throwaway member of Cahootz, joined 2 hours ago, with a unique skill; runs the sweep (welcome)
 *   contribute <email> <helperEmail> <runId>  the helper posts a matching Need; the member is now 7 days in; runs the sweep
 *   check <email> [days]                   moves the member <days> (default 14) in and wakes the journey's task
 *   cleanup <email> <runId>                removes the member, everything Sage made for them, and the run's posts
 *
 * Prints one JSON line prefixed with "E2E_RESULT ". Refuses production and non-local databases.
 */
if (process.env.E2E_DATABASE_URL_OVERRIDE) {
  process.env.DATABASE_URL = process.env.E2E_DATABASE_URL_OVERRIDE;
}
const { db } = await import("../../../packages/db/index.js");
const { ensureSageBotUser } = await import("../../../packages/trpc/src/lib/bot.js");
const { directKeyFor } = await import("../../../packages/trpc/src/services/direct-circles.js");
const { activationStats, commonsLanguage, ensureActivationTask, runActivationSweep } =
  await import("../../../packages/trpc/src/services/sage-activation.js");
const { claimDueTasks, wakeTask } = await import("../../../packages/trpc/src/services/sage-tasks.js");

const COOP_ID = "cahootz";
const THROWAWAY_EMAIL = /^e2eactivation[a-z0-9]+@test\.cahootz\.local$/;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

function assertSafeEnvironment(emails: string[]) {
  if (process.env.NODE_ENV === "production" || emails.some((email) => !email.endsWith("@test.cahootz.local"))) {
    throw new Error("The activation fixture only accepts local test accounts");
  }
  const host = (() => { try { return new URL(process.env.DATABASE_URL ?? "").hostname; } catch { return ""; } })();
  if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(host) && process.env.E2E_ALLOW_NONLOCAL_DB !== "1") {
    throw new Error(`Refusing non-local database host "${host}"`);
  }
}

function assertThrowaway(email: string) {
  if (!THROWAWAY_EMAIL.test(email)) throw new Error(`Unsafe fixture email: ${email}`);
}

/** A word unique to this run, so profile matching only finds this run's Need post. */
const skillWord = (runId: string) => `zq${runId.replace(/[^a-z0-9]/gi, "").slice(-8).toLowerCase()}mend`;

async function member(email: string) {
  assertThrowaway(email);
  const user = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) throw new Error(`No throwaway member ${email}`);
  return user;
}

async function setJoined(userId: string, joinedAt: Date) {
  await db.userCoopMembership.update({ where: { userId_coopId: { userId, coopId: COOP_ID } }, data: { joinedAt } });
}

async function create(email: string, runId: string) {
  assertThrowaway(email);
  const now = new Date();
  const joinedAt = new Date(now.getTime() - 2 * HOUR_MS);
  const handle = email.split("@")[0]!.replace(/[^a-z0-9]/g, "");
  const user = await db.user.create({
    data: { email, name: "E2E Activation Member", handle, status: "ACTIVE", roles: ["member"], skills: [skillWord(runId)] },
    select: { id: true },
  });
  await db.userCoopMembership.create({
    data: { userId: user.id, coopId: COOP_ID, status: "ACTIVE", roles: ["member"], joinedAt, lastActiveAt: joinedAt },
  });
  const summary = await runActivationSweep({ now, userIds: [user.id], coopId: COOP_ID });
  const { name } = await commonsLanguage(COOP_ID);
  return { userId: user.id, commonsName: name, summary };
}

async function contribute(email: string, helperEmail: string, runId: string) {
  const user = await member(email);
  const helper = await db.user.findUnique({ where: { email: helperEmail }, select: { id: true } });
  if (!helper) throw new Error(`Test user not found: ${helperEmail}`);
  const word = skillWord(runId);
  const post = await db.commonsPost.create({
    data: {
      coopId: COOP_ID, circleId: `general:${COOP_ID}`, authorId: helper.id, tag: "Need",
      title: `E2E ${runId} need help with ${word}`, content: `E2E ${runId}: Is anyone able to help with ${word} this week?`,
    },
    select: { id: true, title: true },
  });
  const now = new Date();
  await setJoined(user.id, new Date(now.getTime() - 7 * DAY_MS - HOUR_MS));
  const summary = await runActivationSweep({ now, userIds: [user.id], coopId: COOP_ID });
  return { postId: post.id, title: post.title, summary };
}

async function check(email: string, days: number) {
  const user = await member(email);
  const now = new Date();
  const joinedAt = new Date(now.getTime() - days * DAY_MS - HOUR_MS);
  await setJoined(user.id, joinedAt);
  const { name } = await commonsLanguage(COOP_ID);
  const taskId = await ensureActivationTask({ coopId: COOP_ID, userId: user.id, joinedAt, commonsName: name, now });
  await db.sageTask.update({ where: { id: taskId }, data: { nextWakeAt: new Date(now.getTime() - 60_000) } });
  const [claimed] = await claimDueTasks({ taskIds: [taskId], now });
  if (!claimed) throw new Error("Could not claim the activation task");
  const woke = await wakeTask(claimed, now);
  const task = await db.sageTask.findUnique({ where: { id: taskId }, select: { status: true, outcome: true } });
  return { woke, task, stats: await activationStats(COOP_ID) };
}

async function cleanup(email: string, runId: string) {
  assertThrowaway(email);
  const user = await db.user.findUnique({ where: { email }, select: { id: true } });
  const posts = await db.commonsPost.findMany({ where: { coopId: COOP_ID, title: { contains: `E2E ${runId}` } }, select: { id: true } });
  const postIds = posts.map((post) => post.id);
  const result: Record<string, number> = {
    comments: (await db.commonsComment.deleteMany({ where: { postId: { in: postIds } } })).count,
    posts: (await db.commonsPost.deleteMany({ where: { id: { in: postIds } } })).count,
  };
  if (!user) return result;
  const sage = await ensureSageBotUser(db, COOP_ID);
  const conversation = await db.group.findUnique({ where: { directKey: directKeyFor(COOP_ID, sage.id, user.id) }, select: { id: true } });
  const tasks = await db.sageTask.findMany({ where: { ownerUserId: user.id }, select: { id: true } });
  const taskIds = tasks.map((task) => task.id);
  const actions = await db.commonsAction.findMany({ where: { participants: { some: { userId: user.id } } }, select: { id: true } });
  Object.assign(result, {
    trails: (await db.sageDecisionTrail.deleteMany({ where: { sourceType: "sage_task", sourceId: { in: taskIds } } })).count,
    tasks: (await db.sageTask.deleteMany({ where: { id: { in: taskIds } } })).count,
    actions: (await db.commonsAction.deleteMany({ where: { id: { in: actions.map((action) => action.id) } } })).count,
    audits: (await db.auditLog.deleteMany({ where: { OR: [{ resourceId: { in: [user.id, ...taskIds, ...postIds] } }, { actorId: user.id }] } })).count,
    observations: (await db.aIObservation.deleteMany({ where: { scopeType: "member", scopeId: user.id } })).count,
    sends: (await db.onboardingDripSend.deleteMany({ where: { userId: user.id } })).count,
    conversation: conversation ? (await db.group.deleteMany({ where: { id: conversation.id } })).count : 0,
  });
  await db.$transaction([
    db.groupMember.deleteMany({ where: { userId: user.id } }),
    db.wallet.deleteMany({ where: { userId: user.id } }),
    db.session.deleteMany({ where: { userId: user.id } }),
    db.loginCode.deleteMany({ where: { email } }),
    db.notification.deleteMany({ where: { userId: user.id } }),
    db.userCoopMembership.deleteMany({ where: { userId: user.id } }),
    db.user.deleteMany({ where: { id: user.id } }),
  ]);
  return { ...result, member: 1 };
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  assertSafeEnvironment(args.filter((arg) => arg.includes("@")));
  const [first, second, third] = args;
  const result =
    command === "create" && first && second ? await create(first, second)
      : command === "contribute" && first && second && third ? await contribute(first, second, third)
        : command === "check" && first ? await check(first, Number(second ?? 14))
          : command === "cleanup" && first && second ? await cleanup(first, second)
            : (() => { throw new Error(`Unknown or incomplete command: ${command}`); })();
  console.log(`E2E_RESULT ${JSON.stringify(result)}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
