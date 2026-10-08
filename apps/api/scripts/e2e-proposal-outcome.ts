/**
 * E2E fixture for the proposal outcome loop (apps/mobile/e2e/proposal-outcome.spec.ts). Not part of
 * the product; only the Playwright spec calls it. Every step after seeding runs the real service code.
 *
 *   seed <runId> <proposerEmail>
 *     Creates an E2E proposal by a seeded test account, open for a council vote, with two KPIs the way
 *     the proposal engine stores them. (The engine is several web-searching model calls, too slow and
 *     costly for every run, so the row is written directly.) Prints the proposal id, title and KPI ids.
 *   fund <proposalId>
 *     Marks the proposal funded and runs startProposalOutcomeTracking, the same call the proposal
 *     router makes on approval. (A council or admin decision needs an on-chain admin role, which a
 *     local test account can't hold.) Prints how many outcome checks started.
 *   due <proposalId>
 *     Moves the proposal's measure dates and outcome checks to now, so the next wake handles them.
 *   wake
 *     Runs one wake cycle for the cahootz Commons with the outcome upkeep step (no model calls).
 *   related <runId> <proposerEmail> <priorProposalId>
 *     Creates a related E2E proposal and attaches what findPriorProposalOutcomes, the lookup the
 *     engine runs during review, finds in Sage's memory. This replays the review with a fixed engine
 *     output instead of a live model. Prints the proposal id and what was found.
 *   cleanup <proposalId...>
 *     Deletes the E2E proposals with their KPIs, outcome checks, memory and notifications.
 *
 * Prints one JSON line prefixed with "E2E_RESULT ". Refuses anything but seeded test accounts and
 * E2E proposals, and refuses production and non-local databases (unless E2E_ALLOW_NONLOCAL_DB=1).
 */
import { db } from "../../../packages/db/index.js";
import {
  findPriorProposalOutcomes, scheduleProposalOutcomeChecks, startProposalOutcomeTracking,
} from "../../../packages/trpc/src/services/proposal-outcomes.js";
import { runSageWakeCycle } from "../../../packages/trpc/src/services/sage-tasks.js";

const TEST_EMAIL_SUFFIX = "@test.cahootz.local";
const PROPOSAL_ID_PREFIX = "prop_e2e_out_";
const COOP_ID = "cahootz";

function assertSafeEnvironment() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to run the proposal outcome fixture in production");
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? "").hostname;
    } catch {
      return "";
    }
  })();
  if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(host) && process.env.E2E_ALLOW_NONLOCAL_DB !== "1") {
    throw new Error(`Refusing to run the proposal outcome fixture against non-local database host "${host}"`);
  }
}

function assertE2EProposalId(proposalId: string) {
  if (!proposalId.startsWith(PROPOSAL_ID_PREFIX)) throw new Error(`Only E2E outcome proposals (${PROPOSAL_ID_PREFIX}…) are allowed, not ${proposalId}`);
}

async function proposer(email: string) {
  if (!email.endsWith(TEST_EMAIL_SUFFIX)) throw new Error("Only seeded test accounts can propose");
  const user = await db.user.findUnique({ where: { email }, select: { walletAddress: true, name: true } });
  if (!user?.walletAddress) throw new Error(`${email} has no wallet`);
  return user;
}

function newId(runId: string) {
  if (!/^[a-z0-9-]+$/i.test(runId)) throw new Error(`Invalid run id ${runId}`);
  return `${PROPOSAL_ID_PREFIX}${runId.replace(/[^a-z0-9]/gi, "").slice(-12)}${Math.random().toString(36).slice(2, 6)}`;
}

async function createProposal(runId: string, email: string, title: string, summary: string, extra: Record<string, unknown> = {}) {
  const author = await proposer(email);
  return db.proposal.create({
    data: {
      id: newId(runId), title, summary, category: "OTHER", proposerWallet: author.walletAddress!, proposerRole: "MEMBER",
      proposerDisplayName: author.name, regionCode: "US", regionName: "United States", budgetCurrency: "USD", budgetAmount: 1200,
      engineVersion: "proposal-engine@2.0.0", status: "VOTABLE", councilRequired: true,
      votingEndsAt: new Date(Date.now() + 7 * 86_400_000), coopId: COOP_ID,
      rawText: `Proposal Title: ${title}\nSummary: ${summary}\nBudget Requested: $1200`, decision: "advance", decisionReasons: [],
      ...extra,
    },
    select: { id: true, title: true, kpis: { select: { id: true, name: true }, orderBy: { name: "asc" } } },
  });
}

