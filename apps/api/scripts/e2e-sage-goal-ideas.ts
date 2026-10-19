/**
 * Deterministic fixture for apps/mobile/e2e/sage-goal-ideas.spec.ts. Not part of the product.
 *
 *   tsx --import ./dotenv.config.js scripts/e2e-sage-goal-ideas.ts seed <runId> [vote|sent-back]
 *     Resets a private E2E-only Commons ("E2E Goal Ideas Commons": releaseclick1 is a steward,
 *     releaseclick2 and one helper account are members), backdates eight weeks of member posts
 *     followed by two quiet weeks, then runs the real goal check. Measuring, the gap observation,
 *     every "no" rule, code's checks on the idea, Sage's proposal text and the post are all real.
 *     Two things are fixed so the run costs nothing: the model's reply (a charter change that adds a
 *     Monday check-in), and the proposal review (several web-searching model calls, covered by
 *     proposal-sage-ideas.test.ts). The stand-in review saves Sage's proposal as votable ("vote") or
 *     sends it back ("sent-back"), so the real code withdraws it and posts an open idea.
 *   tsx --import ./dotenv.config.js scripts/e2e-sage-goal-ideas.ts approve <proposalId>
 *     Stands in for the member vote: marks Sage's proposal approved, then runs the real code that
 *     queues the change for a steward.
 *   tsx --import ./dotenv.config.js scripts/e2e-sage-goal-ideas.ts reset <runId>
 *     Resets the E2E Commons (members, charter, goals, nothing left from earlier runs) without running a
 *     goal check, for the admin journey that runs one from the portal.
 *   tsx --import ./dotenv.config.js scripts/e2e-sage-goal-ideas.ts charter
 *   tsx --import ./dotenv.config.js scripts/e2e-sage-goal-ideas.ts cleanup <runId>
 *
 * Prints one JSON line prefixed with "E2E_RESULT ". Only touches the E2E Commons, and refuses
 * production and non-local databases (unless E2E_ALLOW_NONLOCAL_DB=1).
 */
import { db } from "../../../packages/db/index.js";
import {
  GOAL_CHECK_SOURCE, SAGE_PROPOSER_WALLET, goalCheckPeriod, queueAmendmentForProposal, runGoalCheck, type IdeaOutput, type IdeaSubmit,
} from "../../../packages/trpc/src/services/sage-goal-ideas.js";

export const COOP_ID = "e2e-goal-ideas";
const NAME = "E2E Goal Ideas Commons";
const PROPOSAL_ID_PREFIX = "prop_e2e_goal_";
const HELPER_EMAIL = "e2e-goal-ideas-helper@test.cahootz.local";
const USER_A_EMAIL = process.env.E2E_USER_A_EMAIL || "releaseclick1@test.cahootz.local";
const USER_B_EMAIL = process.env.E2E_USER_B_EMAIL || "releaseclick2@test.cahootz.local";
const DAY_MS = 86_400_000;

const PASSAGE = "Members share news, needs and wins in the open.";
const NEW_PASSAGE = "Members share news, needs and wins in the open, and we start each week with a Monday check-in thread.";
export const CHARTER = `E2E Goal Ideas fixture charter. We keep each other in the loop. ${PASSAGE} Proposals need a simple majority of votes cast.`;
const GOALS = [
  { key: "more_communication", label: "More communication", priorityWeight: 0.6, description: "Members talk and share news" },
  { key: "local_commerce", label: "Local commerce", priorityWeight: 0.4, description: "Buy from member stores first" },
];

function assertSafeEnvironment() {
  if (process.env.NODE_ENV === "production") throw new Error("Goal ideas fixture refuses production");
  const host = (() => { try { return new URL(process.env.DATABASE_URL ?? "").hostname; } catch { return ""; } })();
  if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(host) && process.env.E2E_ALLOW_NONLOCAL_DB !== "1") {
    throw new Error(`Refusing non-local database host "${host}"`);
  }
}

async function testUser(email: string) {
  const user = await db.user.findUnique({ where: { email }, select: { id: true, name: true, handle: true, walletAddress: true } });
  if (!user) throw new Error(`Seed ${email} first (pnpm -F @repo/db seed:test-users)`);
  return user;
}

async function ensureCommons() {
  const createdAt = new Date(Date.now() - 80 * DAY_MS);
  const existing = await db.coopConfig.findFirst({ where: { coopId: COOP_ID, isActive: true }, select: { id: true } });
  if (existing) {
    await db.coopConfig.update({ where: { id: existing.id }, data: { charterText: CHARTER, missionGoals: GOALS, createdAt, isPrivate: true } });
    return existing.id;
  }
  const created = await db.coopConfig.create({ data: {
    coopId: COOP_ID, version: 1, isActive: true, name: NAME, slug: "E2E Goal Ideas", isPrivate: true, displayOrder: 100,
    charterText: CHARTER, missionGoals: GOALS, proposalCategories: [], sectorExclusions: [],
    structuralWeights: { feasibility: 0.4, risk: 0.35, accountability: 0.25 }, scoreMix: { missionWeight: 0.6, structuralWeight: 0.4 },
    createdBy: "system", createdAt,
  }, select: { id: true } });
  return created.id;
}

