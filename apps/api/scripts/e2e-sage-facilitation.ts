/**
 * E2E fixture for Sage's thread facilitation and pre-vote summary journeys
 * (apps/mobile/e2e/sage-facilitation.spec.ts). Not part of the product; only the Playwright spec
 * calls it. Every command runs the real service code.
 *
 *   tsx --import ./dotenv.config.js scripts/e2e-sage-facilitation.ts revisit-due <postId>
 *     Makes the thread's open revisit task due now and wakes it, as the wake loop would (live model).
 *     Prints the task's status.
 *   tsx --import ./dotenv.config.js scripts/e2e-sage-facilitation.ts claims <postId>
 *     Lists the facilitation triggers code claimed for the thread (kind:commentId).
 *   tsx --import ./dotenv.config.js scripts/e2e-sage-facilitation.ts seed-votable <runId> <proposerEmail>
 *     Creates an E2E proposal that is open for voting and closes in 24 hours.
 *   tsx --import ./dotenv.config.js scripts/e2e-sage-facilitation.ts pre-vote <proposalId>
 *     Runs Sage's pre-vote summary for that proposal now (live model), as the wake step would.
 *   tsx --import ./dotenv.config.js scripts/e2e-sage-facilitation.ts cleanup <postId|-> <proposalId|->
 *     Deletes Sage's actions, tasks, trigger claims and trails for the E2E post and proposal, and the proposal.
 *
 * Prints one JSON line prefixed with "E2E_RESULT ". Refuses anything but E2E content and seeded test
 * accounts, and refuses production.
 */
import { db } from "../../../packages/db/index.js";
import { claimDueTasks, wakeTask } from "../../../packages/trpc/src/services/sage-tasks.js";
import { PRE_VOTE_SOURCE, summarizeBeforeVote } from "../../../packages/trpc/src/services/sage-pre-vote.js";
import { FACILITATION_SCAN_TYPE, THREAD_REVISIT_SUBJECT } from "../../../packages/trpc/src/services/sage-facilitation.js";

const TEST_EMAIL_SUFFIX = "@test.cahootz.local";
const COOP_ID = "cahootz";

function assertSafeEnvironment() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to run the facilitation fixture in production");
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? "").hostname;
    } catch {
      return "";
    }
  })();
  if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(host) && process.env.E2E_ALLOW_NONLOCAL_DB !== "1") {
    throw new Error(`Refusing to run the facilitation fixture against non-local database host "${host}"`);
  }
}

async function assertE2EPost(postId: string) {
  const post = await db.commonsPost.findUnique({ where: { id: postId }, select: { title: true } });
  if (post && !post.title.startsWith("E2E ")) throw new Error("Only E2E posts can be used");
}

async function revisitDue(postId: string) {
  await assertE2EPost(postId);
  const task = await db.sageTask.findFirst({ where: { subjectType: THREAD_REVISIT_SUBJECT, subjectId: postId, status: "OPEN" } });
  if (!task) throw new Error("No open revisit for this post");
  const now = new Date();
  await db.sageTask.update({ where: { id: task.id }, data: { dueAt: now, nextWakeAt: now } });
  const [claimed] = await claimDueTasks({ taskIds: [task.id], now });
  if (!claimed) throw new Error("Could not claim the revisit");
  return { taskId: task.id, result: await wakeTask(claimed, now) };
}

async function claims(postId: string) {
  await assertE2EPost(postId);
  const rows = await db.commonsContentScan.findMany({ where: { sourceType: FACILITATION_SCAN_TYPE, sourceId: postId }, orderBy: { scannedAt: "asc" }, select: { contentHash: true } });
  return { claims: rows.map((row) => row.contentHash) };
}

