import { z } from "zod";
import { router } from "../trpc.js";
import { publicProcedure, privateProcedure } from "../procedures/index.js";
import { CoopConfigInputZ, CoopConfigOutputZ, type CoopConfigOutput } from "@repo/validators";
import type { CoopConfig, Prisma } from "@repo/db";
import type { AuthenticatedContext } from "../context.js";
import { linkExternalWalletToUser } from "../services/wallet-service.js";

function mapDbToConfigOutput(record: CoopConfig): CoopConfigOutput {
  return {
    id: record.id,
    coopId: record.coopId,
    version: record.version,
    isActive: record.isActive,
    charterText: record.charterText,
    missionGoals: record.missionGoals as Array<{ key: string; label: string; priorityWeight: number; description?: string; domain?: string; expertRequired?: boolean; scoringRubric?: string }>,
    structuralWeights: record.structuralWeights as { feasibility: number; risk: number; accountability: number },
    scoreMix: record.scoreMix as { missionWeight: number; structuralWeight: number },
    screeningPassThreshold: record.screeningPassThreshold,
    quorumPercent: record.quorumPercent,
    approvalThresholdPercent: record.approvalThresholdPercent,
    votingWindowDays: record.votingWindowDays,
    scVotingCapPercent: record.scVotingCapPercent,
    proposalCategories: record.proposalCategories as Array<{ key: string; label: string; isActive: boolean }>,
    // Normalize legacy string[] → { value, description? }[] transparently
    sectorExclusions: (record.sectorExclusions as Array<string | { value: string; description?: string }>)
      .map(e => typeof e === "string" ? { value: e } : e),
    scorerAgents: ((record as any).scorerAgents as Array<{ agentKey: string; label: string; enabled: boolean; promptTemplate?: string; model?: string }> | undefined) ?? [],
    minScBalanceToSubmit: record.minScBalanceToSubmit,
    aiAutoApproveThresholdUSD: record.aiAutoApproveThresholdUSD ?? 500,
    councilVoteThresholdUSD: record.councilVoteThresholdUSD ?? 5000,
    strongGoalThreshold: record.strongGoalThreshold,
    missionMinThreshold: record.missionMinThreshold,
    structuralGate: record.structuralGate,
    createdAt: record.createdAt instanceof Date ? record.createdAt.toISOString() : record.createdAt,
    updatedAt: record.updatedAt instanceof Date ? record.updatedAt.toISOString() : record.updatedAt,
    createdBy: record.createdBy,
    // Display/onboarding fields
    name: record.name ?? undefined,
    slug: record.slug ?? undefined,
    tagline: record.tagline ?? undefined,
    description: record.description ?? undefined,
    displayMission: record.displayMission ?? undefined,
    displayFeatures: (record.displayFeatures as Array<{ title: string; description: string }> | null) ?? undefined,
    eligibility: record.eligibility ?? undefined,
    bgColor: record.bgColor ?? undefined,
    accentColor: record.accentColor ?? undefined,
    displayOrder: record.displayOrder ?? undefined,
    applicationQuestions: (record.applicationQuestions as any[] | null) ?? undefined,
    chainId: record.chainId ?? undefined,
    chainName: record.chainName ?? undefined,
    rpcUrl: record.rpcUrl ?? undefined,
    scTokenAddress: record.scTokenAddress ?? undefined,
    allyTokenAddress: record.allyTokenAddress ?? undefined,
    ucTokenAddress: record.ucTokenAddress ?? undefined,
    redemptionVaultAddress: record.redemptionVaultAddress ?? undefined,
    treasurySafeAddress: record.treasurySafeAddress ?? undefined,
    verifiedStoreRegistryAddress: record.verifiedStoreRegistryAddress ?? undefined,
    storePaymentRouterAddress: record.storePaymentRouterAddress ?? undefined,
    rewardEngineAddress: record.rewardEngineAddress ?? undefined,
    backendWalletAddress: record.backendWalletAddress ?? undefined,
    scTokenSymbol: record.scTokenSymbol ?? undefined,
    scTokenName: record.scTokenName ?? undefined,
  };
}

function computeDiff(oldConfig: CoopConfig, newFields: Record<string, unknown>): { field: string; before: unknown; after: unknown }[] {
  const diff: { field: string; before: unknown; after: unknown }[] = [];
  for (const [field, after] of Object.entries(newFields)) {
    const before = (oldConfig as Record<string, unknown>)[field];
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      diff.push({ field, before, after });
    }
  }
  return diff;
}

