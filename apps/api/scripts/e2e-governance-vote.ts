/**
 * E2E fixture for the governance confirmation journeys
 * (apps/mobile/e2e/governance-confirmations.spec.ts). Not part of the
 * product; only the Playwright spec calls it.
 *
 *   tsx --import ./dotenv.config.js scripts/e2e-governance-vote.ts seed <runId> <proposerEmail> [coopId] [votingEndsAt]
 *     Creates an E2E proposal by a seeded test account that is open for a
 *     council vote (status VOTABLE, councilRequired, AI decision "advance").
 *     Voting closes in 7 days unless an ISO `votingEndsAt` is given (a past
 *     date seeds a proposal whose voting has closed).
 *     The full proposal engine is several web-searching model calls, too slow
 *     and costly for every run, so the fixture writes the row directly.
 *     Prints the proposal id and title.
 *   tsx --import ./dotenv.config.js scripts/e2e-governance-vote.ts status <proposalId>
 *     Prints the proposal's status and how many votes it has.
 *   tsx --import ./dotenv.config.js scripts/e2e-governance-vote.ts cleanup <proposalId...>
 *     Deletes the E2E proposals with their votes, comments and reactions.
 *
 * Prints one JSON line prefixed with "E2E_RESULT ". Refuses anything but
 * seeded test accounts and E2E proposals, and refuses production and
 * non-local databases (unless E2E_ALLOW_NONLOCAL_DB=1).
 */
import { db } from "../../../packages/db/index.js";

const TEST_EMAIL_SUFFIX = "@test.cahootz.local";
const PROPOSAL_ID_PREFIX = "prop_e2e_gov_";

function assertSafeEnvironment() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run the governance vote fixture in production");
  }
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? "").hostname;
    } catch {
      return "";
    }
  })();
  if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(host) && process.env.E2E_ALLOW_NONLOCAL_DB !== "1") {
    throw new Error(`Refusing to run the governance vote fixture against non-local database host "${host}"`);
  }
}

function assertE2EProposalId(proposalId: string) {
  if (!proposalId.startsWith(PROPOSAL_ID_PREFIX)) {
    throw new Error(`Only E2E governance proposals (${PROPOSAL_ID_PREFIX}…) are allowed, not ${proposalId}`);
  }
}

async function seed(runId: string, proposerEmail: string, coopId = "cahootz", votingEndsAtArg?: string) {
  if (!/^[a-z0-9-]+$/i.test(runId)) throw new Error(`Invalid run id ${runId}`);
  const votingEndsAt = votingEndsAtArg ? new Date(votingEndsAtArg) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(votingEndsAt.getTime())) throw new Error(`Invalid votingEndsAt ${votingEndsAtArg}`);
  if (!proposerEmail.endsWith(TEST_EMAIL_SUFFIX)) throw new Error("Only seeded test accounts can propose");
  const proposer = await db.user.findUnique({
    where: { email: proposerEmail },
    select: { walletAddress: true, name: true },
  });
  if (!proposer?.walletAddress) throw new Error(`${proposerEmail} has no wallet`);

  const suffix = `${runId.replace(/[^a-z0-9]/gi, "").slice(-12)}${Math.random().toString(36).slice(2, 6)}`;
  const title = `E2E ${runId} Shared tool library`;
  const summary = "Buy and store shared tools members can borrow.";
  const proposal = await db.proposal.create({
    data: {
      id: `${PROPOSAL_ID_PREFIX}${suffix}`,
      title,
      summary,
      category: "OTHER",
      proposerWallet: proposer.walletAddress,
      proposerRole: "MEMBER",
      proposerDisplayName: proposer.name,
      regionCode: "US",
      regionName: "United States",
      budgetCurrency: "USD",
      budgetAmount: 12000,
      engineVersion: "proposal-engine@2.0.0",
      status: "VOTABLE",
      councilRequired: true,
      votingEndsAt,
      coopId,
      rawText: `Proposal Title: ${title}\nSummary: ${summary}\nBudget Requested: $12000`,
      decision: "advance",
      decisionReasons: [],
    },
    select: { id: true, title: true, votingEndsAt: true },
  });
  return { proposalId: proposal.id, title: proposal.title, coopId, votingEndsAt: proposal.votingEndsAt?.toISOString() ?? null };
}

async function status(proposalId: string) {
  assertE2EProposalId(proposalId);
  const proposal = await db.proposal.findUnique({
    where: { id: proposalId },
    select: { status: true, _count: { select: { votes: true } } },
  });
  return { status: proposal?.status ?? null, votes: proposal?._count.votes ?? 0 };
}

async function cleanup(proposalIds: string[]) {
  proposalIds.forEach(assertE2EProposalId);
  // Votes, comments, reactions and revisions cascade with the proposal.
  const deleted = await db.proposal.deleteMany({ where: { id: { in: proposalIds } } });
  return { deleted: deleted.count };
}

async function main() {
  assertSafeEnvironment();
  const [command, first, second, third, ...rest] = process.argv.slice(2);
  const result =
    command === "seed" && first && second
      ? await seed(first, second, third || undefined, rest[0])
      : command === "status" && first
        ? await status(first)
        : command === "cleanup" && first
          ? await cleanup([first, second, third, ...rest].filter(Boolean) as string[])
          : (() => {
              throw new Error(
                "Usage: e2e-governance-vote.ts seed <runId> <proposerEmail> [coopId] [votingEndsAt] | status <proposalId> | cleanup <proposalId...>",
              );
            })();
  console.log(`E2E_RESULT ${JSON.stringify(result)}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
