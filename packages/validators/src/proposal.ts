import { z } from "zod";

// ── enums ──────────────────────────────────────────────
export const ProposerRoleZ = z.enum(["member", "merchant", "anchor", "bot"]);
export const ProposalStatusZ = z.enum([
  "submitted",
  "votable",
  "approved",
  "funded",
  "rejected",
  "failed",
  "withdrawn",
]);

export const ReactionTypeZ = z.enum(["SUPPORT", "CONCERN"]);

export const ProposalReactionOutputZ = z.object({
  support: z.number(),
  concern: z.number(),
  myReaction: ReactionTypeZ.nullable(),
});
/**
 * Proposal category key.
 * Categories are coop-configurable (see CoopConfig.proposalCategories).
 */
export const ProposalCategoryZ = z.string().min(1).max(64);

// ── shared blocks ─────────────────────────────────────
export const RegionZ = z.object({
  code: z.string().min(2),
  name: z.string().min(2),
});

export const BudgetZ = z.object({
  currency: z.enum(["UC", "USD", "mixed"]),
  amountRequested: z.number().nonnegative(),
});

export const TreasuryPlanZ = z.object({
  localPercent: z.number().min(0).max(100),
  nationalPercent: z.number().min(0).max(100),
  acceptUC: z.literal(true), // v0 rule: must accept UC
});

export const KPIz = z.object({
  name: z.string().min(2),
  target: z.number().nonnegative(),
  unit: z.enum(["USD", "UC", "jobs", "percent", "count"]),
});

// ── INPUT ─────────────────────────────────────────────
export const ProposalInputZ = z.object({
  text: z.string().min(20).max(10000),
  proposer: z.object({
    wallet: z.string().min(3),
    role: ProposerRoleZ,
    displayName: z.string().optional().nullable(),
  }).optional().nullable(),
  region: RegionZ.optional().nullable(),
  coopId: z.string().optional(),
});

// ── EVALUATION SCHEMAS (new scoring model) ────────────────────────────────────

/** Universal structural seriousness checks — same for all coops */
export const StructuralScoresZ = z.object({
  goal_mapping_valid: z.boolean(),
  feasibility_score: z.number().min(0).max(1),
  risk_score: z.number().min(0).max(1),
  accountability_score: z.number().min(0).max(1),
});

/** Per-mission-goal impact score (coop-specific goals from missionGoals config) */
export const MissionImpactScoreZ = z.object({
  goal_id: z.string(),
  impact_score: z.number().min(0).max(1),
  goal_priority_weight: z.number().min(0).max(1),
  /** Plain-English explanation of why this score was given and what would raise it. */
  score_reason: z.string().optional(),
  /** Short text references to evidence in the proposal text that support this score. */
  evidenceRefs: z.array(z.string()).optional(),
});

/**
 * Per-goal breakdown entry in the evaluation output.
 * `weight` is the normalized weight (sums to 1.0 across all goals).
 */
export const MissionGoalBreakdownItemZ = z.object({
  goal_id: z.string(),
  score: z.number().min(0).max(1),
  weight: z.number().min(0).max(1),
  rationale: z.string().default(""),
  evidenceRefs: z.array(z.string()).default([]),
});

/**
 * Per-factor breakdown entry for the structural evaluation.
 * `score` is the effective score (risk is inverted so higher = better).
 */
export const StructuralBreakdownItemZ = z.object({
  factor: z.string(),
  score: z.number().min(0).max(1),
  weight: z.number().min(0).max(1),
  rationale: z.string().default(""),
  evidenceRefs: z.array(z.string()).default([]),
});

/** Backend-computed totals — LLM does NOT decide these */
export const ComputedScoresZ = z.object({
  mission_weighted_score: z.number().min(0).max(1),
  structural_weighted_score: z.number().min(0).max(1),
  overall_score: z.number().min(0).max(1),
  passes_threshold: z.boolean(),
  /**
   * Machine-readable reasons why the proposal failed the scoring gates.
   * Stable keys: FAIL_STRUCTURAL_GATE | FAIL_MISSION_MIN_THRESHOLD | FAIL_NO_STRONG_MISSION_GOAL
   */
  passFailReasons: z.array(z.string()).default([]),
  /** True when at least one human expert has overridden a mission goal score. */
  expert_adjusted: z.boolean().optional(),
});