async function nextSequence(db: any, coopConfigId: string): Promise<number> {
  const last = await db.coopConfigAudit.findFirst({
    where: { coopConfigId, status: "APPLIED" },
    orderBy: { sequence: "desc" },
    select: { sequence: true },
  });
  return (last?.sequence ?? 0) + 1;
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

export const coopConfigRouter = router({
  /**
   * List active coops for public display (landing page)
   */
  listActiveCoops: publicProcedure
    .output(z.array(z.object({
      coopId: z.string(),
      name: z.string(),
      tagline: z.string().nullable(),
      description: z.string().nullable(),
      isLive: z.boolean(),
      hasPublishedPublicPage: z.boolean(),
    })))
    .query(async ({ ctx }) => {
      const coops = await ctx.db.coopConfig.findMany({
        where: { isActive: true, isDemo: false },
        orderBy: { displayOrder: 'asc' },
        select: {
          coopId: true,
          name: true,
          tagline: true,
          description: true,
          scTokenAddress: true,
        },
      });

      const publishedPublicPages = await ctx.db.publicCoopInfo.findMany({
        where: {
          coopId: { in: coops.map((coop) => coop.coopId) },
          isPublished: true,
          isDemo: false,
        },
        select: { coopId: true },
      });
      const publishedCoopIds = new Set(publishedPublicPages.map((page) => page.coopId));

      return coops.map((c) => ({
        coopId: c.coopId,
        name: c.name ?? c.coopId,
        tagline: c.tagline,
        description: c.description,
        isLive: !!c.scTokenAddress,
        hasPublishedPublicPage: publishedCoopIds.has(c.coopId),
      }));
    }),

  /**
   * Validate if a coopId exists and is active
   */
  validateCoopId: publicProcedure
    .input(z.object({ coopId: z.string() }))
    .output(z.object({
      exists: z.boolean(),
      name: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
      const config = await ctx.db.coopConfig.findFirst({
        where: { coopId: input.coopId, isActive: true },
        select: { coopId: true, name: true },
      });

      return {
        exists: !!config,
        name: config?.name ?? undefined,
      };
    }),

  /**
   * List all available coops for onboarding
   * Fetches from the CoopConfig table
   */
  listAvailableCoops: publicProcedure
    .output(z.array(z.object({
      id: z.string(),
      name: z.string(),
      tagline: z.string(),
      description: z.string(),
      mission: z.string(),
      features: z.array(z.object({
        title: z.string(),
        description: z.string(),
      })),
      eligibility: z.string(),
      bgColor: z.string(),
      accentColor: z.string(),
    })))
    .query(async ({ ctx }) => {
      const coops = await ctx.db.coopConfig.findMany({
        where: { 
          isActive: true,
          isDemo: false,
          name: { not: null },
        },
        orderBy: { displayOrder: 'asc' },
        select: {
          coopId: true,
          name: true,
          tagline: true,
          description: true,
          displayMission: true,
          displayFeatures: true,
          eligibility: true,
          bgColor: true,
          accentColor: true,
        },
      });

      return coops
        .filter(coop => coop.name && coop.tagline && coop.description && coop.displayMission && coop.eligibility)
        .map(coop => ({
          id: coop.coopId,
          name: coop.name!,
          tagline: coop.tagline!,
          description: coop.description!,
          mission: coop.displayMission!,
          features: (coop.displayFeatures as Array<{ title: string; description: string }>) || [],
          eligibility: coop.eligibility!,
          bgColor: coop.bgColor,
          accentColor: coop.accentColor,
        }));
    }),

  /**
   * Get application questions for a specific coop
   */
  getApplicationQuestions: publicProcedure
    .input(z.object({ coopId: z.string() }))
    .output(z.object({
      questions: z.array(z.object({
        id: z.string(),
        type: z.string(),
        label: z.string(),
        description: z.string().optional(),
        placeholder: z.string().optional(),
        required: z.boolean(),
        options: z.array(z.object({
          value: z.string(),
          label: z.string(),
        })).optional(),
        validation: z.record(z.unknown()).optional(),
      })),
    }))
    .query(async ({ input, ctx }) => {
      const config = await ctx.db.coopConfig.findFirst({
        where: { coopId: input.coopId, isActive: true },
        select: { applicationQuestions: true },
      });

      if (!config || !config.applicationQuestions) {
        return { questions: [] };
      }

      return {
        questions: config.applicationQuestions as Array<{
          id: string;
          type: string;
          label: string;
          description?: string;
          placeholder?: string;
          required: boolean;
          options?: Array<{ value: string; label: string }>;
          validation?: Record<string, unknown>;
        }>,
      };
    }),

  /**
   * Update application questions directly (admin only, bypasses proposal flow)
   */
  updateApplicationQuestions: privateProcedure
    .input(z.object({
      coopId: z.string(),
      questions: z.array(z.object({
        id: z.string(),
        type: z.string(),
        label: z.string(),
        description: z.string().optional(),
        placeholder: z.string().optional(),
        required: z.boolean(),
        options: z.array(z.object({
          value: z.string(),
          label: z.string(),
        })).optional(),
        validation: z.record(z.unknown()).optional(),
      })),
    }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const { coopId, questions } = input;
      const { walletAddress } = ctx as AuthenticatedContext;

      const activeConfig = await ctx.db.coopConfig.findFirst({
        where: { coopId, isActive: true },
        orderBy: { version: 'desc' },
      });

      if (!activeConfig) {
        throw new Error(`No active config found for coopId: ${coopId}`);
      }

      await ctx.db.coopConfig.update({
        where: { id: activeConfig.id },
        data: {
          applicationQuestions: questions as Prisma.InputJsonValue,
        },
      });

      return { success: true };
    }),

  /**
   * Get active config for a coopId
   */
  getActive: publicProcedure
    .input(z.object({ coopId: z.string() }))
    .output(CoopConfigOutputZ.nullable())
    .query(async ({ input, ctx }) => {
      const config = await ctx.db.coopConfig.findFirst({
        where: { coopId: input.coopId, isActive: true },
        orderBy: { version: "desc" },
      });
      if (!config) return null;
      return mapDbToConfigOutput(config);
    }),

  /**
   * Get specific version by coopId + version number
   */
  getVersion: publicProcedure
    .input(z.object({ coopId: z.string(), version: z.number().int().positive() }))
    .output(CoopConfigOutputZ.nullable())
    .query(async ({ input, ctx }) => {
      const config = await ctx.db.coopConfig.findUnique({
        where: { coopId_version: { coopId: input.coopId, version: input.version } },
      });
      if (!config) return null;
      return mapDbToConfigOutput(config);
    }),

  /**
   * List all versions for a coopId
   */
  listVersions: publicProcedure
    .input(z.object({ coopId: z.string() }))
    .output(z.array(z.object({
      id: z.string(),
      sequence: z.number().nullable(),
      section: z.string().nullable(),
      reason: z.string(),
      diff: z.array(z.object({
        field: z.string(),
        before: z.unknown(),
        after: z.unknown(),
      })),
      status: z.string(),
      changedBy: z.string(),
      changedAt: z.string(),
      reviewedBy: z.string().nullable(),
      reviewedAt: z.string().nullable(),
    })))
    .query(async ({ input, ctx }) => {
      const current = await ctx.db.coopConfig.findFirst({
        where: { coopId: input.coopId, isActive: true },
        orderBy: { version: "desc" },
      });

      if (!current) return [];

      const audits = await ctx.db.coopConfigAudit.findMany({
        where: { coopConfigId: current.id },
        orderBy: [{ sequence: "desc" }, { changedAt: "desc" }],
      });

      return audits.map(a => ({
        id: a.id,
        sequence: a.sequence,
        section: a.section,
        reason: a.reason,
        diff: a.diff as Array<{ field: string; before: unknown; after: unknown }>,
        status: a.status,
        changedBy: a.changedBy,
        changedAt: a.changedAt instanceof Date ? a.changedAt.toISOString() : a.changedAt,
        reviewedBy: a.reviewedBy,
        reviewedAt: a.reviewedAt instanceof Date ? a.reviewedAt.toISOString() : a.reviewedAt,
      }));
    }),

  /**
   * Create initial config for a coopId (only when none exists)
   * Uses publicProcedure since this is the initial deployment before contracts exist
   */
  create: publicProcedure
    .input(CoopConfigInputZ.extend({
      walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    }))
    .output(CoopConfigOutputZ)
    .mutation(async ({ input, ctx }) => {
      const { coopId, reason, walletAddress, ...fields } = input;

      const existing = await ctx.db.coopConfig.findFirst({
        where: { coopId, isActive: true },
      });

      if (existing) {
        throw new Error(`Active config already exists for coopId: ${coopId}. Use update instead.`);
      }

      const defaultMissionGoals = [
        { key: "income_stability",  label: "Income Stability",  priorityWeight: 0.35 },
        { key: "asset_creation",    label: "Asset Creation",    priorityWeight: 0.25 },
        { key: "leakage_reduction", label: "Leakage Reduction", priorityWeight: 0.20 },
        { key: "export_expansion",  label: "Export Expansion",  priorityWeight: 0.20 },
      ];

      const newConfig = await ctx.db.$transaction(async (tx) => {
        const config = await tx.coopConfig.create({
          data: {
            coopId,
            version: 1,
            isActive: true,
            // Display fields for mobile app
            name: fields.name,
            slug: fields.slug ?? coopId,
            tagline: fields.tagline,
            description: fields.description,
            displayMission: fields.displayMission,
            displayFeatures: fields.displayFeatures as Prisma.InputJsonValue,
            eligibility: fields.eligibility,
            bgColor: fields.bgColor ?? "bg-blue-700",
            accentColor: fields.accentColor ?? "bg-amber-600",
            displayOrder: fields.displayOrder ?? 999,
            applicationQuestions: fields.applicationQuestions as Prisma.InputJsonValue,
            // Governance fields
            charterText: fields.charterText ?? `${coopId} Co-op Charter`,
            missionGoals: fields.missionGoals ?? defaultMissionGoals,
            structuralWeights: fields.structuralWeights ?? { feasibility: 0.40, risk: 0.35, accountability: 0.25 },
            scoreMix: fields.scoreMix ?? { missionWeight: 0.60, structuralWeight: 0.40 },
            screeningPassThreshold: fields.screeningPassThreshold ?? 0.6,
            quorumPercent: fields.quorumPercent ?? 15,
            approvalThresholdPercent: fields.approvalThresholdPercent ?? 51,
            votingWindowDays: fields.votingWindowDays ?? 7,
            scVotingCapPercent: fields.scVotingCapPercent ?? 2,
            proposalCategories: fields.proposalCategories ?? [
              { key: "business_funding", label: "Business Funding", isActive: true, description: "Capital requests to start, expand, or stabilise a member-owned business. Includes equipment, working capital, licensing, and growth investment." },
              { key: "procurement",      label: "Procurement",      isActive: true, description: "Proposals to establish or formalise collective purchasing agreements, supplier contracts, or bulk-buying arrangements that reduce costs for members." },
              { key: "infrastructure",   label: "Infrastructure",   isActive: true, description: "Investment in shared physical or digital infrastructure — facilities, tools, platforms, or systems that multiple members or the coop as a whole relies on." },
              { key: "governance",       label: "Governance",       isActive: true, description: "Changes to coop rules, policies, bylaws, voting structures, or operational procedures. Requires heightened scrutiny and broad member input." },
              { key: "other",            label: "Other",            isActive: true, description: "Proposals that don't fit an existing category. AI will apply general screening; the council may re-categorise before voting." },
            ],
            sectorExclusions: fields.sectorExclusions ?? [
              { value: "fashion",           description: "Clothing, apparel, or personal style businesses — excluded due to low community multiplier and high individual-brand risk." },
              { value: "restaurant",        description: "Dine-in food service establishments — excluded due to high failure rate and limited scalability within the coop model." },
              { value: "cafe",              description: "Coffee shops and casual eateries — excluded for the same reasons as restaurants." },
              { value: "food truck",        description: "Mobile food vending — excluded due to logistical complexity and thin margins that rarely generate shared returns." },
              { value: "personality brand", description: "Businesses built around a single individual's public profile — excluded because they cannot be collectively owned or scaled cooperatively." },
              { value: "lifestyle brand",   description: "Consumer identity or aspirational brands — excluded as they prioritise aesthetics over productive economic impact." },
            ],
            scorerAgents: fields.scorerAgents ?? [
              { agentKey: "finance",   label: "Finance & Treasury",       enabled: true },
              { agentKey: "market",    label: "Market & Revenue",         enabled: true },
              { agentKey: "community", label: "Community Economy",        enabled: true },
              { agentKey: "ops",       label: "Operations & Execution",   enabled: true },
              { agentKey: "general",   label: "General (Fallback)",       enabled: true },
            ],
            minScBalanceToSubmit: fields.minScBalanceToSubmit ?? 0,
            aiAutoApproveThresholdUSD: fields.aiAutoApproveThresholdUSD ?? 500,
            councilVoteThresholdUSD: fields.councilVoteThresholdUSD ?? 5000,
            strongGoalThreshold: fields.strongGoalThreshold ?? 0.70,
            missionMinThreshold: fields.missionMinThreshold ?? 0.50,
            structuralGate: fields.structuralGate ?? 0.65,
            // Chain configuration fields
            chainId: fields.chainId,
            chainName: fields.chainName,
            rpcUrl: fields.rpcUrl,
            scTokenAddress: fields.scTokenAddress,
            allyTokenAddress: fields.allyTokenAddress,
            ucTokenAddress: fields.ucTokenAddress,
            redemptionVaultAddress: fields.redemptionVaultAddress,
            treasurySafeAddress: fields.treasurySafeAddress,
            verifiedStoreRegistryAddress: fields.verifiedStoreRegistryAddress,
            storePaymentRouterAddress: fields.storePaymentRouterAddress,
            rewardEngineAddress: fields.rewardEngineAddress,
            backendWalletAddress: fields.backendWalletAddress,
            scTokenSymbol: fields.scTokenSymbol ?? 'FAK',
            scTokenName: fields.scTokenName ?? 'FakeCoin',
            createdBy: walletAddress,
          },
        });

        await linkExternalWalletToUser({
          walletAddress,
          coopId,
          name: `${fields.name ?? coopId} Admin`,
          roles: ['member', 'admin'],
        }, tx);

        return config;
      });

      return mapDbToConfigOutput(newConfig);
    }),

  /**
   * Update config — creates new version, deactivates old, creates audit record
   */
  update: privateProcedure
    .input(CoopConfigInputZ)
    .output(CoopConfigOutputZ)
    .mutation(async ({ input, ctx }) => {
      const { coopId, reason, ...updates } = input;
      const { walletAddress } = ctx as AuthenticatedContext;

      const current = await ctx.db.coopConfig.findFirst({
        where: { coopId, isActive: true },
        orderBy: { version: "desc" },
      });

      if (!current) {
        throw new Error(`No active config found for coopId: ${coopId}`);
      }

      const newFields: Record<string, any> = {};
      if (updates.missionGoals !== undefined) newFields.missionGoals = updates.missionGoals;
      if (updates.structuralWeights !== undefined) newFields.structuralWeights = updates.structuralWeights;
      if (updates.scoreMix !== undefined) newFields.scoreMix = updates.scoreMix;
      if (updates.screeningPassThreshold !== undefined) newFields.screeningPassThreshold = updates.screeningPassThreshold;
      if (updates.quorumPercent !== undefined) newFields.quorumPercent = updates.quorumPercent;
      if (updates.approvalThresholdPercent !== undefined) newFields.approvalThresholdPercent = updates.approvalThresholdPercent;
      if (updates.votingWindowDays !== undefined) newFields.votingWindowDays = updates.votingWindowDays;
      if (updates.scVotingCapPercent !== undefined) newFields.scVotingCapPercent = updates.scVotingCapPercent;
      if (updates.proposalCategories !== undefined) newFields.proposalCategories = updates.proposalCategories;
      if (updates.sectorExclusions !== undefined) newFields.sectorExclusions = updates.sectorExclusions;
      if (updates.scorerAgents !== undefined) newFields.scorerAgents = updates.scorerAgents;
      if (updates.minScBalanceToSubmit !== undefined) newFields.minScBalanceToSubmit = updates.minScBalanceToSubmit;
      if (updates.aiAutoApproveThresholdUSD !== undefined) newFields.aiAutoApproveThresholdUSD = updates.aiAutoApproveThresholdUSD;
      if (updates.councilVoteThresholdUSD !== undefined) newFields.councilVoteThresholdUSD = updates.councilVoteThresholdUSD;
      if (updates.strongGoalThreshold !== undefined) newFields.strongGoalThreshold = updates.strongGoalThreshold;
      if (updates.missionMinThreshold !== undefined) newFields.missionMinThreshold = updates.missionMinThreshold;
      if (updates.structuralGate !== undefined) newFields.structuralGate = updates.structuralGate;
      // Display/onboarding fields
      if (updates.tagline !== undefined) newFields.tagline = updates.tagline;
      if (updates.description !== undefined) newFields.description = updates.description;
      if (updates.displayMission !== undefined) newFields.displayMission = updates.displayMission;
      if (updates.displayFeatures !== undefined) newFields.displayFeatures = updates.displayFeatures;
      if (updates.eligibility !== undefined) newFields.eligibility = updates.eligibility;
      if (updates.scTokenSymbol !== undefined) newFields.scTokenSymbol = updates.scTokenSymbol;
      if (updates.scTokenName !== undefined) newFields.scTokenName = updates.scTokenName;

      const diff = computeDiff(current, newFields);
      const sequence = await nextSequence(ctx.db, current.id);

      const [updatedConfig] = await ctx.db.$transaction([
        ctx.db.coopConfig.update({
          where: { id: current.id },
          data: {
            version: current.version + 1,
            ...newFields,
          },
        }),
        ctx.db.coopConfigAudit.create({
          data: {
            coopConfigId: current.id,
            changedBy: walletAddress,
            reason,
            diff: diff as Prisma.InputJsonValue,
            sequence,
            status: "APPLIED",
          },
        }),
      ]);

      return mapDbToConfigOutput(updatedConfig);
    }),

  /**
   * Propose a charter text change — creates a PENDING CharterAmendment.
   * The current charter is NOT changed until acknowledged.
   */
  proposeCharterChange: privateProcedure
    .input(z.object({
      coopId: z.string().min(1),
      proposedText: z.string().min(10),
      reason: z.string().min(3).max(500),
    }))
    .output(z.object({
      id: z.string(),
      status: z.string(),
      proposedAt: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { walletAddress } = ctx as AuthenticatedContext;

      const current = await ctx.db.coopConfig.findFirst({
        where: { coopId: input.coopId, isActive: true },
        orderBy: { version: "desc" },
      });

      if (!current) {
        throw new Error(`No active config found for coopId: ${input.coopId}`);
      }

      // Supersede any existing pending charter amendments
      await ctx.db.coopConfigAudit.updateMany({
        where: { coopConfigId: current.id, section: "charterText", status: "PENDING" },
        data: { status: "SUPERSEDED", reviewedBy: walletAddress, reviewedAt: new Date() },
      });

      const audit = await ctx.db.coopConfigAudit.create({
        data: {
          coopConfigId: current.id,
          section: "charterText",
          proposedChanges: toJsonValue({ charterText: input.proposedText }),
          diff: toJsonValue([{ field: "charterText", before: current.charterText, after: input.proposedText }]),
          reason: input.reason,
          status: "PENDING",
          changedBy: walletAddress,
        },
      });

      return {
        id: audit.id,
        status: audit.status,
        proposedAt: audit.changedAt instanceof Date ? audit.changedAt.toISOString() : audit.changedAt,
      };
    }),

  /**
   * Get the current pending charter amendment for a coopId, if any.
   */
  getPendingCharterAmendment: privateProcedure
    .input(z.object({ coopId: z.string().min(1) }))
    .output(z.object({
      amendment: z.object({
        id: z.string(),
        proposedText: z.string(),
        currentText: z.string(),
        reason: z.string(),
        status: z.string(),
        proposedBy: z.string(),
        proposedAt: z.string(),
      }).nullable(),
    }))
    .query(async ({ input, ctx }) => {
      const current = await ctx.db.coopConfig.findFirst({
        where: { coopId: input.coopId, isActive: true },
        orderBy: { version: "desc" },
      });

      if (!current) return { amendment: null };

      const audit = await ctx.db.coopConfigAudit.findFirst({
        where: { coopConfigId: current.id, section: "charterText", status: "PENDING" },
        orderBy: { changedAt: "desc" },
      });

      if (!audit) return { amendment: null };

      const proposedChanges = audit.proposedChanges as Record<string, unknown> | null;
      const diff = audit.diff as Array<{ field: string; before: unknown; after: unknown }> | null;
      
      return {
        amendment: {
          id: audit.id,
          proposedText: (proposedChanges?.charterText as string) ?? "",
          currentText: (diff?.find(d => d.field === "charterText")?.before as string) ?? "",
          reason: audit.reason,
          status: audit.status,
          proposedBy: audit.changedBy,
          proposedAt: audit.changedAt instanceof Date ? audit.changedAt.toISOString() : audit.changedAt,
        },
      };
    }),

  /**
   * Acknowledge a pending charter amendment — applies the change as a new config version.
   */
  acknowledgeCharterAmendment: privateProcedure
    .input(z.object({
      amendmentId: z.string().min(1),
      coopId: z.string().min(1),
    }))
    .output(CoopConfigOutputZ)
    .mutation(async ({ input, ctx }) => {
      const { walletAddress } = ctx as AuthenticatedContext;

      const audit = await ctx.db.coopConfigAudit.findUnique({
        where: { id: input.amendmentId },
      });

      if (!audit || audit.status !== "PENDING") {
        throw new Error("Amendment not found or is no longer pending.");
      }

      const current = await ctx.db.coopConfig.findFirst({
        where: { coopId: input.coopId, isActive: true },
        orderBy: { version: "desc" },
      });

      if (!current) {
        throw new Error(`No active config found for coopId: ${input.coopId}`);
      }

      const proposedChanges = audit.proposedChanges as Record<string, unknown> | null;
      const sequence = await nextSequence(ctx.db, current.id);

      const [updatedConfig] = await ctx.db.$transaction([
        ctx.db.coopConfig.update({
          where: { id: current.id },
          data: {
            version: current.version + 1,
            charterText: (proposedChanges?.charterText as string) ?? current.charterText,
          },
        }),
        ctx.db.coopConfigAudit.update({
          where: { id: audit.id },
          data: { 
            status: "APPLIED", 
            sequence,
            reviewedBy: walletAddress, 
            reviewedAt: new Date() 
          },
        }),
      ]);

      return mapDbToConfigOutput(updatedConfig);
    }),

  /**
   * Reject a pending charter amendment — marks it rejected without changing the charter.
   */
  rejectCharterAmendment: privateProcedure
    .input(z.object({
      amendmentId: z.string().min(1),
      reason: z.string().min(3).max(500),
    }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const { walletAddress } = ctx as AuthenticatedContext;

      const audit = await ctx.db.coopConfigAudit.findUnique({
        where: { id: input.amendmentId },
      });

      if (!audit || audit.status !== "PENDING") {
        throw new Error("Amendment not found or is no longer pending.");
      }

      await ctx.db.coopConfigAudit.update({
        where: { id: input.amendmentId },
        data: { status: "REJECTED", reviewedBy: walletAddress, reviewedAt: new Date() },
      });

      return { success: true };
    }),

  // ── Generic Config Amendments ─────────────────────────────────────────────

  /**
   * Propose a change to any config section.
   * One pending amendment per section; proposing supersedes the existing one.
   */
  proposeConfigChange: privateProcedure
    .input(z.object({
      coopId: z.string().min(1),
      section: z.string().min(1),
      proposedChanges: z.record(z.unknown()),
      currentSnapshot: z.record(z.unknown()),
      reason: z.string().min(3).max(500),
    }))
    .output(z.object({
      id: z.string(),
      section: z.string(),
      status: z.string(),
      proposedAt: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { walletAddress } = ctx as AuthenticatedContext;

      const current = await ctx.db.coopConfig.findFirst({
        where: { coopId: input.coopId, isActive: true },
        orderBy: { version: "desc" },
      });

      if (!current) {
        throw new Error(`No active config found for coopId: ${input.coopId}`);
      }

      // Supersede any existing pending amendments for this section
      await ctx.db.coopConfigAudit.updateMany({
        where: { coopConfigId: current.id, section: input.section, status: "PENDING" },
        data: { status: "SUPERSEDED", reviewedBy: walletAddress, reviewedAt: new Date() },
      });

      // Compute diff from current snapshot and proposed changes
      const diff: { field: string; before: unknown; after: unknown }[] = [];
      for (const [field, after] of Object.entries(input.proposedChanges)) {
        const before = input.currentSnapshot[field];
        if (JSON.stringify(before) !== JSON.stringify(after)) {
          diff.push({ field, before, after });
        }
      }

      const audit = await ctx.db.coopConfigAudit.create({
        data: {
          coopConfigId: current.id,
          section: input.section,
          proposedChanges: toJsonValue(input.proposedChanges),
          diff: toJsonValue(diff),
          reason: input.reason,
          status: "PENDING",
          changedBy: walletAddress,
        },
      });

      return {
        id: audit.id,
        section: audit.section!,
        status: audit.status,
        proposedAt: audit.changedAt instanceof Date ? audit.changedAt.toISOString() : audit.changedAt,
      };
    }),

  /**
   * Return all pending ConfigAmendments for a coopId.
   */
  getPendingConfigAmendments: privateProcedure
    .input(z.object({ coopId: z.string().min(1) }))
    .output(z.array(z.object({
      id: z.string(),
      section: z.string(),
      proposedChanges: z.record(z.unknown()),
      currentSnapshot: z.record(z.unknown()),
      reason: z.string(),
      status: z.string(),
      proposedBy: z.string(),
      proposedAt: z.string(),
    })))
    .query(async ({ input, ctx }) => {
      const current = await ctx.db.coopConfig.findFirst({
        where: { coopId: input.coopId, isActive: true },
        orderBy: { version: "desc" },
      });

      if (!current) return [];

      const audits = await ctx.db.coopConfigAudit.findMany({
        where: { 
          coopConfigId: current.id, 
          status: "PENDING",
          section: { not: "charterText" }, // Exclude charter amendments
        },
        orderBy: { changedAt: "asc" },
      });

      return audits.map(a => {
        const proposedChanges = a.proposedChanges as Record<string, unknown> | null ?? {};
        const diff = a.diff as Array<{ field: string; before: unknown; after: unknown }> | null ?? [];
        
        // Reconstruct currentSnapshot from diff
        const currentSnapshot: Record<string, unknown> = {};
        for (const d of diff) {
          currentSnapshot[d.field] = d.before;
        }

        return {
          id: a.id,
          section: a.section!,
          proposedChanges,
          currentSnapshot,
          reason: a.reason,
          status: a.status,
          proposedBy: a.changedBy,
          proposedAt: a.changedAt instanceof Date ? a.changedAt.toISOString() : a.changedAt,
        };
      });
    }),

  /**
   * Acknowledge a pending ConfigAmendment — applies the change as a new config version.
   */
  acknowledgeConfigAmendment: privateProcedure
    .input(z.object({
      amendmentId: z.string().min(1),
      coopId: z.string().min(1),
    }))
    .output(CoopConfigOutputZ)
    .mutation(async ({ input, ctx }) => {
      const { walletAddress } = ctx as AuthenticatedContext;

      const audit = await ctx.db.coopConfigAudit.findUnique({
        where: { id: input.amendmentId },
      });

      if (!audit || audit.status !== "PENDING") {
        throw new Error("Amendment not found or is no longer pending.");
      }

      const current = await ctx.db.coopConfig.findFirst({
        where: { coopId: input.coopId, isActive: true },
        orderBy: { version: "desc" },
      });

      if (!current) throw new Error(`No active config found for coopId: ${input.coopId}`);

      const changes = audit.proposedChanges as Record<string, unknown> | null ?? {};
      const sequence = await nextSequence(ctx.db, current.id);

      const [updatedConfig] = await ctx.db.$transaction([
        ctx.db.coopConfig.update({
          where: { id: current.id },
          data: {
            version: current.version + 1,
            ...changes,
          },
        }),
        ctx.db.coopConfigAudit.update({
          where: { id: audit.id },
          data: { 
            status: "APPLIED", 
            sequence,
            reviewedBy: walletAddress, 
            reviewedAt: new Date() 
          },
        }),
      ]);

      return mapDbToConfigOutput(updatedConfig);
    }),

  /**
   * Reject a pending ConfigAmendment.
   */
  rejectConfigAmendment: privateProcedure
    .input(z.object({
      amendmentId: z.string().min(1),
      reason: z.string().min(3).max(500),
    }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const { walletAddress } = ctx as AuthenticatedContext;

      const audit = await ctx.db.coopConfigAudit.findUnique({
        where: { id: input.amendmentId },
      });

      if (!audit || audit.status !== "PENDING") {
        throw new Error("Amendment not found or is no longer pending.");
      }

      await ctx.db.coopConfigAudit.update({
        where: { id: input.amendmentId },
        data: { status: "REJECTED", reviewedBy: walletAddress, reviewedAt: new Date() },
      });

      return { success: true };
    }),

  /**
   * Return all audit-backed amendments for a coopId, newest first.
   * Used for the dedicated amendments review page.
   */
  getAllAmendments: privateProcedure
    .input(z.object({ coopId: z.string().min(1) }))
    .output(z.object({
      config: z.array(z.object({
        id: z.string(),
        type: z.literal("config"),
        section: z.string(),
        reason: z.string(),
        status: z.string(),
        proposedBy: z.string(),
        proposedAt: z.string(),
        reviewedBy: z.string().nullable(),
        reviewedAt: z.string().nullable(),
        proposedChanges: z.record(z.unknown()),
        currentSnapshot: z.record(z.unknown()),
      })),
      charter: z.array(z.object({
        id: z.string(),
        type: z.literal("charter"),
        reason: z.string(),
        status: z.string(),
        proposedBy: z.string(),
        proposedAt: z.string(),
        reviewedBy: z.string().nullable(),
        reviewedAt: z.string().nullable(),
        proposedText: z.string(),
        currentText: z.string(),
      })),
    }))
    .query(async ({ input, ctx }) => {
      const current = await ctx.db.coopConfig.findFirst({
        where: { coopId: input.coopId, isActive: true },
        orderBy: { version: "desc" },
      });

      if (!current) return { config: [], charter: [] };

      const audits = await ctx.db.coopConfigAudit.findMany({
        where: { coopConfigId: current.id },
        orderBy: { changedAt: "desc" },
      });

      const config = [];
      const charter = [];

      for (const audit of audits) {
        const proposedChanges = audit.proposedChanges as Record<string, unknown> | null ?? {};
        const diff = audit.diff as Array<{ field: string; before: unknown; after: unknown }> | null ?? [];
        const currentSnapshot: Record<string, unknown> = {};
        for (const d of diff) {
          currentSnapshot[d.field] = d.before;
        }

        const base = {
          id: audit.id,
          reason: audit.reason,
          status: audit.status,
          proposedBy: audit.changedBy,
          proposedAt: audit.changedAt instanceof Date ? audit.changedAt.toISOString() : audit.changedAt,
          reviewedBy: audit.reviewedBy ?? null,
          reviewedAt: audit.reviewedAt instanceof Date ? audit.reviewedAt.toISOString() : (audit.reviewedAt ?? null),
        };

        if (audit.section === "charterText") {
          charter.push({
            ...base,
            type: "charter" as const,
            proposedText: (proposedChanges.charterText as string) ?? "",
            currentText: (currentSnapshot.charterText as string) ?? "",
          });
        } else {
          config.push({
            ...base,
            type: "config" as const,
            section: audit.section ?? "config",
            proposedChanges,
            currentSnapshot,
          });
        }
      }

      return { config, charter };
    }),

  /**
   * Get audit trail for a coopId with pagination
   */
  getAuditTrail: privateProcedure
    .input(z.object({
      coopId: z.string(),
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
    }))
    .output(z.object({
      entries: z.array(z.object({
        id: z.string(),
        configVersion: z.number(),
        changedBy: z.string(),
        changedAt: z.string(),
        reason: z.string(),
        diff: z.any(),
      })),
      total: z.number(),
    }))
    .query(async ({ input, ctx }) => {
      const configs = await ctx.db.coopConfig.findMany({
        where: { coopId: input.coopId },
        select: { id: true, version: true },
      });
      const configMap = new Map(configs.map((c: any) => [c.id, c.version]));
      const configIds = configs.map((c: any) => c.id);

      const [entries, total] = await Promise.all([
        ctx.db.coopConfigAudit.findMany({
          where: { coopConfigId: { in: configIds } },
          orderBy: { changedAt: "desc" },
          skip: input.offset,
          take: input.limit,
        }),
        ctx.db.coopConfigAudit.count({
          where: { coopConfigId: { in: configIds } },
        }),
      ]);

      return {
        entries: entries.map((e: any) => ({
          id: e.id,
          configVersion: configMap.get(e.coopConfigId) ?? 0,
          changedBy: e.changedBy,
          changedAt: e.changedAt instanceof Date ? e.changedAt.toISOString() : e.changedAt,
          reason: e.reason,
          diff: e.diff,
        })),
        total,
      };
    }),
});