async function ensureMember(userId: string, roles: string[]) {
  await db.userCoopMembership.upsert({
    where: { userId_coopId: { userId, coopId: COOP_ID } },
    update: { status: "ACTIVE", roles },
    create: { userId, coopId: COOP_ID, status: "ACTIVE", roles, joinedAt: new Date(Date.now() - 75 * DAY_MS) },
  });
}

/** Everything Sage and earlier runs left in the E2E Commons. Member accounts and the Commons stay. */
async function clearCommons() {
  const drafts = await db.commonsProposalDraft.findMany({ where: { coopId: COOP_ID }, select: { submittedProposalId: true } });
  const proposalIds = drafts.flatMap((draft) => draft.submittedProposalId?.startsWith(PROPOSAL_ID_PREFIX) ? [draft.submittedProposalId] : []);
  await db.commonsProposalDraft.deleteMany({ where: { coopId: COOP_ID } });
  // Every proposal here is E2E: this run's stand-ins, and any the local wake loop's real goal check put up.
  await db.proposal.deleteMany({ where: { coopId: COOP_ID } });
  await db.proposal.deleteMany({ where: { id: { in: proposalIds } } });
  const actions = await db.commonsAction.findMany({ where: { coopId: COOP_ID }, select: { id: true } });
  await db.commonsActionAudit.deleteMany({ where: { actionId: { in: actions.map((action) => action.id) } } });
  await db.commonsAction.deleteMany({ where: { coopId: COOP_ID } });
  await db.aIObservation.deleteMany({ where: { scopeType: "commons", scopeId: COOP_ID } });
  await db.commonsComment.deleteMany({ where: { post: { coopId: COOP_ID } } });
  await db.commonsPost.deleteMany({ where: { coopId: COOP_ID } });
  await db.commonsContentScan.deleteMany({ where: { coopId: COOP_ID } });
  await db.sageDecisionTrail.deleteMany({ where: { coopId: COOP_ID } });
  await db.notification.deleteMany({ where: { coopId: COOP_ID } });
  const configs = await db.coopConfig.findMany({ where: { coopId: COOP_ID }, select: { id: true } });
  await db.coopConfigAudit.deleteMany({ where: { coopConfigId: { in: configs.map((config) => config.id) } } });
}

/** Letters only: Sage's number check refuses any figure nobody gave, and a run id is full of digits. */
function runTag(runId: string) {
  return runId.replace(/\d/g, (digit) => "abcdefghij"[Number(digit)]!).replace(/[^a-z]/gi, "").slice(-12);
}

function fixedIdea(runId: string): IdeaOutput {
  return {
    decision: "PROPOSE",
    reason: "Talk dropped off. A standing Monday thread is free and easy to start.",
    goalKey: "more_communication",
    kind: "CHARTER_AMENDMENT",
    title: `E2E ${runTag(runId)} Start each week with a check-in`,
    pitch: "Let's make a Monday check-in thread part of how we work, so everyone has an easy place to share what's going on.",
    body: "What: add a weekly Monday check-in thread to our charter. Who: a volunteer host each month starts the thread. When: the Monday after the vote. How we'll know it worked: more members posting and replying within a month. Cost: nothing.",
    budgetAmount: null,
    charterQuote: PASSAGE,
    charterChange: { find: PASSAGE, replace: NEW_PASSAGE },
    newGoals: null,
    confidence: 0.82,
  };
}

/** The stand-in proposal review: saves Sage's proposal the way the router would, without the engine. */
function reviewStandIn(runId: string, mode: "vote" | "sent-back"): IdeaSubmit {
  return async ({ coopId, text }) => {
    const title = /Proposal Title:\s*(.+)/.exec(text)?.[1]?.trim() ?? "Sage proposal";
    const summary = text.replace(/^Proposal Title:.*\n+/, "").split("\n")[0]!.slice(0, 300);
    const proposal = await db.proposal.create({ data: {
      id: `${PROPOSAL_ID_PREFIX}${runId.replace(/[^a-z0-9]/gi, "").slice(-16)}`, title, summary, category: "GOVERNANCE",
      proposerWallet: SAGE_PROPOSER_WALLET, proposerRole: "BOT", proposerDisplayName: "Sage",
      regionCode: "US", regionName: "United States", budgetCurrency: "USD", budgetAmount: 0, engineVersion: "proposal-engine@2.0.0",
      status: mode === "vote" ? "VOTABLE" : "SUBMITTED", councilRequired: true, coopId, rawText: text,
      votingEndsAt: mode === "vote" ? new Date(Date.now() + 7 * DAY_MS) : null,
      decision: mode === "vote" ? "advance" : "needs_info", decisionReasons: mode === "vote" ? [] : ["Who hosts the thread each month?"],
    }, select: { id: true, status: true } });
    return { id: proposal.id, status: proposal.status.toLowerCase(), decision: mode === "vote" ? "advance" : "needs_info", decisionReasons: mode === "vote" ? [] : ["Who hosts the thread each month?"] };
  };
}