/** Full evaluation block stored on each proposal */
export const EvaluationZ = z.object({
  structural_scores: StructuralScoresZ,
  mission_impact_scores: z.array(MissionImpactScoreZ),
  computed_scores: ComputedScoresZ,
  violations: z.array(z.string()).default([]),
  risk_flags: z.array(z.string()).default([]),
  llm_summary: z.string().default(""),
  /** Per-goal breakdown with normalized weights and AI rationale. */
  mission_goal_breakdown: z.array(MissionGoalBreakdownItemZ).default([]),
  /** Per-structural-factor breakdown with effective scores and AI rationale. */
  structural_breakdown: z.array(StructuralBreakdownItemZ).default([]),
});

// ── OUTPUT ────────────────────────────────────────────
export const GovernanceZ = z.object({
  quorumPercent: z.number().min(0).max(100).default(20),
  approvalThresholdPercent: z.number().min(0).max(100).default(60),
  votingWindowDays: z.number().int().positive().default(7),
});

export const AuditZ = z.object({
  engineVersion: z.string().min(1),
  checks: z.array(
    z.object({
      name: z.string(),
      passed: z.boolean(),
      note: z.string().optional().nullable(),
    }),
  ),
});

// Engine-generated alternative
// overallScore is null when not yet verified by the full scoring pipeline.
// UI should show 'Score pending' rather than displaying the raw AI estimate.
export const AlternativeZ = z.object({
  label: z.string().min(3),
  changes: z.array(z.object({
    field: z.string(),
    from: z.union([z.string(), z.number(), z.boolean()]).optional().nullable(),
    to: z.union([z.string(), z.number(), z.boolean()])
  })).max(10),
  /** Null means the verified pipeline has not scored this alternative yet. */
  overallScore: z.number().min(0).max(1).nullable().default(null),
  rationale: z.string().min(10),
  dataNeeds: z.array(z.string()).optional().nullable(),
});

export const DecisionZ = z.enum(["advance", "revise", "block", "needs_info"]);

/**
 * How severe the missing information is:
 * - BLOCKER: proposal cannot advance without this — triggers decision="needs_info"
 * - SOFT:    proposal can advance but the structural score is penalized
 * - INFO:    nice-to-have context; no scoring impact
 */
export const MissingSeverityZ = z.enum(["BLOCKER", "SOFT", "INFO"]);

export const MissingDataZ = z.object({
  field: z.string(),
  question: z.string(),
  why_needed: z.string(),
  severity: MissingSeverityZ.default("SOFT"),
  /**
   * Optional list of mission goal keys whose scores should be capped
   * because this piece of evidence is needed to score them fairly.
   */
  affectedGoalIds: z.array(z.string()).optional(),
  /** @deprecated use severity === "BLOCKER" instead */
  blocking: z.boolean().optional(),
});

export const ProposalOutputZ = z.object({
  id: z.string().min(1),
  createdAt: z.string().datetime(),
  status: ProposalStatusZ,

  title: z.string(),
  summary: z.string(),
  proposer: z.object({
    wallet: z.string(),
    role: ProposerRoleZ,
    displayName: z.string().optional().nullable(),
  }),
  region: RegionZ,
  category: ProposalCategoryZ,
  budget: BudgetZ,
  treasuryPlan: TreasuryPlanZ.nullable().optional(),

  evaluation: EvaluationZ,
  charterVersionId: z.string().optional().nullable(),
  governance: GovernanceZ,
  audit: AuditZ,
  alternatives: z.array(AlternativeZ).default([]),
  bestAlternative: AlternativeZ.optional().nullable(),
  decision: DecisionZ.default("advance"),
  decisionReasons: z.array(z.string()).default([]),
  missing_data: z.array(MissingDataZ).default([]),
  councilRequired: z.boolean().default(false),
  rawText: z.string().optional().nullable(),
});


