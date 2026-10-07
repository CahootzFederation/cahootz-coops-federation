import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router } from "../trpc.js";
import { authenticatedProcedure, publicProcedure, privateProcedure } from "../procedures/index.js";
import { ProposalInputZ, ProposalOutputZ, proposalEngine, type ProposalOutput } from "@repo/validators";
import type { CoopConfigData } from "@repo/validators";
import { ProposalCategory, ProposalStatus, ProposerRole, Currency, VoteType } from "@repo/db";
import type { AuthenticatedContext } from "../context.js";
import { recordAIEvaluation } from "../services/ai-evaluation-log.js";
import { withCostedProposalRun } from "../services/ai-cost.js";
import {
  buildProposalEngineFailureTrail, buildProposalEngineTrail, type ProposalTrailContext,
} from "../services/proposal-trails.js";
import type { DecisionTrail } from "../services/sage-decision-trail.js";
import { cleanseUntrustedText, isSteeringAttempt, mergeFlags, type CleansedText } from "../services/untrusted-input.js";
import {
  findPriorProposalOutcomes, kpiRows, kpiUnitFromDb, OutcomeReportError, reportKpiOutcome, startProposalOutcomeTracking,
} from "../services/proposal-outcomes.js";

/** Engine options: look up results of similar past proposals in this Commons from Sage's scoped memory. */
function priorOutcomeLookup(coopId: string, excludeProposalId?: string) {
  return {
    priorOutcomes: (about: { title: string; summary: string }) =>
      findPriorProposalOutcomes({ coopId, about, excludeProposalId }),
  };
}

/** Starts Sage's outcome checks once a proposal is approved or funded. Never blocks the caller. */
async function trackOutcomesIfDecided(proposalId: string, status: string) {
  if (status !== "APPROVED" && status !== "FUNDED") return;
  await startProposalOutcomeTracking(proposalId).catch((error) => console.error("Could not start proposal outcome checks", error));
}

/** Flags from both the original and the rewritten text, with the rewritten text as what the engine reads. */
function mergeFlagsWithText(original: CleansedText, rewritten: CleansedText): CleansedText {
  return { text: rewritten.text, ...mergeFlags([original, rewritten]) };
}

/** When voting closes for a proposal that just became votable; null otherwise. Gives Sage real deadlines. */
export function votingEndsAtFor(status: ProposalStatus, votingWindowDays: number, now = new Date()): Date | null {
  // String literal, not the Prisma enum, so this also runs where @repo/db is mocked.
  return status === "VOTABLE" ? new Date(now.getTime() + Math.max(1, votingWindowDays) * 86_400_000) : null;
}

/**
 * When voting closes for a proposal. Uses the stored `votingEndsAt`, which is
 * set whenever the proposal becomes votable. Older votable proposals saved
 * before that column existed fall back to their own voting window counted from
 * their last change (the closest record we have of when they became votable).
 */
export function effectiveVotingEndsAt(record: {
  status: string;
  votingEndsAt?: Date | null;
  votingWindowDays?: number | null;
  updatedAt?: Date | null;
  createdAt?: Date | null;
}): Date | null {
  if (record.votingEndsAt) return record.votingEndsAt;
  if (record.status !== "VOTABLE") return null;
  const becameVotable = record.updatedAt ?? record.createdAt;
  if (!becameVotable) return null;
  return votingEndsAtFor("VOTABLE" as ProposalStatus, record.votingWindowDays ?? 7, becameVotable);
}

/** Records a proposal-engine decision trail. Never affects the proposal: failures are logged only. */
async function saveProposalTrail(build: () => DecisionTrail) {
  try {
    await build().save();
  } catch (error) {
    console.error("Could not record proposal decision trail", error);
  }
}

function proposalTrailSettings(
  coopConfig: { version: number; aiAutoApproveThresholdUSD: number | null; councilVoteThresholdUSD: number | null } | null,
  configData: CoopConfigData | undefined,
): Pick<ProposalTrailContext, "charterVersion" | "missionGoals" | "expertCalibrationCount" | "thresholds" | "aiAutoApproveThresholdUSD" | "councilVoteThresholdUSD"> {
  return {
    charterVersion: coopConfig?.version ?? null,
    missionGoals: (configData?.missionGoals ?? []).map((goal) => ({ key: goal.key, label: goal.label })),
    expertCalibrationCount: Object.values(configData?.expertCalibration ?? {}).reduce((sum, examples) => sum + examples.length, 0),
    thresholds: {
      structuralGate: configData?.structuralGate ?? 0.65,
      missionMinThreshold: configData?.missionMinThreshold ?? 0.5,
      strongGoalThreshold: configData?.strongGoalThreshold ?? 0.7,
    },
    aiAutoApproveThresholdUSD: coopConfig?.aiAutoApproveThresholdUSD ?? 500,
    councilVoteThresholdUSD: coopConfig?.councilVoteThresholdUSD ?? 5000,
  };
}

const COMMONS_COOP_ID = "cahootz";

function normalizeDbCategory(categoryKey: string): ProposalCategory {
  const key = categoryKey.toUpperCase();
  const values = Object.values(ProposalCategory) as string[];
  return values.includes(key) ? (key as ProposalCategory) : ProposalCategory.OTHER;
}

async function userIdForWallet(db: any, walletAddress: string) {
  const user = await db.user.findFirst({
    where: {
      OR: [
        { walletAddress: { equals: walletAddress, mode: "insensitive" } },
        {
          wallets: {
            some: {
              address: { equals: walletAddress, mode: "insensitive" },
            },
          },
        },
      ],
    },
    select: { id: true },
  });

  return user?.id as string | undefined;
}

async function requireProposalMembership(db: any, walletAddress: string, coopId: string) {
  const userId = await userIdForWallet(db, walletAddress);

  if (!userId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Create an account before submitting proposals.",
    });
  }

  const membership = await db.userCoopMembership.findUnique({
    where: {
      userId_coopId: {
        userId,
        coopId,
      },
    },
    select: { status: true },
  });

  if (membership?.status !== "ACTIVE") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: coopId === COMMONS_COOP_ID
        ? "Your Cahootz Commons membership is not active yet."
        : "Join this commons before submitting proposals here.",
    });
  }
}