async function reset(runId: string) {
  if (!/^[a-z0-9-]+$/i.test(runId)) throw new Error(`Invalid run id ${runId}`);
  const [userA, userB] = await Promise.all([testUser(USER_A_EMAIL), testUser(USER_B_EMAIL)]);
  await ensureCommons();
  await ensureMember(userA.id, ["member", "steward"]);
  await ensureMember(userB.id, ["member"]);
  await clearCommons();
  return { coopId: COOP_ID };
}

async function seed(runId: string, mode: "vote" | "sent-back") {
  if (!/^[a-z0-9-]+$/i.test(runId)) throw new Error(`Invalid run id ${runId}`);
  const [userA, userB] = await Promise.all([testUser(USER_A_EMAIL), testUser(USER_B_EMAIL)]);
  const helper = await db.user.upsert({ where: { email: HELPER_EMAIL }, update: {}, create: { email: HELPER_EMAIL, name: "E2E Goal Helper" }, select: { id: true } });
  await ensureCommons();
  await ensureMember(userA.id, ["member", "steward"]);
  await ensureMember(userB.id, ["member"]);
  await ensureMember(helper.id, ["member"]);
  await clearCommons();

  // Eight weeks of steady talk (five posts every two weeks), then two quiet weeks.
  const authors = [userA.id, userB.id, helper.id];
  const now = Date.now();
  const posts = [];
  for (let bucket = 1; bucket <= 4; bucket++) {
    for (let index = 0; index < 5; index++) {
      const createdAt = new Date(now - (bucket * 14 + 1 + index) * DAY_MS);
      posts.push({ coopId: COOP_ID, circleId: `general:${COOP_ID}`, authorId: authors[index % authors.length]!, title: `E2E ${runId} catch-up ${bucket}-${index}`, content: `E2E ${runId}: sharing what's new this week.`, tag: "Social", createdAt });
    }
  }
  await db.commonsPost.createMany({ data: posts });

  const result = await runGoalCheck(COOP_ID, { force: true, matcher: null, decide: async () => fixedIdea(runId), submit: reviewStandIn(runId, mode) });
  if (result.status !== "PROPOSED") throw new Error(`The goal check didn't propose: ${JSON.stringify(result)}`);
  // Claim this half-week so the API's own wake loop doesn't run a second, real goal check here mid-test.
  await db.commonsContentScan.create({ data: {
    coopId: COOP_ID, sourceType: GOAL_CHECK_SOURCE, sourceId: COOP_ID, contentHash: goalCheckPeriod(new Date()), charterConfigId: "sage-goal-check:v1", status: "SUCCESS",
  } }).catch(() => {});
  const gap = await db.aIObservation.findUnique({ where: { systemKey: `goal_gap:${COOP_ID}:more_communication` }, select: { summary: true } });
  // How the app names whoever took an idea on (proposalIdeaForPost).
  const userAName = userA.name || (userA.handle ? `@${userA.handle}` : "A member");
  return { coopId: COOP_ID, postId: result.ideaPostId, draftId: result.draftId, proposalId: result.proposalId, title: fixedIdea(runId).title, userAName, gap: gap?.summary ?? null };
}

async function approve(proposalId: string) {
  if (!proposalId.startsWith(PROPOSAL_ID_PREFIX)) throw new Error("Only an E2E goal proposal can be approved");
  const draft = await db.commonsProposalDraft.findFirst({ where: { coopId: COOP_ID, submittedProposalId: proposalId }, select: { kind: true, proposedChanges: true } });
  if (!draft) throw new Error("No Sage proposal from a goal idea to approve");
  const proposal = await db.proposal.update({ where: { id: proposalId }, data: { status: "APPROVED" }, select: { id: true, title: true } });
  return { proposalId, queued: await queueAmendmentForProposal(COOP_ID, proposal, draft) };
}

async function charter() {
  const config = await db.coopConfig.findFirst({ where: { coopId: COOP_ID, isActive: true }, select: { version: true, charterText: true } });
  return { version: config?.version ?? null, charterText: config?.charterText ?? null };
}

async function main() {
  assertSafeEnvironment();
  const [command, first, second] = process.argv.slice(2);
  const result = command === "seed" && first ? await seed(first, second === "sent-back" ? "sent-back" : "vote")
    : command === "approve" && first ? await approve(first)
      : command === "charter" ? await charter()
      : command === "reset" && first ? await reset(first)
        : command === "cleanup" && first ? (await clearCommons(), await ensureCommons(), { cleaned: true })
          : null;
  if (!result) throw new Error("Usage: e2e-sage-goal-ideas.ts seed <runId> [vote|sent-back] | reset <runId> | approve <proposalId> | charter | cleanup <runId>");
  console.log(`E2E_RESULT ${JSON.stringify(result)}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