// ── Coop Config Schemas ──────────────────────────────────────────────────────

/** A single coop-specific mission goal with its scoring priority weight */
export const MissionGoalZ = z.object({
  /** Machine key generated from label, e.g. "Income Stability" → "income_stability". */
  key: z.string().min(1),
  label: z.string().min(1),
  priorityWeight: z.number().min(0).max(1),
  description: z.string().optional(),
  /** Which scorer-agent domain is responsible for scoring this goal.
   *  If omitted or no matching enabled agent exists, the 'general' fallback is used. */
  domain: z.string().optional(),
  /** Plain-English rubric shown to both the AI scorer and human experts. */
  scoringRubric: z.string().optional(),
});

/** A single domain scorer-agent definition stored in coop config.
 *  Admins can add/enable/disable agents without code changes. */
export const ScorerAgentZ = z.object({
  /** Stable identifier, e.g. 'finance', 'market', 'community', 'ops', 'general' */
  agentKey: z.string().min(1),
  /** Human-readable label, e.g. 'Finance & Treasury Expert' */
  label: z.string().min(1),
  /** Whether this agent is active; inactive agents fall through to 'general' */
  enabled: z.boolean().default(true),
  /** Optional override prompt appended to the base scoring instructions */
  promptTemplate: z.string().optional(),
  /** Optional model override, e.g. 'gpt-4o'. Defaults to engine default. */
  model: z.string().optional(),
});

/** Universal structural scoring weights (all coops share the same categories) */
export const StructuralWeightsZ = z.object({
  feasibility: z.number().min(0).max(1),
  risk: z.number().min(0).max(1),
  accountability: z.number().min(0).max(1),
});

/** How to blend mission vs structural into overall_score */
export const ScoreMixZ = z.object({
  missionWeight: z.number().min(0).max(1),
  structuralWeight: z.number().min(0).max(1),
});

export const ProposalCategoryConfigZ = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  isActive: z.boolean(),
  description: z.string().optional(),
});

export const SectorExclusionZ = z.object({
  value: z.string().min(1),
  description: z.string().optional(),
});

export const CoopConfigInputZ = z.object({
  coopId: z.string().min(1),
  charterText: z.string().min(10).optional(),
  missionGoals: z.array(MissionGoalZ).optional(),
  structuralWeights: StructuralWeightsZ.optional(),
  scoreMix: ScoreMixZ.optional(),
  screeningPassThreshold: z.number().min(0).max(1).optional(),
  quorumPercent: z.number().min(0).max(100).optional(),
  approvalThresholdPercent: z.number().min(0).max(100).optional(),
  votingWindowDays: z.number().int().min(1).max(90).optional(),
  scVotingCapPercent: z.number().min(0).max(100).optional(),
  proposalCategories: z.array(ProposalCategoryConfigZ).optional(),
  sectorExclusions: z.array(SectorExclusionZ).optional(),
  minScBalanceToSubmit: z.number().min(0).optional(),
  aiAutoApproveThresholdUSD: z.number().min(0).optional(),
  councilVoteThresholdUSD: z.number().min(0).optional(),
  /** Configurable domain scorer-agent registry; admins manage without code changes */
  scorerAgents: z.array(ScorerAgentZ).optional(),
  /** A single mission goal must reach this score (0..1) for the proposal to be mission-aligned. Default 0.70. */
  strongGoalThreshold: z.number().min(0).max(1).optional(),
  /** The weighted average of all mission goal scores must meet this floor. Default 0.50. */
  missionMinThreshold: z.number().min(0).max(1).optional(),
  /** The structural score must clear this gate or the proposal fails regardless of mission scores. Default 0.65. */
  structuralGate: z.number().min(0).max(1).optional(),
  reason: z.string().min(3).max(500),
  // Display fields for mobile app onboarding
  name: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
  tagline: z.string().min(1).optional(),
  description: z.string().optional(),
  displayMission: z.string().optional(),
  displayFeatures: z.array(z.object({ title: z.string(), description: z.string() })).optional(),
  eligibility: z.string().optional(),
  bgColor: z.string().optional(),
  accentColor: z.string().optional(),
  displayOrder: z.number().int().optional(),
  applicationQuestions: z.array(z.any()).optional(),
  // Chain configuration fields
  chainId: z.number().int().optional(),
  chainName: z.string().optional(),
  rpcUrl: z.string().url().optional(),
  scTokenAddress: z.string().optional(),
  allyTokenAddress: z.string().optional(),
  ucTokenAddress: z.string().optional(),
  redemptionVaultAddress: z.string().optional(),
  treasurySafeAddress: z.string().optional(),
  verifiedStoreRegistryAddress: z.string().optional(),
  storePaymentRouterAddress: z.string().optional(),
  rewardEngineAddress: z.string().optional(),
  backendWalletAddress: z.string().optional(),
  scTokenSymbol: z.string().optional(),
  scTokenName: z.string().optional(),
});

