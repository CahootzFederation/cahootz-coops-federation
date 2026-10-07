/**
 * E2E fixture for the proposal-review and Sage-reply decision-trail journeys
 * (apps/mobile/e2e/agent-decision-trails.spec.ts). Not part of the product;
 * only the Playwright spec calls it.
 *
 *   tsx --import ./dotenv.config.js scripts/e2e-agent-trails.ts seed-proposal <runId> <proposerEmail>
 *     Creates an E2E proposal for a seeded test account and records its
 *     proposal-review decision trail with the real trail builder from a fixed
 *     engine output (the full engine is several web-searching model calls, too
 *     slow and costly for every run; its trail builder is unit-tested). Prints
 *     the proposal id, the proposer's wallet, and the Commons' Sage user id.
 *   tsx --import ./dotenv.config.js scripts/e2e-agent-trails.ts cleanup-post <postId>
 *     Deletes Sage's actions on an E2E post, with their proposal drafts, follow-up tasks, alerts, trails
 *     and the Sage memory written from them (so one run's memory can't steer the next run's reply).
 *   tsx --import ./dotenv.config.js scripts/e2e-agent-trails.ts cleanup <proposalId|-> [dmGroupId] [postId]
 *     Deletes the E2E proposal with its comments, evaluations and trails; the
 *     test account's direct message with Sage and its trails; and trails for
 *     an E2E post.
 *
 * Prints one JSON line prefixed with "E2E_RESULT ". Refuses anything but
 * seeded test accounts and refuses production.
 */
import { db } from "../../../packages/db/index.js";
import { ensureSageBotUser } from "../../../packages/trpc/src/lib/bot.js";
import { buildProposalEngineTrail } from "../../../packages/trpc/src/services/proposal-trails.js";

const TEST_EMAIL_SUFFIX = "@test.cahootz.local";
const COOP_ID = "cahootz";

function assertSafeEnvironment() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to run the agent-trail fixture in production");
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? "").hostname;
    } catch {
      return "";
    }
  })();
  if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(host) && process.env.E2E_ALLOW_NONLOCAL_DB !== "1") {
    throw new Error(`Refusing to run the agent-trail fixture against non-local database host "${host}"`);
  }
}

async function seedProposal(runId: string, proposerEmail: string) {
  if (!/^[a-z0-9-]+$/i.test(runId)) throw new Error(`Invalid run id ${runId}`);
  if (!proposerEmail.endsWith(TEST_EMAIL_SUFFIX)) throw new Error("Only seeded test accounts can propose");
  const proposer = await db.user.findUnique({ where: { email: proposerEmail }, select: { walletAddress: true } });
  if (!proposer?.walletAddress) throw new Error(`${proposerEmail} has no wallet`);
  const sage = await ensureSageBotUser(db, COOP_ID);
  const config = await db.coopConfig.findFirst({ where: { coopId: COOP_ID, isActive: true }, orderBy: { version: "desc" } });
  const goals = Array.isArray(config?.missionGoals)
    ? (config!.missionGoals as Array<{ key?: string; label?: string }>).filter((goal) => goal?.key && goal.label).map((goal) => ({ key: goal.key!, label: goal.label! }))
    : [];
  const goal = goals[0] ?? { key: "community", label: "Community benefit" };

  const title = `E2E ${runId} Community fridge`;
  const rawText = `Proposal Title: ${title}\nSummary: Stock a shared fridge at the community center.\nBudget Requested: $1200`;
  const proposal = await db.proposal.create({
    data: {
      id: `prop_e2e_${runId.replace(/[^a-z0-9]/gi, "").slice(-12)}`,
      title, summary: "Stock a shared fridge at the community center.", category: "OTHER",
      proposerWallet: proposer.walletAddress, proposerRole: "MEMBER", regionCode: "US", regionName: "United States",
      budgetCurrency: "USD", budgetAmount: 1200, engineVersion: "proposal-engine@2.0.0", status: "SUBMITTED",
      coopId: COOP_ID, rawText, decision: "revise", decisionReasons: ["Structural score below the gate"],
    },
    select: { id: true },
  });

  const output = {
    id: proposal.id, createdAt: new Date().toISOString(), status: "submitted", title, summary: "Stock a shared fridge at the community center.",
    proposer: { wallet: proposer.walletAddress, role: "member" }, region: { code: "US", name: "United States" }, category: "other",
    budget: { currency: "USD", amountRequested: 1200 },
    evaluation: {
      structural_scores: { goal_mapping_valid: true, feasibility_score: 0.7, risk_score: 0.4, accountability_score: 0.5 },
      mission_impact_scores: [],
      computed_scores: { mission_weighted_score: 0.74, structural_weighted_score: 0.58, overall_score: 0.67, passes_threshold: false, passFailReasons: ["FAIL_STRUCTURAL_GATE"] },
      violations: [], risk_flags: ["Ongoing restocking cost"], llm_summary: "Useful, but no plan for restocking.",
      mission_goal_breakdown: [{ goal_id: goal.key, score: 0.81, weight: 1, rationale: "Directly serves members' food needs.", evidenceRefs: ["shared fridge"] }],
      structural_breakdown: [{ factor: "accountability", score: 0.5, weight: 0.3, rationale: "No owner for restocking.", evidenceRefs: [] }],
    },
    governance: { quorumPercent: 20, approvalThresholdPercent: 60, votingWindowDays: 7 },
    audit: { engineVersion: "proposal-engine@2.0.0", checks: [{ name: "sector_exclusion_screen", passed: true, note: null }] },
    alternatives: [{ label: "One-month pilot", changes: [], overallScore: null, rationale: "Test demand before committing the full budget." }],
    decision: "revise", decisionReasons: ["Structural score below the gate"],
    missing_data: [{ field: "maintenance", question: "Who restocks the fridge?", why_needed: "Restocking is an ongoing cost.", severity: "SOFT" }],
    councilRequired: false, rawText,
  };
  await buildProposalEngineTrail(output as never, {
    coopId: COOP_ID, proposalId: proposal.id, trigger: "PROPOSAL_SUBMITTED", rawText,
    charterVersion: config?.version ?? null, missionGoals: goals, expertCalibrationCount: 0,
    thresholds: { structuralGate: 0.65, missionMinThreshold: 0.5, strongGoalThreshold: 0.7 },
    aiAutoApproveThresholdUSD: config?.aiAutoApproveThresholdUSD ?? 500, councilVoteThresholdUSD: config?.councilVoteThresholdUSD ?? 5000,
    finalStatus: "SUBMITTED", councilRequired: false,
  }).save();

  return { proposalId: proposal.id, wallet: proposer.walletAddress, sageUserId: sage.id };
}