async function seedVotable(runId: string, proposerEmail: string) {
  if (!/^[a-z0-9-]+$/i.test(runId)) throw new Error(`Invalid run id ${runId}`);
  if (!proposerEmail.endsWith(TEST_EMAIL_SUFFIX)) throw new Error("Only seeded test accounts can propose");
  const proposer = await db.user.findUnique({ where: { email: proposerEmail }, select: { walletAddress: true } });
  if (!proposer?.walletAddress) throw new Error(`${proposerEmail} has no wallet`);
  const title = `E2E ${runId} Community fridge`;
  const proposal = await db.proposal.create({
    data: {
      id: `prop_e2e_${runId.replace(/[^a-z0-9]/gi, "").slice(-12)}`,
      title, summary: "Stock a shared fridge at the community center, open late for families on the block.", category: "OTHER",
      proposerWallet: proposer.walletAddress, proposerRole: "MEMBER", regionCode: "US", regionName: "United States",
      budgetCurrency: "USD", budgetAmount: 1200, engineVersion: "proposal-engine@2.0.0", status: "VOTABLE",
      votingEndsAt: new Date(Date.now() + 24 * 3_600_000), coopId: COOP_ID,
      rawText: `Proposal Title: ${title}\nSummary: Stock a shared fridge at the community center.\nBudget Requested: $1200`,
      decision: "advance", decisionReasons: [], missingData: [{ field: "maintenance", question: "Who restocks the fridge?", severity: "SOFT" }],
    },
    select: { id: true },
  });
  return { proposalId: proposal.id };
}

async function preVote(proposalId: string) {
  if (!proposalId.startsWith("prop_e2e_")) throw new Error("Only E2E proposals");
  return { result: await summarizeBeforeVote(proposalId) };
}

async function cleanup(postId: string, proposalId: string) {
  const result: Record<string, number> = {};
  if (postId !== "-") {
    await assertE2EPost(postId);
    const tasks = await db.sageTask.findMany({ where: { coopId: COOP_ID, postId }, select: { id: true } });
    const actions = await db.commonsAction.findMany({ where: { sourcePostId: postId }, select: { id: true } });
    await db.$transaction([
      db.notification.deleteMany({ where: { OR: [{ data: { path: ["postId"], equals: postId } }, ...tasks.map((task) => ({ data: { path: ["taskId"], equals: task.id } }))] } }),
      db.sageTask.deleteMany({ where: { id: { in: tasks.map((task) => task.id) } } }),
      db.commonsProposalDraft.deleteMany({ where: { actionId: { in: actions.map((action) => action.id) } } }),
      db.commonsAction.deleteMany({ where: { id: { in: actions.map((action) => action.id) } } }),
      db.commonsContentScan.deleteMany({ where: { sourceType: FACILITATION_SCAN_TYPE, sourceId: postId } }),
      db.sageDecisionTrail.deleteMany({ where: { OR: [{ relatedPostIds: { has: postId } }, { sourceType: "sage_task", sourceId: { in: tasks.map((task) => task.id) } }] } }),
    ]);
    result.tasks = tasks.length;
    result.actions = actions.length;
  }
  if (proposalId !== "-") {
    if (!proposalId.startsWith("prop_e2e_")) throw new Error("Only E2E proposals can be deleted");
    await db.$transaction([
      db.commonsAction.deleteMany({ where: { sourceType: PRE_VOTE_SOURCE, sourceId: proposalId } }),
      db.commonsContentScan.deleteMany({ where: { sourceType: PRE_VOTE_SOURCE, sourceId: proposalId } }),
      db.sageDecisionTrail.deleteMany({ where: { proposalId } }),
      db.proposal.deleteMany({ where: { id: proposalId } }),
    ]);
    result.proposals = 1;
  }
  return result;
}

async function main() {
  assertSafeEnvironment();
  const [command, first, second] = process.argv.slice(2);
  const result =
    command === "revisit-due" && first ? await revisitDue(first)
      : command === "claims" && first ? await claims(first)
      : command === "seed-votable" && first && second ? await seedVotable(first, second)
      : command === "pre-vote" && first ? await preVote(first)
      : command === "cleanup" && first && second ? await cleanup(first, second)
      : (() => { throw new Error("Usage: e2e-sage-facilitation.ts revisit-due <postId> | seed-votable <runId> <email> | pre-vote <proposalId> | cleanup <postId|-> <proposalId|->"); })();
  console.log(`E2E_RESULT ${JSON.stringify(result)}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