export const CoopConfigOutputZ = z.object({
  id: z.string(),
  coopId: z.string(),
  version: z.number(),
  isActive: z.boolean(),
  charterText: z.string(),
  missionGoals: z.array(MissionGoalZ),
  structuralWeights: StructuralWeightsZ,
  scoreMix: ScoreMixZ,
  screeningPassThreshold: z.number(),
  quorumPercent: z.number(),
  approvalThresholdPercent: z.number(),
  votingWindowDays: z.number(),
  scVotingCapPercent: z.number(),
  proposalCategories: z.array(ProposalCategoryConfigZ),
  sectorExclusions: z.array(SectorExclusionZ),
  minScBalanceToSubmit: z.number(),
  aiAutoApproveThresholdUSD: z.number(),
  councilVoteThresholdUSD: z.number(),
  scorerAgents: z.array(ScorerAgentZ).default([]),
  strongGoalThreshold: z.number(),
  missionMinThreshold: z.number(),
  structuralGate: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  createdBy: z.string(),
  // Display/onboarding fields
  name: z.string().optional(),
  slug: z.string().optional(),
  tagline: z.string().optional(),
  description: z.string().optional(),
  displayMission: z.string().optional(),
  displayFeatures: z.array(z.object({ title: z.string(), description: z.string() })).nullable().optional(),
  eligibility: z.string().optional(),
  bgColor: z.string().optional(),
  accentColor: z.string().optional(),
  displayOrder: z.number().optional(),
  applicationQuestions: z.array(z.any()).nullable().optional(),
  chainId: z.number().int().optional(),
  chainName: z.string().optional(),
  rpcUrl: z.string().optional(),
  scTokenAddress: z.string().optional(),
  allyTokenAddress: z.string().optional(),
  ucTokenAddress: z.string().optional(),
  redemptionVaultAddress: z.string().optional(),
  treasurySafeAddress: z.string().optional(),
  verifiedStoreRegistryAddress: z.string().optional(),
  storePaymentRouterAddress: z.string().optional(),
  rewardEngineAddress: z.string().optional(),
  backendWalletAddress: z.string().optional(),
  scTokenSymbol: z.string().optional(),
  scTokenName: z.string().optional(),
});

// ── Comment Schemas ──────────────────────────────────────────────────────

export const CommentAlignmentZ = z.enum(["ALIGNED", "NEUTRAL", "MISALIGNED"]);

export const CommentInputZ = z.object({
  proposalId: z.string().min(1),
  content: z.string().min(1).max(5000),
});

export const CommentAIEvaluationZ = z.object({
  alignment: CommentAlignmentZ,
  score: z.number().min(0).max(1),
  analysis: z.string().min(1),
  goalsImpacted: z.array(z.string()),
});

export const CommentOutputZ = z.object({
  id: z.string(),
  proposalId: z.string(),
  authorWallet: z.string(),
  authorName: z.string().optional().nullable(),
  content: z.string(),
  createdAt: z.string(),
  aiEvaluation: CommentAIEvaluationZ.optional().nullable(),
});