export const proposalRouter = router({
  /**
   * Drawer/hub summary for the currently verified council member.
   * `privateProcedure` verifies the wallet's on-chain admin role for the
   * commons supplied in x-coop-id before this query runs.
   */
  myActionSummary: privateProcedure
    .input(z.object({ coopId: z.string().min(1) }))
    .output(z.object({
      canVote: z.literal(true),
      actionableVoteCount: z.number(),
      actionableProposalIds: z.array(z.string()),
    }))
    .query(async ({ input, ctx }) => {
      if (ctx.coopId !== input.coopId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Commons context does not match." });
      }

      const { walletAddress } = ctx as AuthenticatedContext;
      const proposals = await ctx.db.proposal.findMany({
        where: {
          coopId: input.coopId,
          status: ProposalStatus.VOTABLE,
          councilRequired: true,
          votes: { none: { voterWallet: walletAddress } },
        },
        select: { id: true },
      });

      return {
        canVote: true as const,
        actionableVoteCount: proposals.length,
        actionableProposalIds: proposals.map((proposal: { id: string }) => proposal.id),
      };
    }),

  /**
   * Create a new proposal (authenticated — any wallet holder)
   * Auto-approves if AI says "advance" AND budget < councilVoteThresholdUSD
   * Sets councilRequired=true if AI says "advance" AND budget >= threshold
   */
  create: authenticatedProcedure
    .input(ProposalInputZ)
    .output(ProposalOutputZ)
    .mutation(async ({ input, ctx }) => {
      const { walletAddress } = ctx as AuthenticatedContext;
      
      if (!input.coopId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "coopId is required",
        });
      }
      
      const coopId = input.coopId;
      await requireProposalMembership(ctx.db, walletAddress, coopId);

      // Fetch active CoopConfig
      let configData: CoopConfigData | undefined;
      let aiAutoApproveThreshold = 500;
      let councilVoteThreshold = 5000;
      const coopConfig = await ctx.db.coopConfig.findFirst({
        where: { coopId, isActive: true },
        orderBy: { version: "desc" },
      });

      if (coopConfig) {
        aiAutoApproveThreshold = coopConfig.aiAutoApproveThresholdUSD ?? 500;
        councilVoteThreshold = coopConfig.councilVoteThresholdUSD ?? 5000;

        configData = {
          charterText: coopConfig.charterText,
          missionGoals: coopConfig.missionGoals as Array<{ key: string; label: string; priorityWeight: number; description?: string }>,
          structuralWeights: coopConfig.structuralWeights as { feasibility: number; risk: number; accountability: number },
          scoreMix: coopConfig.scoreMix as { missionWeight: number; structuralWeight: number },
          screeningPassThreshold: coopConfig.screeningPassThreshold,
          proposalCategories: coopConfig.proposalCategories as Array<{ key: string; label: string; isActive: boolean }>,
          sectorExclusions: (coopConfig.sectorExclusions as Array<string | { value: string; description?: string }>)
            .map(e => typeof e === "string" ? { value: e } : e),
          quorumPercent: coopConfig.quorumPercent,
          approvalThresholdPercent: coopConfig.approvalThresholdPercent,
          votingWindowDays: coopConfig.votingWindowDays,
          scorerAgents: ((coopConfig as any).scorerAgents as any[] | undefined) ?? [],
          strongGoalThreshold: (coopConfig as any).strongGoalThreshold ?? 0.70,
          missionMinThreshold: (coopConfig as any).missionMinThreshold ?? 0.50,
          structuralGate: (coopConfig as any).structuralGate ?? 0.65,
        };

        // Attach historical expert calibration so domain agents learn from past corrections
        configData.expertCalibration = await fetchExpertCalibration(ctx.db, coopId);
      }

      // Member-written text is cleansed before the engine reads it; the original is what gets stored.
      const proposalInputCheck = cleanseUntrustedText(input.text, { maxChars: 10_000 });

      // Process proposal through AI engine — save raw proposal first if engine fails
      let processedProposal: Awaited<ReturnType<typeof proposalEngine.processProposal>> | null = null;
      let aiError: unknown = null;
      const engineStart = Date.now();
      try {
        processedProposal = await withCostedProposalRun(coopId, "proposal-engine", () => proposalEngine.processProposal({ ...input, text: proposalInputCheck.text }, configData, priorOutcomeLookup(coopId)));
        await recordAIEvaluation({
          agentKey: "proposal-engine",
          agentName: "Proposal Engine",
          entityType: "Proposal",
          entityId: processedProposal.id,
          input: { rawText: input.text },
          output: processedProposal,
          durationMs: Date.now() - engineStart,
        }).catch((logErr) => console.error("Failed to log AIEvaluation for proposal-engine:", logErr));
      } catch (err) {
        aiError = err;
        console.error(`⚠️ [proposal.create] AI engine failed — saving raw proposal for async review:`, err);
        await recordAIEvaluation({
          agentKey: "proposal-engine",
          agentName: "Proposal Engine",
          entityType: "Proposal",
          input: { rawText: input.text },
          status: "ERROR",
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - engineStart,
        }).catch((logErr) => console.error("Failed to log AIEvaluation error for proposal-engine:", logErr));
      }

      if (aiError || !processedProposal) {
        // Save raw proposal with SUBMITTED status so it can be re-evaluated async
        const titleMatch = input.text.match(/Proposal Title:\s*(.+)/i);
        const summaryMatch = input.text.match(/Summary:\s*(.+)/i);
        const budgetMatch = input.text.match(/Budget Requested:\s*\$?([\d,\.]+)/i);
        const categoryMatch = input.text.match(/Category Key:\s*(.+)/i);

        const fallbackTitle = titleMatch?.[1]?.trim() ?? 'Untitled Proposal';
        const fallbackSummary = summaryMatch?.[1]?.trim() ?? input.text.slice(0, 200);
        const fallbackBudget = parseFloat((budgetMatch?.[1] ?? '0').replace(/,/g, '')) || 0;
        const fallbackCategoryKey = categoryMatch?.[1]?.trim() ?? 'other';

        const savedProposal = await ctx.db.proposal.create({
          data: {
            title: fallbackTitle,
            summary: fallbackSummary,
            category: normalizeDbCategory(fallbackCategoryKey),
            categoryKey: fallbackCategoryKey,
            proposerWallet: walletAddress,
            proposerRole: ProposerRole.MEMBER,
            regionCode: 'US',
            regionName: 'United States',
            budgetCurrency: Currency.USD,
            budgetAmount: fallbackBudget,
            quorumPercent: coopConfig?.quorumPercent ?? 60,
            approvalThresholdPercent: coopConfig?.approvalThresholdPercent ?? 51,
            votingWindowDays: coopConfig?.votingWindowDays ?? 7,
            engineVersion: '0.0.0-pending',
            status: ProposalStatus.SUBMITTED,
            councilRequired: false,
            evaluation: undefined,
            charterVersionId: coopConfig?.id ?? undefined,
            coopId,
            rawText: input.text,
            decision: 'pending',
            decisionReasons: [],
          },
          include: { kpis: true, auditChecks: true },
        });
        await saveProposalTrail(() => buildProposalEngineFailureTrail(
          { coopId, proposalId: savedProposal.id, trigger: "PROPOSAL_SUBMITTED", rawText: input.text }, aiError,
        ));

        return mapDbToOutput(savedProposal);
      }

      // Determine final status using 3-tier approval logic:
      //   Tier 1: budget < aiAutoApproveThreshold  → AI auto-approved, no vote needed
      //   Tier 2: budget < councilVoteThreshold     → council vote required
      //   Tier 3: budget >= councilVoteThreshold    → full coop vote (councilRequired=true, stays votable)
      const budget = processedProposal.budget.amountRequested;
      let finalStatus: ProposalStatus;
      let councilRequired = false;

      if (processedProposal.decision === "advance") {
        if (budget < aiAutoApproveThreshold) {
          finalStatus = ProposalStatus.APPROVED; // Tier 1: AI auto-approve
        } else if (budget < councilVoteThreshold) {
          finalStatus = ProposalStatus.VOTABLE;  // Tier 2: council vote
          councilRequired = true;
        } else {
          finalStatus = ProposalStatus.VOTABLE;  // Tier 3: full coop vote
          councilRequired = true;
        }
      } else {
        finalStatus = processedProposal.status.toUpperCase() as ProposalStatus;
      }
      // Text that tries to instruct the reviewer never gets the no-vote auto-approval.
      const autoApproveBlocked = isSteeringAttempt(proposalInputCheck.flags) && finalStatus === ProposalStatus.APPROVED;
      if (autoApproveBlocked) {
        finalStatus = ProposalStatus.VOTABLE;
        councilRequired = true;
      }

      // Save to database with enhanced fields
      const savedProposal = await ctx.db.proposal.create({
        data: {
          id: processedProposal.id,
          title: processedProposal.title,
          summary: processedProposal.summary,
          category: normalizeDbCategory(processedProposal.category),
          proposerWallet: walletAddress,
          proposerRole: (processedProposal.proposer.role || "member").toUpperCase() as ProposerRole,
          proposerDisplayName: processedProposal.proposer.displayName,
          regionCode: processedProposal.region.code,
          regionName: processedProposal.region.name,
          budgetCurrency: processedProposal.budget.currency.toUpperCase() as Currency,
          budgetAmount: processedProposal.budget.amountRequested,
          quorumPercent: processedProposal.governance.quorumPercent,
          approvalThresholdPercent: processedProposal.governance.approvalThresholdPercent,
          votingWindowDays: processedProposal.governance.votingWindowDays,
          engineVersion: processedProposal.audit.engineVersion,
          status: finalStatus,
          votingEndsAt: votingEndsAtFor(finalStatus, processedProposal.governance.votingWindowDays),
          councilRequired,
          // New evaluation model
          evaluation: processedProposal.evaluation as any,
          charterVersionId: coopConfig?.id ?? undefined,
          // Enhanced fields
          coopId,
          rawText: input.text,
          categoryKey: processedProposal.category,
          alternatives: processedProposal.alternatives ?? undefined,
          bestAlternative: processedProposal.bestAlternative ?? undefined,
          decision: processedProposal.decision,
          decisionReasons: processedProposal.decisionReasons ?? [],
          missingData: processedProposal.missing_data ?? undefined,
          priorOutcomes: processedProposal.priorOutcomes?.length ? processedProposal.priorOutcomes : undefined,
          ...(processedProposal.kpis?.length ? { kpis: { createMany: { data: kpiRows(processedProposal.kpis) } } } : {}),
          auditChecks: {
            createMany: {
              data: processedProposal.audit.checks.map((check: any) => ({
                name: check.name,
                passed: check.passed,
                note: check.note,
              })),
            },
          },
        },
        include: {
          kpis: true,
          auditChecks: true,
        },
      });
      await trackOutcomesIfDecided(savedProposal.id, finalStatus);

      // Fetch complete proposal
      const completeProposal = await ctx.db.proposal.findUnique({
        where: { id: savedProposal.id },
        include: {
          kpis: true,
          auditChecks: true
        }
      });

      // Save initial revision snapshot (revision 1)
      await saveRevision(ctx.db, savedProposal.id, 1, processedProposal, finalStatus, input.text, configData);
      const createdProposal = processedProposal;
      await saveProposalTrail(() => buildProposalEngineTrail(createdProposal, {
        coopId, proposalId: savedProposal.id, trigger: "PROPOSAL_SUBMITTED", rawText: input.text,
        ...proposalTrailSettings(coopConfig, configData), finalStatus, councilRequired,
        inputCheck: proposalInputCheck, autoApproveBlocked,
      }));

      return mapDbToOutput(completeProposal);
    }),

  /**
   * Get proposal by ID
   */
  getById: publicProcedure
    .input(z.object({ id: z.string() }))
    .output(ProposalOutputZ.nullable())
    .query(async ({ input, ctx }) => {
      const proposal = await ctx.db.proposal.findUnique({
        where: { id: input.id },
        include: {
          kpis: true,
          auditChecks: true
        }
      });

      if (!proposal) return null;

      return mapDbToOutput(proposal);
    }),

  /**
   * List proposals with filtering and pagination
   */
  list: publicProcedure
    .input(z.object({
      coopId: z.string(),
      status: z.enum(["submitted", "votable", "approved", "funded", "rejected", "failed", "withdrawn"]).optional(),
      statuses: z.array(z.enum(["submitted", "votable", "approved", "funded", "rejected", "failed", "withdrawn"])).optional(),
      category: z.string().min(1).optional(),
      region: z.string().optional(),
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0)
    }))
    .output(z.object({
      proposals: z.array(ProposalOutputZ),
      total: z.number(),
      hasMore: z.boolean()
    }))
    .query(async ({ input, ctx }) => {
      // statuses array takes priority over single status
      const statusFilter = input.statuses?.length
        ? { status: { in: input.statuses.map(s => s.toUpperCase() as ProposalStatus) } }
        : input.status
          ? { status: input.status.toUpperCase() as ProposalStatus }
          : {};

      const where = {
        coopId: input.coopId,
        ...statusFilter,
        ...(input.category && { categoryKey: input.category }),
        ...(input.region && { regionCode: input.region }),
      };

      const [proposals, total] = await Promise.all([
        ctx.db.proposal.findMany({
          where,
          skip: input.offset,
          take: input.limit,
          orderBy: { createdAt: 'desc' },
          include: {
            kpis: true,
            auditChecks: true
          }
        }),
        ctx.db.proposal.count({ where })
      ]);

      return {
        proposals: proposals.map(mapDbToOutput),
        total,
        hasMore: input.offset + input.limit < total
      };
    }),

  /**
   * Update proposal status (admin only)
   */
  updateStatus: privateProcedure
    .input(z.object({
      id: z.string(),
      status: z.enum(["submitted", "votable", "approved", "funded", "rejected", "failed", "withdrawn"])
    }))
    .output(ProposalOutputZ)
    .mutation(async ({ input, ctx }) => {
      const proposal = await ctx.db.proposal.findUnique({ where: { id: input.id } });
      if (!proposal) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Proposal not found" });
      }

      const newStatus = input.status.toUpperCase() as ProposalStatus;
      const updateData: Record<string, any> = { status: newStatus };
      if (newStatus === ProposalStatus.VOTABLE) {
        const current = await ctx.db.proposal.findUnique({ where: { id: input.id }, select: { votingWindowDays: true } });
        updateData.votingEndsAt = votingEndsAtFor(newStatus, current?.votingWindowDays ?? 7);
      }

      if (newStatus === ProposalStatus.WITHDRAWN) {
        const { walletAddress: adminWallet } = ctx as AuthenticatedContext;
        updateData.withdrawnAt = new Date();
        updateData.withdrawnBy = adminWallet;
      }

      await ctx.db.proposal.update({ where: { id: input.id }, data: updateData });
      await trackOutcomesIfDecided(input.id, newStatus);
      const updated = await ctx.db.proposal.findUnique({ where: { id: input.id }, include: { kpis: true, auditChecks: true } });

      return mapDbToOutput(updated);
    }),

  /**
   * Withdraw a proposal (proposer only)
   */
  withdraw: authenticatedProcedure
    .input(z.object({ id: z.string() }))
    .output(ProposalOutputZ)
    .mutation(async ({ input, ctx }) => {
      const { walletAddress } = ctx as AuthenticatedContext;

      const proposal = await ctx.db.proposal.findUnique({ where: { id: input.id } });
      if (!proposal) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Proposal not found" });
      }

      if (proposal.proposerWallet !== walletAddress) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the proposer can withdraw this proposal" });
      }

      const withdrawableStatuses: ProposalStatus[] = [ProposalStatus.SUBMITTED, ProposalStatus.VOTABLE];
      if (!withdrawableStatuses.includes(proposal.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot withdraw a proposal with status ${proposal.status.toLowerCase()}`
        });
      }

      const updated = await ctx.db.proposal.update({
        where: { id: input.id },
        data: {
          status: ProposalStatus.WITHDRAWN,
          withdrawnAt: new Date(),
          withdrawnBy: walletAddress,
        },
        include: { kpis: true, auditChecks: true }
      });

      return mapDbToOutput(updated);
    }),

  /**
   * Council vote on a proposal (admin only, councilRequired proposals)
   */
  councilVote: privateProcedure
    .input(z.object({
      proposalId: z.string(),
      vote: z.enum(["FOR", "AGAINST", "ABSTAIN"]),
    }))
    .output(z.object({
      vote: z.enum(["FOR", "AGAINST", "ABSTAIN"]),
      forCount: z.number(),
      againstCount: z.number(),
      abstainCount: z.number(),
      newStatus: z.string().nullable(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { walletAddress } = ctx as AuthenticatedContext;

      const proposal = await ctx.db.proposal.findUnique({ where: { id: input.proposalId } });
      if (!proposal) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Proposal not found" });
      }

      if (!proposal.coopId || proposal.coopId !== ctx.coopId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Council role must be verified for this proposal's commons." });
      }

      if (!proposal.councilRequired) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Council vote not required for this proposal" });
      }

      // Votes only count while the proposal is still open. Once it's decided
      // (or withdrawn), a late vote must not change the recorded result.
      const closedStatuses: string[] = ["APPROVED", "REJECTED", "FUNDED", "FAILED", "WITHDRAWN"];
      if (closedStatuses.includes(proposal.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Voting on this proposal has closed." });
      }
      // The voting window has run out, even if nobody has marked it decided yet.
      const votingEndsAt = effectiveVotingEndsAt(proposal);
      if (votingEndsAt && votingEndsAt.getTime() <= Date.now()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Voting on this proposal has closed." });
      }

      // Upsert vote
      await ctx.db.proposalVote.upsert({
        where: { proposalId_voterWallet: { proposalId: input.proposalId, voterWallet: walletAddress } },
        create: {
          proposalId: input.proposalId,
          voterWallet: walletAddress,
          vote: input.vote as VoteType,
        },
        update: {
          vote: input.vote as VoteType,
        },
      });

      // Count votes
      const [forCount, againstCount, abstainCount] = await Promise.all([
        ctx.db.proposalVote.count({ where: { proposalId: input.proposalId, vote: "FOR" } }),
        ctx.db.proposalVote.count({ where: { proposalId: input.proposalId, vote: "AGAINST" } }),
        ctx.db.proposalVote.count({ where: { proposalId: input.proposalId, vote: "ABSTAIN" } }),
      ]);

      const totalVotes = forCount + againstCount + abstainCount;
      let newStatus: string | null = null;

      // Auto-decide if enough votes
      if (totalVotes >= 2) {
        if (forCount > againstCount) {
          await ctx.db.proposal.update({
            where: { id: input.proposalId },
            data: { status: ProposalStatus.APPROVED },
          });
          newStatus = "approved";
          await trackOutcomesIfDecided(input.proposalId, ProposalStatus.APPROVED);
        } else if (againstCount > forCount) {
          await ctx.db.proposal.update({
            where: { id: input.proposalId },
            data: { status: ProposalStatus.REJECTED },
          });
          newStatus = "rejected";
        }
      }

      return { vote: input.vote, forCount, againstCount, abstainCount, newStatus };
    }),

  /**
   * Get proposals by proposer wallet
   */
  getByProposer: publicProcedure
    .input(z.object({
      wallet: z.string(),
      coopId: z.string().optional(),
      limit: z.number().min(1).max(50).default(10),
      offset: z.number().min(0).default(0)
    }))
    .output(z.object({
      proposals: z.array(ProposalOutputZ),
      total: z.number()
    }))
    .query(async ({ input, ctx }) => {
      const where = {
        proposerWallet: input.wallet,
        ...(input.coopId && { coopId: input.coopId }),
      };

      const [proposals, total] = await Promise.all([
        ctx.db.proposal.findMany({
          where,
          skip: input.offset,
          take: input.limit,
          orderBy: { createdAt: 'desc' },
          include: {
            kpis: true,
            auditChecks: true
          }
        }),
        ctx.db.proposal.count({
          where
        })
      ]);

      return {
        proposals: proposals.map(mapDbToOutput),
        total
      };
    }),

  /**
   * Get proposals by region
   */
  getByRegion: publicProcedure
    .input(z.object({
      regionCode: z.string(),
      limit: z.number().min(1).max(50).default(10),
      offset: z.number().min(0).default(0)
    }))
    .output(z.object({
      proposals: z.array(ProposalOutputZ),
      total: z.number()
    }))
    .query(async ({ input, ctx }) => {
      const [proposals, total] = await Promise.all([
        ctx.db.proposal.findMany({
          where: { regionCode: input.regionCode },
          skip: input.offset,
          take: input.limit,
          orderBy: { createdAt: 'desc' },
          include: {
            kpis: true,
            auditChecks: true
          }
        }),
        ctx.db.proposal.count({
          where: { regionCode: input.regionCode }
        })
      ]);

      return {
        proposals: proposals.map(mapDbToOutput),
        total
      };
    }),

  /**
   * Resubmit a proposal with edited text — re-runs the full engine pipeline.
   * Only the original proposer can resubmit, and only while status is SUBMITTED.
   */
  resubmit: authenticatedProcedure
    .input(z.object({
      proposalId: z.string().min(1),
      text: z.string().min(10),
    }))
    .output(ProposalOutputZ)
    .mutation(async ({ input, ctx }) => {
      const { walletAddress } = ctx as AuthenticatedContext;

      const existing = await ctx.db.proposal.findUnique({
        where: { id: input.proposalId },
        include: { kpis: true, auditChecks: true },
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Proposal not found." });
      if (existing.proposerWallet !== walletAddress) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the original proposer can edit this proposal." });
      }
      if (!["SUBMITTED", "VOTABLE"].includes(existing.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only submitted or votable proposals can be edited." });
      }

      if (!existing.coopId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Proposal has no coopId - cannot edit",
        });
      }
      
      const coopId = existing.coopId;
      let configData: CoopConfigData | undefined;
      let aiAutoApproveThreshold = 500;
      let councilVoteThreshold = 5000;
      const coopConfig = await ctx.db.coopConfig.findFirst({
        where: { coopId, isActive: true },
        orderBy: { version: "desc" },
      });
      if (coopConfig) {
        aiAutoApproveThreshold = coopConfig.aiAutoApproveThresholdUSD ?? 500;
        councilVoteThreshold = coopConfig.councilVoteThresholdUSD ?? 5000;
        configData = {
          charterText: coopConfig.charterText,
          missionGoals: coopConfig.missionGoals as Array<{ key: string; label: string; priorityWeight: number; description?: string }>,
          structuralWeights: coopConfig.structuralWeights as { feasibility: number; risk: number; accountability: number },
          scoreMix: coopConfig.scoreMix as { missionWeight: number; structuralWeight: number },
          screeningPassThreshold: coopConfig.screeningPassThreshold,
          proposalCategories: coopConfig.proposalCategories as Array<{ key: string; label: string; isActive: boolean }>,
          sectorExclusions: (coopConfig.sectorExclusions as Array<string | { value: string; description?: string }>)
            .map(e => typeof e === "string" ? { value: e } : e),
          quorumPercent: coopConfig.quorumPercent,
          approvalThresholdPercent: coopConfig.approvalThresholdPercent,
          votingWindowDays: coopConfig.votingWindowDays,
          scorerAgents: ((coopConfig as any).scorerAgents as any[] | undefined) ?? [],
          strongGoalThreshold: (coopConfig as any).strongGoalThreshold ?? 0.70,
          missionMinThreshold: (coopConfig as any).missionMinThreshold ?? 0.50,
          structuralGate: (coopConfig as any).structuralGate ?? 0.65,
        };

        configData.expertCalibration = await fetchExpertCalibration(ctx.db, coopId);
      }

      const proposalInputCheck = cleanseUntrustedText(input.text, { maxChars: 10_000 });
      const proposalInput = {
        text: proposalInputCheck.text,
        proposer: {
          wallet: existing.proposerWallet,
          role: existing.proposerRole.toLowerCase() as "member" | "merchant" | "anchor" | "bot",
          displayName: existing.proposerDisplayName ?? undefined,
        },
        region: { code: existing.regionCode, name: existing.regionName },
        coopId,
      };

      const processedProposal = await withCostedProposalRun(coopId, "proposal-engine", () => proposalEngine.processProposal(proposalInput, configData, priorOutcomeLookup(coopId, input.proposalId)))
        .catch(async (error: unknown) => {
          await saveProposalTrail(() => buildProposalEngineFailureTrail(
            { coopId, proposalId: input.proposalId, trigger: "PROPOSAL_RESUBMITTED", rawText: input.text }, error,
          ));
          throw error;
        });
      const budget = processedProposal.budget.amountRequested;
      let finalStatus: ProposalStatus;
      let councilRequired = false;

      if (processedProposal.decision === "advance") {
        if (budget < aiAutoApproveThreshold) {
          finalStatus = ProposalStatus.APPROVED;
        } else if (budget < councilVoteThreshold) {
          finalStatus = ProposalStatus.VOTABLE;
          councilRequired = true;
        } else {
          finalStatus = ProposalStatus.VOTABLE;
          councilRequired = true;
        }
      } else {
        finalStatus = processedProposal.status.toUpperCase() as ProposalStatus;
      }
      // Text that tries to instruct the reviewer never gets the no-vote auto-approval.
      const autoApproveBlocked = isSteeringAttempt(proposalInputCheck.flags) && finalStatus === ProposalStatus.APPROVED;
      if (autoApproveBlocked) {
        finalStatus = ProposalStatus.VOTABLE;
        councilRequired = true;
      }

      // Delete old audit checks and rebuild
      await ctx.db.proposalAuditCheck.deleteMany({ where: { proposalId: input.proposalId } });
      // Only submitted or votable proposals are re-reviewed, so no KPI has a result yet.
      await ctx.db.proposalKPI.deleteMany({ where: { proposalId: input.proposalId } });

      const updated = await ctx.db.proposal.update({
        where: { id: input.proposalId },
        data: {
          title: processedProposal.title,
          summary: processedProposal.summary,
          category: normalizeDbCategory(processedProposal.category),
          regionCode: processedProposal.region.code,
          regionName: processedProposal.region.name,
          budgetCurrency: processedProposal.budget.currency.toUpperCase() as Currency,
          budgetAmount: processedProposal.budget.amountRequested,
          quorumPercent: processedProposal.governance.quorumPercent,
          approvalThresholdPercent: processedProposal.governance.approvalThresholdPercent,
          votingWindowDays: processedProposal.governance.votingWindowDays,
          engineVersion: processedProposal.audit.engineVersion,
          status: finalStatus,
          votingEndsAt: votingEndsAtFor(finalStatus, processedProposal.governance.votingWindowDays),
          councilRequired,
          evaluation: processedProposal.evaluation as any,
          rawText: input.text,
          categoryKey: processedProposal.category,
          alternatives: processedProposal.alternatives ?? undefined,
          bestAlternative: processedProposal.bestAlternative ?? undefined,
          decision: processedProposal.decision,
          decisionReasons: processedProposal.decisionReasons ?? [],
          missingData: processedProposal.missing_data ?? undefined,
          priorOutcomes: processedProposal.priorOutcomes ?? [],
          ...(processedProposal.kpis?.length ? { kpis: { createMany: { data: kpiRows(processedProposal.kpis) } } } : {}),
          auditChecks: {
            createMany: {
              data: processedProposal.audit.checks.map((check: any) => ({
                name: check.name,
                passed: check.passed,
                note: check.note,
              })),
            },
          },
        },
        include: { kpis: true, auditChecks: true },
      });

      await trackOutcomesIfDecided(input.proposalId, finalStatus);

      // Save revision snapshot for this resubmission
      const revCount = await ctx.db.proposalRevision.count({ where: { proposalId: input.proposalId } });
      await saveRevision(ctx.db, input.proposalId, revCount + 1, processedProposal, finalStatus, input.text, configData);
      await saveProposalTrail(() => buildProposalEngineTrail(processedProposal, {
        coopId, proposalId: input.proposalId, trigger: "PROPOSAL_RESUBMITTED", rawText: input.text,
        ...proposalTrailSettings(coopConfig, configData), finalStatus, councilRequired,
        inputCheck: proposalInputCheck, autoApproveBlocked,
      }));

      return mapDbToOutput(updated);
    }),

  /**
   * Apply an AI-suggested alternative to a proposal.
   * The engine rewrites the proposal text to incorporate the alternative's changes,
   * then re-runs the full evaluation pipeline.
   */
  applyAlternative: authenticatedProcedure
    .input(z.object({
      proposalId: z.string().min(1),
      alternativeIndex: z.number().int().min(0),
    }))
    .output(ProposalOutputZ)
    .mutation(async ({ input, ctx }) => {
      const { walletAddress } = ctx as AuthenticatedContext;

      const existing = await ctx.db.proposal.findUnique({
        where: { id: input.proposalId },
        include: { kpis: true, auditChecks: true },
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Proposal not found." });
      if (existing.proposerWallet !== walletAddress) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the original proposer can apply an alternative." });
      }
      if (!["SUBMITTED", "VOTABLE"].includes(existing.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only submitted or votable proposals can be revised." });
      }

      const alternatives = (existing.alternatives as any[]) ?? [];
      const alternative = alternatives[input.alternativeIndex];
      if (!alternative) throw new TRPCError({ code: "BAD_REQUEST", message: "Alternative not found." });

      const originalText = existing.rawText || existing.summary;
      if (!originalText) throw new TRPCError({ code: "BAD_REQUEST", message: "No original text available for rewriting." });

      // Ask the AI to rewrite the proposal to incorporate the alternative's changes
      const originalCheck = cleanseUntrustedText(originalText, { maxChars: 10_000 });
      const rewrittenText = await withCostedProposalRun(existing.coopId, "proposal-rewrite", () => proposalEngine.rewriteWithAlternative(originalCheck.text, {
        label: alternative.label ?? "",
        rationale: alternative.rationale ?? "",
        changes: alternative.changes ?? [],
      }));

      // Now resubmit through the full engine pipeline with the rewritten text
      if (!existing.coopId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Proposal has no coopId - cannot resubmit",
        });
      }
      
      const coopId = existing.coopId;
      let configData: CoopConfigData | undefined;
      let aiAutoApproveThreshold = 500;
      let councilVoteThreshold = 5000;
      const coopConfig = await ctx.db.coopConfig.findFirst({
        where: { coopId, isActive: true },
        orderBy: { version: "desc" },
      });
      if (coopConfig) {
        aiAutoApproveThreshold = coopConfig.aiAutoApproveThresholdUSD ?? 500;
        councilVoteThreshold = coopConfig.councilVoteThresholdUSD ?? 5000;
        configData = {
          charterText: coopConfig.charterText,
          missionGoals: coopConfig.missionGoals as Array<{ key: string; label: string; priorityWeight: number; description?: string }>,
          structuralWeights: coopConfig.structuralWeights as { feasibility: number; risk: number; accountability: number },
          scoreMix: coopConfig.scoreMix as { missionWeight: number; structuralWeight: number },
          screeningPassThreshold: coopConfig.screeningPassThreshold,
          proposalCategories: coopConfig.proposalCategories as Array<{ key: string; label: string; isActive: boolean }>,
          sectorExclusions: (coopConfig.sectorExclusions as Array<string | { value: string; description?: string }>)
            .map(e => typeof e === "string" ? { value: e } : e),
          quorumPercent: coopConfig.quorumPercent,
          approvalThresholdPercent: coopConfig.approvalThresholdPercent,
          votingWindowDays: coopConfig.votingWindowDays,
          scorerAgents: ((coopConfig as any).scorerAgents as any[] | undefined) ?? [],
          strongGoalThreshold: (coopConfig as any).strongGoalThreshold ?? 0.70,
          missionMinThreshold: (coopConfig as any).missionMinThreshold ?? 0.50,
          structuralGate: (coopConfig as any).structuralGate ?? 0.65,
        };

        configData.expertCalibration = await fetchExpertCalibration(ctx.db, coopId);
      }

      const proposalInputCheck = mergeFlagsWithText(originalCheck, cleanseUntrustedText(rewrittenText, { maxChars: 10_000 }));
      const proposalInput = {
        text: proposalInputCheck.text,
        proposer: {
          wallet: existing.proposerWallet,
          role: existing.proposerRole.toLowerCase() as "member" | "merchant" | "anchor" | "bot",
          displayName: existing.proposerDisplayName ?? undefined,
        },
        region: { code: existing.regionCode, name: existing.regionName },
        coopId,
      };

      const processedProposal = await withCostedProposalRun(coopId, "proposal-engine", () => proposalEngine.processProposal(proposalInput, configData, priorOutcomeLookup(coopId, input.proposalId)))
        .catch(async (error: unknown) => {
          await saveProposalTrail(() => buildProposalEngineFailureTrail(
            { coopId, proposalId: input.proposalId, trigger: "PROPOSAL_ALTERNATIVE_APPLIED", rawText: rewrittenText }, error,
          ));
          throw error;
        });
      const budget = processedProposal.budget.amountRequested;
      let finalStatus: ProposalStatus;
      let councilRequired = false;

      if (processedProposal.decision === "advance") {
        if (budget < aiAutoApproveThreshold) {
          finalStatus = ProposalStatus.APPROVED;
        } else if (budget < councilVoteThreshold) {
          finalStatus = ProposalStatus.VOTABLE;
          councilRequired = true;
        } else {
          finalStatus = ProposalStatus.VOTABLE;
          councilRequired = true;
        }
      } else {
        finalStatus = processedProposal.status.toUpperCase() as ProposalStatus;
      }
      // Text that tries to instruct the reviewer never gets the no-vote auto-approval.
      const autoApproveBlocked = isSteeringAttempt(proposalInputCheck.flags) && finalStatus === ProposalStatus.APPROVED;
      if (autoApproveBlocked) {
        finalStatus = ProposalStatus.VOTABLE;
        councilRequired = true;
      }

      await ctx.db.proposalAuditCheck.deleteMany({ where: { proposalId: input.proposalId } });
      // Only submitted or votable proposals are re-reviewed, so no KPI has a result yet.
      await ctx.db.proposalKPI.deleteMany({ where: { proposalId: input.proposalId } });

      const updated = await ctx.db.proposal.update({
        where: { id: input.proposalId },
        data: {
          title: processedProposal.title,
          summary: processedProposal.summary,
          category: normalizeDbCategory(processedProposal.category),
          regionCode: processedProposal.region.code,
          regionName: processedProposal.region.name,
          budgetCurrency: processedProposal.budget.currency.toUpperCase() as Currency,
          budgetAmount: processedProposal.budget.amountRequested,
          quorumPercent: processedProposal.governance.quorumPercent,
          approvalThresholdPercent: processedProposal.governance.approvalThresholdPercent,
          votingWindowDays: processedProposal.governance.votingWindowDays,
          engineVersion: processedProposal.audit.engineVersion,
          status: finalStatus,
          votingEndsAt: votingEndsAtFor(finalStatus, processedProposal.governance.votingWindowDays),
          councilRequired,
          evaluation: processedProposal.evaluation as any,
          rawText: rewrittenText,
          categoryKey: processedProposal.category,
          alternatives: processedProposal.alternatives ?? undefined,
          bestAlternative: processedProposal.bestAlternative ?? undefined,
          decision: processedProposal.decision,
          decisionReasons: processedProposal.decisionReasons ?? [],
          missingData: processedProposal.missing_data ?? undefined,
          priorOutcomes: processedProposal.priorOutcomes ?? [],
          ...(processedProposal.kpis?.length ? { kpis: { createMany: { data: kpiRows(processedProposal.kpis) } } } : {}),
          auditChecks: {
            createMany: {
              data: processedProposal.audit.checks.map((check: any) => ({
                name: check.name,
                passed: check.passed,
                note: check.note,
              })),
            },
          },
        },
        include: { kpis: true, auditChecks: true },
      });

      await trackOutcomesIfDecided(input.proposalId, finalStatus);

      // Save revision snapshot for this alternative application
      const revCount = await ctx.db.proposalRevision.count({ where: { proposalId: input.proposalId } });
      await saveRevision(ctx.db, input.proposalId, revCount + 1, processedProposal, finalStatus, rewrittenText, configData);
      await saveProposalTrail(() => buildProposalEngineTrail(processedProposal, {
        coopId, proposalId: input.proposalId, trigger: "PROPOSAL_ALTERNATIVE_APPLIED", rawText: rewrittenText,
        ...proposalTrailSettings(coopConfig, configData), finalStatus, councilRequired,
        inputCheck: proposalInputCheck, autoApproveBlocked,
        rewrite: { label: String(alternative.label ?? ""), rationale: String(alternative.rationale ?? "") },
      }));

      return mapDbToOutput(updated);
    }),

  /**
   * The proposal's author reports how one of its goals turned out, once its measure date has passed.
   * `actualValue` null means they couldn't measure it. Code decides met / partly met / missed; the
   * result is shown on the proposal and remembered for similar proposals later.
   */
  reportKpiOutcome: authenticatedProcedure
    .input(z.object({
      kpiId: z.string().min(1),
      actualValue: z.number().nonnegative().finite().nullable(),
      note: z.string().max(500).optional(),
    }))
    .output(ProposalOutputZ)
    .mutation(async ({ input, ctx }) => {
      const { walletAddress } = ctx as AuthenticatedContext;
      const userId = await userIdForWallet(ctx.db, walletAddress);
      if (!userId) throw new TRPCError({ code: "FORBIDDEN", message: "Only the proposal's author can report its results." });
      try {
        const kpi = await reportKpiOutcome({ kpiId: input.kpiId, userId, actualValue: input.actualValue, note: input.note });
        const proposal = await ctx.db.proposal.findUnique({ where: { id: kpi.proposalId }, include: { kpis: true, auditChecks: true } });
        return mapDbToOutput(proposal);
      } catch (error) {
        if (error instanceof OutcomeReportError) throw new TRPCError({ code: error.code, message: error.message });
        throw error;
      }
    }),

  /**
   * Get the full submission audit trail for a proposal (all revisions, oldest first)
   */
  getRevisions: publicProcedure
    .input(z.object({ proposalId: z.string() }))
    .query(async ({ input, ctx }) => {
      const revisions = await ctx.db.proposalRevision.findMany({
        where: { proposalId: input.proposalId },
        orderBy: { revisionNumber: "asc" },
      });
      return revisions.map(r => ({
        id: r.id,
        revisionNumber: r.revisionNumber,
        submittedAt: r.submittedAt.toISOString(),
        rawText: r.rawText ?? undefined,
        evaluation: r.evaluation as any,
        decision: r.decision ?? undefined,
        decisionReasons: r.decisionReasons,
        auditChecks: (r.auditChecks as any[]) ?? [],
        status: r.status,
        engineVersion: r.engineVersion,
      }));
    }),

  /**
   * Test endpoint to verify engine functionality
   */
  testEngine: publicProcedure
    .output(ProposalOutputZ)
    .query(async () => {
      const testInput = {
        text: "Hampton Grocery Anchor: Fund a small-format grocery to reduce external food spend and increase UC usage. Budget needed: $150,000 USD. Located in Hampton Roads, VA. Expected to reduce economic leakage by $1,000,000 annually and create 12 jobs over 12 months. Target 750,000 USD in local spend retained and 200,000 UC in transactions.",
        proposer: { wallet: "0xabc123", role: "bot" as const, displayName: "SuggestionBot" },
        region: { code: "VA-HAMPTON", name: "Hampton Roads, VA" },
      };

      return withCostedProposalRun(null, "proposal-engine-test", () => proposalEngine.processProposal(testInput));
    })
});

// Persist a snapshot of a processed proposal as a revision in the audit trail
/**
 * Fetches recent expert score overrides and groups them by domain so they can
 * be injected into each domain agent's prompt as calibration examples.
 * Pulls up to `limit` rows per domain (most recent first) from proposals that
 * belong to the same coop.
 */
async function fetchExpertCalibration(
  db: any,
  coopId: string,
  limit = 5,
): Promise<Record<string, Array<{ goalId: string; aiScore: number; expertScore: number; reason: string }>>> {
  // Find all proposalIds for this coop by joining via charterVersionId → CoopConfig
  const coopConfigIds = await db.coopConfig.findMany({
    where: { coopId },
    select: { id: true },
  });
  const configIdSet = new Set(coopConfigIds.map((c: { id: string }) => c.id));

  // Fetch proposals linked to this coop's config
  const proposals = await db.proposal.findMany({
    where: { charterVersionId: { in: [...configIdSet] } },
    select: { id: true },
  });
  const proposalIds = proposals.map((p: { id: string }) => p.id);
  if (proposalIds.length === 0) return {};

  // Fetch recent goal scores that have an expert override
  const expertScores = await db.proposalGoalScore.findMany({
    where: {
      proposalId: { in: proposalIds },
      expertScore: { not: null },
    },
    orderBy: { updatedAt: "desc" },
    take: limit * 20, // over-fetch then trim per domain
    select: {
      domain: true,
      goalId: true,
      aiScore: true,
      expertScore: true,
      expertReason: true,
    },
  });

  // Group by domain, cap at `limit` per domain
  const calibration: Record<string, Array<{ goalId: string; aiScore: number; expertScore: number; reason: string }>> = {};
  for (const row of expertScores) {
    if (!calibration[row.domain]) calibration[row.domain] = [];
    if (calibration[row.domain].length < limit) {
      calibration[row.domain].push({
        goalId: row.goalId,
        aiScore: row.aiScore,
        expertScore: row.expertScore as number,
        reason: row.expertReason ?? "",
      });
    }
  }
  return calibration;
}

async function saveRevision(
  db: any,
  proposalId: string,
  revisionNumber: number,
  processedProposal: any,
  finalStatus: string,
  rawText: string,
  /** Config passed to the engine — used to resolve domain per goal */
  configData?: { missionGoals?: { key: string; domain?: string }[]; scorerAgents?: { agentKey: string; enabled?: boolean }[] },
) {
  await db.proposalRevision.create({
    data: {
      proposalId,
      revisionNumber,
      rawText,
      evaluation: processedProposal.evaluation ?? null,
      decision: processedProposal.decision ?? null,
      decisionReasons: processedProposal.decisionReasons ?? [],
      auditChecks: processedProposal.audit.checks.map((c: any) => ({
        name: c.name,
        passed: c.passed,
        note: c.note ?? null,
      })),
      status: finalStatus.toLowerCase(),
      engineVersion: processedProposal.audit.engineVersion,
    },
  });

  // Persist per-goal AI scores for this revision
  const missionScores: { goal_id: string; impact_score: number }[] =
    processedProposal.evaluation?.mission_impact_scores ?? [];

  if (missionScores.length > 0) {
    const enabledAgentKeys = new Set(
      (configData?.scorerAgents ?? []).filter((a: any) => a.enabled !== false).map((a: any) => a.agentKey)
    );
    const goalDomainMap = new Map(
      (configData?.missionGoals ?? []).map((g: any) => [
        g.key,
        (g.domain && enabledAgentKeys.has(g.domain)) ? g.domain : "general",
      ])
    );

    // Delete any stale rows (idempotent for retries)
    await db.proposalGoalScore.deleteMany({ where: { proposalId, revisionNumber } });

    await db.proposalGoalScore.createMany({
      data: missionScores.map((ms: { goal_id: string; impact_score: number }) => ({
        proposalId,
        revisionNumber,
        goalId: ms.goal_id,
        domain: goalDomainMap.get(ms.goal_id) ?? "general",
        aiScore: ms.impact_score,
        finalScore: ms.impact_score, // no expert override yet
      })),
    });
  }
}

// Helper function to map database records to output format
function mapDbToOutput(dbRecord: any): ProposalOutput {
  return {
    id: dbRecord.id,
    createdAt: dbRecord.createdAt.toISOString(),
    updatedAt: dbRecord.updatedAt ? dbRecord.updatedAt.toISOString() : null,
    status: dbRecord.status.toLowerCase(),
    coopId: dbRecord.coopId ?? null,
    votingEndsAt: effectiveVotingEndsAt(dbRecord)?.toISOString() ?? null,
    title: dbRecord.title,
    summary: dbRecord.summary,
    category: (dbRecord.categoryKey ?? dbRecord.category.toLowerCase()),
    proposer: {
      wallet: dbRecord.proposerWallet,
      role: dbRecord.proposerRole.toLowerCase(),
      displayName: dbRecord.proposerDisplayName
    },
    region: {
      code: dbRecord.regionCode,
      name: dbRecord.regionName
    },
    budget: {
      currency: dbRecord.budgetCurrency === "MIXED" ? "mixed" : dbRecord.budgetCurrency,
      amountRequested: dbRecord.budgetAmount
    },
    evaluation: (dbRecord.evaluation as any) ?? {
      structural_scores: {
        goal_mapping_valid: true,
        feasibility_score: 0.5,
        risk_score: 0.5,
        accountability_score: 0.5,
      },
      mission_impact_scores: [],
      computed_scores: {
        mission_weighted_score: 0.5,
        structural_weighted_score: 0.5,
        overall_score: 0.5,
        passes_threshold: false,
      },
      violations: [],
      risk_flags: [],
      llm_summary: "",
    },
    charterVersionId: dbRecord.charterVersionId ?? undefined,
    governance: {
      quorumPercent: dbRecord.quorumPercent,
      approvalThresholdPercent: dbRecord.approvalThresholdPercent,
      votingWindowDays: dbRecord.votingWindowDays,
    },
    audit: {
      engineVersion: dbRecord.engineVersion,
      checks: (dbRecord.auditChecks || []).map((check: any) => ({
        name: check.name,
        passed: check.passed,
        note: check.note,
      })),
    },
    alternatives: dbRecord.alternatives ?? [],
    bestAlternative: dbRecord.bestAlternative ?? undefined,
    decision: dbRecord.decision ?? "advance",
    decisionReasons: dbRecord.decisionReasons ?? [],
    missing_data: dbRecord.missingData ?? [],
    councilRequired: dbRecord.councilRequired ?? false,
    rawText: dbRecord.rawText ?? undefined,
    kpis: (dbRecord.kpis ?? []).map((kpi: any) => ({
      id: kpi.id,
      name: kpi.name,
      target: kpi.target,
      unit: kpiUnitFromDb(kpi.unit),
      higherIsBetter: kpi.higherIsBetter ?? true,
      measureAfterDays: kpi.measureAfterDays ?? 90,
      measureBy: kpi.measureBy ? kpi.measureBy.toISOString() : null,
      outcome: kpi.outcome ?? null,
      actualValue: kpi.actualValue ?? null,
      outcomeNote: kpi.outcomeNote ?? null,
      verification: kpi.verification ?? null,
      outcomeRecordedAt: kpi.outcomeRecordedAt ? kpi.outcomeRecordedAt.toISOString() : null,
    })),
    priorOutcomes: Array.isArray(dbRecord.priorOutcomes) ? dbRecord.priorOutcomes : [],
  };
}