async function seed(runId: string, email: string) {
  const proposal = await createProposal(runId, email, `E2E ${runId} Community fridge`, "Stock a shared fridge for neighbors who need food.", {
    kpis: {
      createMany: {
        data: [
          { name: "E2E meals served", target: 500, unit: "COUNT", higherIsBetter: true, measureAfterDays: 30 },
          { name: "E2E volunteers", target: 10, unit: "COUNT", higherIsBetter: true, measureAfterDays: 30 },
        ],
      },
    },
  });
  return { proposalId: proposal.id, title: proposal.title, kpis: proposal.kpis };
}

async function fund(proposalId: string) {
  assertE2EProposalId(proposalId);
  await db.proposal.update({ where: { id: proposalId }, data: { status: "FUNDED" } });
  return startProposalOutcomeTracking(proposalId);
}

async function due(proposalId: string) {
  assertE2EProposalId(proposalId);
  const past = new Date(Date.now() - 60_000);
  const kpis = await db.proposalKPI.findMany({ where: { proposalId }, select: { id: true } });
  await db.proposalKPI.updateMany({ where: { proposalId }, data: { measureBy: past } });
  const tasks = await db.sageTask.updateMany({
    where: { subjectType: "proposal_kpi", subjectId: { in: kpis.map((kpi) => kpi.id) }, status: "OPEN" },
    data: { dueAt: past, nextWakeAt: past, leaseUntil: null },
  });
  return { kpis: kpis.length, tasks: tasks.count };
}

async function wake() {
  const result = await runSageWakeCycle(COOP_ID, "MANUAL", new Date(), (coopId) => scheduleProposalOutcomeChecks(coopId).then(() => undefined));
  return result;
}

async function related(runId: string, email: string, priorProposalId: string) {
  assertE2EProposalId(priorProposalId);
  const title = `E2E ${runId} Second community fridge`;
  const summary = "Stock another community fridge downtown for neighbors who need food.";
  const priorOutcomes = await findPriorProposalOutcomes({ coopId: COOP_ID, about: { title, summary } });
  const proposal = await createProposal(runId, email, title, summary, { priorOutcomes, status: "SUBMITTED", councilRequired: false, votingEndsAt: null });
  return { proposalId: proposal.id, title: proposal.title, priorOutcomes };
}

async function cleanup(proposalIds: string[]) {
  proposalIds.forEach(assertE2EProposalId);
  const kpis = await db.proposalKPI.findMany({ where: { proposalId: { in: proposalIds } }, select: { id: true } });
  const kpiIds = kpis.map((kpi) => kpi.id);
  const taskIds = (await db.sageTask.findMany({ where: { subjectType: "proposal_kpi", subjectId: { in: kpiIds } }, select: { id: true } })).map((task) => task.id);
  await db.sageDecisionTrail.deleteMany({ where: { OR: [{ proposalId: { in: proposalIds } }, { sourceType: "sage_task", sourceId: { in: taskIds } }] } });
  const tasks = await db.sageTask.deleteMany({ where: { id: { in: taskIds } } });
  const memories = await db.aIObservation.deleteMany({ where: { type: "proposal_outcome", sources: { some: { sourceType: "proposal", sourceId: { in: proposalIds } } } } });
  let notifications = 0;
  for (const proposalId of proposalIds) {
    notifications += (await db.notification.deleteMany({ where: { data: { path: ["proposalId"], equals: proposalId } } })).count;
  }
  await db.auditLog.deleteMany({ where: { action: "PROPOSAL_KPI_OUTCOME_REPORTED", resourceId: { in: kpiIds } } });
  const deleted = await db.proposal.deleteMany({ where: { id: { in: proposalIds } } });
  return { deleted: deleted.count, tasks: tasks.count, memories: memories.count, notifications };
}

async function main() {
  assertSafeEnvironment();
  const [command, ...args] = process.argv.slice(2);
  const result =
    command === "seed" && args[0] && args[1] ? await seed(args[0], args[1])
      : command === "fund" && args[0] ? await fund(args[0])
        : command === "due" && args[0] ? await due(args[0])
          : command === "wake" ? await wake()
            : command === "related" && args[0] && args[1] && args[2] ? await related(args[0], args[1], args[2])
              : command === "cleanup" && args.length ? await cleanup(args)
                : (() => {
                    throw new Error("Usage: e2e-proposal-outcome.ts seed <runId> <email> | fund <id> | due <id> | wake | related <runId> <email> <priorId> | cleanup <id...>");
                  })();
  console.log(`E2E_RESULT ${JSON.stringify(result)}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