async function cleanup(proposalId: string | undefined, dmGroupId?: string, postId?: string) {
  const result: Record<string, number> = {};
  if (proposalId && proposalId !== "-") {
    if (!proposalId.startsWith("prop_e2e_")) throw new Error("Only E2E proposals can be deleted");
    const comments = await db.proposalComment.findMany({ where: { proposalId }, select: { id: true } });
    const commentIds = comments.map((comment) => comment.id);
    await db.$transaction([
      db.sageDecisionTrail.deleteMany({ where: { proposalId } }),
      db.aIEvaluation.deleteMany({ where: { OR: [{ entityType: "ProposalComment", entityId: { in: commentIds } }, { entityType: "Proposal", entityId: proposalId }] } }),
      db.proposal.deleteMany({ where: { id: proposalId } }),
    ]);
    result.proposals = 1;
  }
  if (dmGroupId && dmGroupId !== "-") {
    const group = await db.group.findUnique({
      where: { id: dmGroupId },
      select: { kind: true, members: { select: { user: { select: { email: true, isBot: true } } } } },
    });
    if (group) {
      const humans = group.members.filter((member) => !member.user.isBot);
      if (group.kind !== "DIRECT" || !humans.every((member) => member.user.email.endsWith(TEST_EMAIL_SUFFIX))) {
        throw new Error("Only a test account's direct message can be deleted");
      }
      await db.$transaction([
        db.sageDecisionTrail.deleteMany({ where: { circleId: dmGroupId } }),
        db.group.delete({ where: { id: dmGroupId } }),
      ]);
      result.directMessages = 1;
    }
  }
  if (postId && postId !== "-") {
    result.postTrails = (await db.sageDecisionTrail.deleteMany({ where: { relatedPostIds: { has: postId }, agent: "sage-reply" } })).count;
  }
  return result;
}

/** Sage's actions on an E2E post and its comments: their proposal drafts, alerts and decision trails. */
async function cleanupPost(postId: string) {
  const post = await db.commonsPost.findUnique({ where: { id: postId }, select: { title: true } });
  if (post && !post.title.startsWith("E2E ")) throw new Error("Only E2E posts can be cleaned up");
  const actions = await db.commonsAction.findMany({ where: { sourcePostId: postId }, select: { id: true } });
  const actionIds = actions.map((action) => action.id);
  const drafts = await db.commonsProposalDraft.findMany({ where: { actionId: { in: actionIds } }, select: { id: true } });
  const draftIds = drafts.map((draft) => draft.id);
  const tasks = await db.sageTask.findMany({ where: { coopId: COOP_ID, OR: [{ postId }, { sourceActionId: { in: actionIds } }] }, select: { id: true } });
  const taskIds = tasks.map((task) => task.id);
  const memories = await db.aIObservation.findMany({
    where: { generatedByAgentKey: "sage-memory", sources: { some: { sourceId: { in: [...actionIds, ...taskIds] } } } },
    select: { id: true },
  });
  await db.$transaction([
    db.notification.deleteMany({ where: { OR: [
      { data: { path: ["postId"], equals: postId } },
      ...draftIds.map((id) => ({ data: { path: ["draftId"], equals: id } })),
      ...taskIds.map((id) => ({ data: { path: ["taskId"], equals: id } })),
    ] } }),
    db.aIObservation.deleteMany({ where: { id: { in: memories.map((memory) => memory.id) } } }),
    db.sageTask.deleteMany({ where: { id: { in: taskIds } } }),
    db.commonsProposalDraft.deleteMany({ where: { id: { in: draftIds } } }),
    db.commonsAction.deleteMany({ where: { id: { in: actionIds } } }),
    db.sageDecisionTrail.deleteMany({ where: { relatedPostIds: { has: postId } } }),
  ]);
  return { actions: actionIds.length, drafts: draftIds.length, tasks: taskIds.length, memories: memories.length };
}

async function main() {
  assertSafeEnvironment();
  const [command, first, second, third] = process.argv.slice(2);
  const result =
    command === "seed-proposal" && first && second
      ? await seedProposal(first, second)
      : command === "cleanup-post" && first
        ? await cleanupPost(first)
      : command === "cleanup" && first
        ? await cleanup(first, second, third)
        : (() => {
            throw new Error("Usage: e2e-agent-trails.ts seed-proposal <runId> <proposerEmail> | cleanup <proposalId|-> [dmGroupId] [postId]");
          })();
  console.log(`E2E_RESULT ${JSON.stringify(result)}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