// ── tiny helper: build output from input + computed values ────────────────────
export function buildOutput(params: {
  id: string;
  createdAt: string;
  status: z.infer<typeof ProposalStatusZ>;
  input: z.infer<typeof ProposalInputZ>;
  extractedFields: {
    title?: string;
    summary?: string;
    category?: z.infer<typeof ProposalCategoryZ>;
    budget?: z.infer<typeof BudgetZ>;
    treasuryPlan?: z.infer<typeof TreasuryPlanZ>;
  };
  evaluation: z.infer<typeof EvaluationZ>;
  governance?: Partial<z.infer<typeof GovernanceZ>>;
  engineVersion: string;
  checks: { name: string; passed: boolean; note?: string }[];
}) {
  const gov = GovernanceZ.parse(params.governance ?? {});
  const out = {
    id: params.id,
    createdAt: params.createdAt,
    status: params.status,
    title: params.extractedFields.title ?? "Untitled Proposal",
    summary: params.extractedFields.summary ?? params.input.text.substring(0, 500),
    proposer: params.input.proposer ?? { wallet: "unknown", role: "member" as const },
    region: params.input.region ?? { code: "US", name: "United States" },
    category: params.extractedFields.category ?? "other" as const,
    budget: params.extractedFields.budget ?? { currency: "USD" as const, amountRequested: 0 },
    treasuryPlan: params.extractedFields.treasuryPlan ?? null,
    evaluation: params.evaluation,
    governance: gov,
    audit: { engineVersion: params.engineVersion, checks: params.checks },
  };
  return ProposalOutputZ.parse(out);
}

// ── Type exports ──────────────────────────────────────
export type ProposalInput = z.infer<typeof ProposalInputZ>;
export type ProposalOutput = z.infer<typeof ProposalOutputZ>;
export type ProposerRole = z.infer<typeof ProposerRoleZ>;
export type ProposalStatus = z.infer<typeof ProposalStatusZ>;
export type ProposalCategory = z.infer<typeof ProposalCategoryZ>;
export type Governance = z.infer<typeof GovernanceZ>;
export type Audit = z.infer<typeof AuditZ>;
export type StructuralScores = z.infer<typeof StructuralScoresZ>;
export type MissionImpactScore = z.infer<typeof MissionImpactScoreZ>;
export type MissionGoalBreakdownItem = z.infer<typeof MissionGoalBreakdownItemZ>;
export type StructuralBreakdownItem = z.infer<typeof StructuralBreakdownItemZ>;
export type ComputedScores = z.infer<typeof ComputedScoresZ>;
export type Evaluation = z.infer<typeof EvaluationZ>;
export type Alternative = z.infer<typeof AlternativeZ>;
export type Decision = z.infer<typeof DecisionZ>;
export type MissingData = z.infer<typeof MissingDataZ>;
export type MissingSeverity = z.infer<typeof MissingSeverityZ>;
export type MissionGoal = z.infer<typeof MissionGoalZ>;
export type ScorerAgent = z.infer<typeof ScorerAgentZ>;
export type StructuralWeights = z.infer<typeof StructuralWeightsZ>;
export type ScoreMix = z.infer<typeof ScoreMixZ>;
export type ProposalCategoryConfig = z.infer<typeof ProposalCategoryConfigZ>;
export type SectorExclusion = z.infer<typeof SectorExclusionZ>;
export type CoopConfigInput = z.infer<typeof CoopConfigInputZ>;
export type CoopConfigOutput = z.infer<typeof CoopConfigOutputZ>;
export type CommentAlignment = z.infer<typeof CommentAlignmentZ>;
export type CommentInput = z.infer<typeof CommentInputZ>;
export type CommentAIEvaluation = z.infer<typeof CommentAIEvaluationZ>;
export type CommentOutput = z.infer<typeof CommentOutputZ>;
export type ReactionType = z.infer<typeof ReactionTypeZ>;
export type ProposalReactionOutput = z.infer<typeof ProposalReactionOutputZ>;
