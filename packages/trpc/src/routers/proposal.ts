import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router } from "../trpc.js";
import { authenticatedProcedure, publicProcedure, privateProcedure } from "../procedures/index.js";
import { ProposalInputZ, ProposalOutputZ, proposalEngine, type ProposalOutput } from "@repo/validators";
import type { CoopConfigData } from "@repo/validators";
import { ProposalCategory, ProposalStatus, ProposerRole, Currency, VoteType } from "@repo/db";
import type { AuthenticatedContext } from "../context.js";

function normalizeDbCategory(categoryKey: string): ProposalCategory {
  const key = categoryKey.toUpperCase();
  const values = Object.values(ProposalCategory) as string[];
  return values.includes(key) ? (key as ProposalCategory) : ProposalCategory.OTHER;
}

export const proposalRouter = router({
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

      // Process proposal through AI engine — save raw proposal first if engine fails
      let processedProposal: Awaited<ReturnType<typeof proposalEngine.processProposal>> | null = null;
      let aiError: unknown = null;
      try {
        processedProposal = await proposalEngine.processProposal(input, configData);
      } catch (err) {
        aiError = err;
        console.error(`⚠️ [proposal.create] AI engine failed — saving raw proposal for async review:`, err);
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

      if (newStatus === ProposalStatus.WITHDRAWN) {
        const { walletAddress: adminWallet } = ctx as AuthenticatedContext;
        updateData.withdrawnAt = new Date();
        updateData.withdrawnBy = adminWallet;
      }

      const updated = await ctx.db.proposal.update({
        where: { id: input.id },
        data: updateData,
        include: { kpis: true, auditChecks: true }
      });

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

      if (!proposal.councilRequired) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Council vote not required for this proposal" });
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
          where: { proposerWallet: input.wallet },
          skip: input.offset,
          take: input.limit,
          orderBy: { createdAt: 'desc' },
          include: {
            kpis: true,
            auditChecks: true
          }
        }),
        ctx.db.proposal.count({
          where: { proposerWallet: input.wallet }
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

      const proposalInput = {
        text: input.text,
        proposer: {
          wallet: existing.proposerWallet,
          role: existing.proposerRole.toLowerCase() as "member" | "merchant" | "anchor" | "bot",
          displayName: existing.proposerDisplayName ?? undefined,
        },
        region: { code: existing.regionCode, name: existing.regionName },
        coopId,
      };

      const processedProposal = await proposalEngine.processProposal(proposalInput, configData);
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

      // Delete old audit checks and rebuild
      await ctx.db.proposalAuditCheck.deleteMany({ where: { proposalId: input.proposalId } });

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
          councilRequired,
          evaluation: processedProposal.evaluation as any,
          rawText: input.text,
          categoryKey: processedProposal.category,
          alternatives: processedProposal.alternatives ?? undefined,
          bestAlternative: processedProposal.bestAlternative ?? undefined,
          decision: processedProposal.decision,
          decisionReasons: processedProposal.decisionReasons ?? [],
          missingData: processedProposal.missing_data ?? undefined,
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

      // Save revision snapshot for this resubmission
      const revCount = await ctx.db.proposalRevision.count({ where: { proposalId: input.proposalId } });
      await saveRevision(ctx.db, input.proposalId, revCount + 1, processedProposal, finalStatus, input.text, configData);

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
      const rewrittenText = await proposalEngine.rewriteWithAlternative(originalText, {
        label: alternative.label ?? "",
        rationale: alternative.rationale ?? "",
        changes: alternative.changes ?? [],
      });

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

      const proposalInput = {
        text: rewrittenText,
        proposer: {
          wallet: existing.proposerWallet,
          role: existing.proposerRole.toLowerCase() as "member" | "merchant" | "anchor" | "bot",
          displayName: existing.proposerDisplayName ?? undefined,
        },
        region: { code: existing.regionCode, name: existing.regionName },
        coopId,
      };

      const processedProposal = await proposalEngine.processProposal(proposalInput, configData);
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

      await ctx.db.proposalAuditCheck.deleteMany({ where: { proposalId: input.proposalId } });

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
          councilRequired,
          evaluation: processedProposal.evaluation as any,
          rawText: rewrittenText,
          categoryKey: processedProposal.category,
          alternatives: processedProposal.alternatives ?? undefined,
          bestAlternative: processedProposal.bestAlternative ?? undefined,
          decision: processedProposal.decision,
          decisionReasons: processedProposal.decisionReasons ?? [],
          missingData: processedProposal.missing_data ?? undefined,
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

      // Save revision snapshot for this alternative application
      const revCount = await ctx.db.proposalRevision.count({ where: { proposalId: input.proposalId } });
      await saveRevision(ctx.db, input.proposalId, revCount + 1, processedProposal, finalStatus, rewrittenText, configData);

      return mapDbToOutput(updated);
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

      return proposalEngine.processProposal(testInput);
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
    status: dbRecord.status.toLowerCase(),
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
  };
}
