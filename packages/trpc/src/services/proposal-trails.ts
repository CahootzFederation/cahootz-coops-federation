import type { ProposalOutput } from "@repo/validators";

import { DecisionTrail, percent, type TrailTrigger } from "./sage-decision-trail.js";
import { describeInputFlags, isSteeringAttempt, type InputFlag } from "./untrusted-input.js";

type InputCheck = { flags: InputFlag[]; matches: string[] };

/**
 * Decision trails for the proposal engine and comment evaluation. Both are built from the engine's
 * own output after it runs, so recording a trail never changes what the engine decides. Proposal and
 * comment trails are visible to members of the proposal's Commons (proposals are readable there).
 */

type MissionGoal = { key: string; label: string };

export interface ProposalTrailContext {
  coopId: string;
  proposalId: string;
  trigger: Extract<TrailTrigger, "PROPOSAL_SUBMITTED" | "PROPOSAL_RESUBMITTED" | "PROPOSAL_ALTERNATIVE_APPLIED">;
  rawText: string;
  charterVersion?: number | null;
  missionGoals: MissionGoal[];
  expertCalibrationCount?: number;
  thresholds: { structuralGate: number; missionMinThreshold: number; strongGoalThreshold: number };
  aiAutoApproveThresholdUSD: number;
  councilVoteThresholdUSD: number;
  finalStatus: string;
  councilRequired: boolean;
  /** Set when the proposer applied a suggested alternative, which first rewrites the proposal. */
  rewrite?: { label: string; rationale: string };
  /** What cleansing found in the proposal text before it went to the engine. */
  inputCheck?: InputCheck;
  /** True when auto-approval was withheld because the text tried to instruct the reviewer. */
  autoApproveBlocked?: boolean;
}

const DECISION_LABEL: Record<string, string> = {
  advance: "Advance it", revise: "Send it back for revision", block: "Block it", needs_info: "Ask for more information",
};
const STATUS_LABEL: Record<string, string> = {
  SUBMITTED: "submitted (waiting on the proposer)", VOTABLE: "open for voting", APPROVED: "approved", REJECTED: "rejected",
};

function money(amount: number, currency: string) {
  return currency === "USD" ? `$${amount.toLocaleString("en-US")}` : `${amount.toLocaleString("en-US")} ${currency}`;
}

function humanize(name: string) {
  return name.replace(/_/g, " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

// Engine check names describe what's being looked for; a passed check means it wasn't found.
const CHECK_LABEL: Record<string, string> = {
  basic_validation: "Passes basic validation",
  treasury_allocation_sum: "Treasury allocation adds up",
  sector_exclusion_screen: "Passes the sector exclusion screen",
  manipulation_attempt_detected: "No attempt to manipulate the review",
  unrealistic_claims_detected: "No unrealistic claims",
  charter_loaded: "The charter was loaded",
};

export function buildProposalEngineTrail(output: ProposalOutput, context: ProposalTrailContext): DecisionTrail {
  const goalLabel = new Map(context.missionGoals.map((goal) => [goal.key, goal.label]));
  const scores = output.evaluation.computed_scores;
  const failReasons = new Set(scores.passFailReasons);
  const trail = new DecisionTrail({
    agent: "proposal-engine", coopId: context.coopId, proposalId: context.proposalId,
    sourceType: "proposal", sourceId: context.proposalId, trigger: context.trigger, visibility: "COMMONS_MEMBERS",
    observed: { title: output.title, content: context.rawText },
  });

  trail.step("OBSERVED", "Read the proposal text");
  trail.step("EVIDENCE", `The active charter${context.charterVersion ? ` (version ${context.charterVersion})` : ""} and ${context.missionGoals.length} mission goals`);
  if (context.expertCalibrationCount) {
    trail.step("EVIDENCE", `${context.expertCalibrationCount} past expert corrections used to calibrate goal scores`);
  }
  trail.step("EVIDENCE", "Scoring thresholds", {
    detail: `Structural gate ${percent(context.thresholds.structuralGate)} · mission minimum ${percent(context.thresholds.missionMinThreshold)} · strong goal ${percent(context.thresholds.strongGoalThreshold)}`,
  });

  if (output.priorOutcomes?.length) {
    trail.step("EVIDENCE", `Results of ${output.priorOutcomes.length} similar past ${output.priorOutcomes.length === 1 ? "proposal" : "proposals"} from Sage's memory (reported by their authors, not verified)`, {
      detail: output.priorOutcomes.map((item) => item.text).join("\n"),
    });
  }
  if (context.rewrite) {
    trail.step("CONSIDERED", `Rewrote the proposal around the alternative "${context.rewrite.label}"`, { outcome: "INFO", detail: context.rewrite.rationale });
  }
  trail.step("CONSIDERED", `Extracted: ${output.title}`, {
    outcome: "INFO",
    detail: [output.summary, `Category: ${output.category}`, `Budget: ${money(output.budget.amountRequested, output.budget.currency)}`, `Region: ${output.region.name}`].join("\n"),
  });
  const goalScores = output.evaluation.mission_goal_breakdown.length
    ? output.evaluation.mission_goal_breakdown.map((goal) => ({ id: goal.goal_id, score: goal.score, weight: goal.weight, reason: goal.rationale, refs: goal.evidenceRefs }))
    : output.evaluation.mission_impact_scores.map((goal) => ({ id: goal.goal_id, score: goal.impact_score, weight: goal.goal_priority_weight, reason: goal.score_reason ?? "", refs: goal.evidenceRefs ?? [] }));
  for (const goal of goalScores) {
    trail.step("CONSIDERED", `${goalLabel.get(goal.id) ?? goal.id}: ${percent(goal.score)} (weight ${percent(goal.weight)})`, {
      outcome: "INFO",
      detail: [goal.reason, goal.refs.length ? `Evidence: ${goal.refs.map((ref) => `"${ref}"`).join("; ")}` : ""].filter(Boolean).join("\n") || undefined,
    });
  }
  for (const factor of output.evaluation.structural_breakdown) {
    trail.step("CONSIDERED", `Structure, ${factor.factor.toLowerCase()}: ${percent(factor.score)} (weight ${percent(factor.weight)})`, { outcome: "INFO", detail: factor.rationale || undefined });
  }
  trail.step("CONSIDERED", `Overall ${percent(scores.overall_score)} (mission ${percent(scores.mission_weighted_score)}, structure ${percent(scores.structural_weighted_score)})`, {
    outcome: "INFO",
    detail: [output.evaluation.llm_summary, scores.expert_adjusted ? "Adjusted by expert scores." : ""].filter(Boolean).join("\n") || undefined,
  });
  if (output.evaluation.risk_flags.length) {
    trail.step("CONSIDERED", `${output.evaluation.risk_flags.length} risk flags`, { outcome: "INFO", detail: output.evaluation.risk_flags.join("\n") });
  }
  for (const item of output.missing_data) {
    trail.step("CONSIDERED", `Needs information (${item.severity.toLowerCase()}): ${item.question}`, { outcome: "INFO", detail: item.why_needed });
  }
  for (const alternative of output.alternatives) {
    trail.step("CONSIDERED", `Alternative: ${alternative.label}`, { outcome: "INFO", detail: alternative.rationale });
  }
  if (output.kpis?.length) {
    trail.step("CONSIDERED", `${output.kpis.length} measurable ${output.kpis.length === 1 ? "goal" : "goals"} to check after approval`, {
      outcome: "INFO",
      detail: output.kpis.map((kpi) => `${kpi.name}: ${kpi.higherIsBetter === false ? "at most" : "at least"} ${kpi.target} ${kpi.unit}, measured ${kpi.measureAfterDays} days after approval`).join("\n"),
    });
  }
  trail.step("CONSIDERED", `Voting rules: ${output.governance.quorumPercent}% quorum, ${output.governance.approvalThresholdPercent}% approval, ${output.governance.votingWindowDays}-day vote`, { outcome: "INFO" });

  if (context.inputCheck) {
    trail.policy("The proposal has no instructions aimed at the reviewer", !isSteeringAttempt(context.inputCheck.flags), describeInputFlags(context.inputCheck));
  }
  trail.policy(`Structural score meets the gate (${percent(context.thresholds.structuralGate)}+)`, !failReasons.has("FAIL_STRUCTURAL_GATE"),
    `Structural score ${percent(scores.structural_weighted_score)}`);
  trail.policy(`Mission score meets the minimum (${percent(context.thresholds.missionMinThreshold)}+)`, !failReasons.has("FAIL_MISSION_MIN_THRESHOLD"),
    `Mission score ${percent(scores.mission_weighted_score)}`);
  trail.policy(`At least one mission goal scores strongly (${percent(context.thresholds.strongGoalThreshold)}+)`, !failReasons.has("FAIL_NO_STRONG_MISSION_GOAL"),
    goalScores.length ? `Highest goal score ${percent(Math.max(...goalScores.map((goal) => goal.score)))}` : undefined);
  trail.policy("Maps to the Commons' mission goals", output.evaluation.structural_scores.goal_mapping_valid);
  for (const check of output.audit.checks) trail.policy(CHECK_LABEL[check.name] ?? humanize(check.name), check.passed, check.note ?? undefined);
  const blockers = output.missing_data.filter((item) => item.severity === "BLOCKER" || item.blocking);
  trail.policy("No blocking information is missing", blockers.length === 0, blockers.map((item) => item.question).join("\n") || undefined);
  if (output.decision === "advance") {
    trail.policy(`Budget is under the auto-approve limit (${money(context.aiAutoApproveThresholdUSD, "USD")})`,
      output.budget.amountRequested < context.aiAutoApproveThresholdUSD, `Budget ${money(output.budget.amountRequested, output.budget.currency)}`);
    if (context.autoApproveBlocked) {
      trail.step("POLICY", "Auto-approval withheld because the text tried to instruct the reviewer: council vote instead", { outcome: "FAIL" });
    } else if (output.budget.amountRequested >= context.aiAutoApproveThresholdUSD) {
      trail.step("POLICY", output.budget.amountRequested < context.councilVoteThresholdUSD
        ? `Under the full-vote limit (${money(context.councilVoteThresholdUSD, "USD")}): council vote`
        : `At or over the full-vote limit (${money(context.councilVoteThresholdUSD, "USD")}): full Commons vote with council review`, { outcome: "INFO" });
    }
  }

  trail.taken(`Decision: ${DECISION_LABEL[output.decision] ?? output.decision} → ${STATUS_LABEL[context.finalStatus] ?? context.finalStatus.toLowerCase()}${context.councilRequired ? ", council review required" : ""}`,
    output.decision === "advance" ? "PASS" : "INFO", output.decisionReasons.join("\n") || undefined);
  return trail.setOutcome(`${DECISION_LABEL[output.decision] ?? output.decision} → ${STATUS_LABEL[context.finalStatus] ?? context.finalStatus.toLowerCase()}`);
}

export function buildProposalEngineFailureTrail(context: Pick<ProposalTrailContext, "coopId" | "proposalId" | "trigger" | "rawText">, error: unknown): DecisionTrail {
  return new DecisionTrail({
    agent: "proposal-engine", coopId: context.coopId, proposalId: context.proposalId,
    sourceType: "proposal", sourceId: context.proposalId, trigger: context.trigger, visibility: "COMMONS_MEMBERS",
    observed: { content: context.rawText },
  })
    .step("OBSERVED", "Read the proposal text")
    .taken("The review failed; the proposal was saved without scores", "FAIL")
    .taken("Error", "FAIL", error instanceof Error ? error.message : String(error), true)
    .setOutcome("Review failed");
}

// ── Comment evaluation ───────────────────────────────────────────────────────

export const COMMENT_ALIGNMENT_THRESHOLDS = { aligned: 0.6, neutral: 0.3 };

export function alignmentForScore(score: number): "ALIGNED" | "NEUTRAL" | "MISALIGNED" {
  return score >= COMMENT_ALIGNMENT_THRESHOLDS.aligned ? "ALIGNED" : score >= COMMENT_ALIGNMENT_THRESHOLDS.neutral ? "NEUTRAL" : "MISALIGNED";
}

export interface CommentTrailContext {
  inputCheck?: InputCheck;
  coopId: string;
  proposalId: string;
  proposalTitle: string;
  commentId: string;
  content: string;
  missionGoals: MissionGoal[];
  charterLength: number;
}

export function buildCommentEvaluationTrail(
  evaluation: { alignment: "ALIGNED" | "NEUTRAL" | "MISALIGNED"; score: number; analysis: string; goalsImpacted: string[] },
  context: CommentTrailContext,
): DecisionTrail {
  const goalLabel = new Map(context.missionGoals.map((goal) => [goal.key, goal.label]));
  const trail = new DecisionTrail({
    agent: "comment-evaluation", coopId: context.coopId, proposalId: context.proposalId,
    sourceType: "proposal_comment", sourceId: context.commentId, trigger: "PROPOSAL_COMMENT", visibility: "COMMONS_MEMBERS",
    observed: { content: context.content, context: context.proposalTitle },
  });
  trail.step("OBSERVED", "Read a comment on the proposal");
  if (context.inputCheck) {
    trail.policy("The comment has no instructions aimed at the evaluator", !isSteeringAttempt(context.inputCheck.flags), describeInputFlags(context.inputCheck));
  }
  trail.step("EVIDENCE", context.charterLength > 2000
    ? `The first 2,000 of the charter's ${context.charterLength.toLocaleString("en-US")} characters, and ${context.missionGoals.length} mission goals`
    : `The charter and ${context.missionGoals.length} mission goals`);
  trail.step("CONSIDERED", `${evaluation.alignment.toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase())}: score ${percent(evaluation.score)}`, {
    outcome: "INFO", detail: evaluation.analysis,
  });
  if (evaluation.goalsImpacted.length) {
    trail.step("CONSIDERED", `Goals it touches: ${evaluation.goalsImpacted.map((key) => goalLabel.get(key) ?? key).join(", ")}`, { outcome: "INFO" });
  }
  const expected = alignmentForScore(evaluation.score);
  trail.policy(`The label matches the score (aligned ${percent(COMMENT_ALIGNMENT_THRESHOLDS.aligned)}+, neutral ${percent(COMMENT_ALIGNMENT_THRESHOLDS.neutral)}–${percent(COMMENT_ALIGNMENT_THRESHOLDS.aligned)})`,
    expected === evaluation.alignment, expected === evaluation.alignment ? undefined : `A ${percent(evaluation.score)} score is ${expected.toLowerCase()}, but the label is ${evaluation.alignment.toLowerCase()}`);
  trail.taken(`Labeled the comment ${evaluation.alignment.toLowerCase()}`, "PASS");
  trail.result("Shown next to the comment", "PASS", "None.");
  return trail;
}

export function buildCommentEvaluationFailureTrail(context: Omit<CommentTrailContext, "missionGoals" | "charterLength">, error: unknown): DecisionTrail {
  return new DecisionTrail({
    agent: "comment-evaluation", coopId: context.coopId, proposalId: context.proposalId,
    sourceType: "proposal_comment", sourceId: context.commentId, trigger: "PROPOSAL_COMMENT", visibility: "COMMONS_MEMBERS",
    observed: { content: context.content, context: context.proposalTitle },
  })
    .step("OBSERVED", "Read a comment on the proposal")
    .taken("The evaluation failed; the comment was posted without one", "FAIL")
    .taken("Error", "FAIL", error instanceof Error ? error.message : String(error), true)
    .result("No evaluation shown", "FAIL", "None.")
    .setOutcome("Evaluation failed");
}
