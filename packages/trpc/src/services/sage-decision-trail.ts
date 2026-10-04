import { db, type Prisma } from "@repo/db";

import { describeSageAuditEvent } from "./sage-audit-descriptions.js";

/**
 * Sage Decision Trail: one record per Sage analysis, including analyses where Sage did nothing.
 *
 *   Observed → Evidence gathered → Action considered → Policy check → Action taken → Result → Follow-up
 *
 * The first five stages are written while Sage decides. Result and follow-up are derived when the
 * trail is read, from the linked CommonsActions' current status, reviews and audit events, so they
 * never go stale. Steps marked adminOnly (errors, invitations of a named person, admin escalations)
 * are removed before a trail is shown to a member.
 */
export type TrailStage = "OBSERVED" | "EVIDENCE" | "CONSIDERED" | "POLICY" | "TAKEN" | "RESULT" | "FOLLOW_UP";
export type TrailStepOutcome = "PASS" | "FAIL" | "INFO";

export interface TrailStep {
  stage: TrailStage;
  label: string;
  detail?: string;
  outcome?: TrailStepOutcome;
  adminOnly?: boolean;
}

export interface TrailObservedItem {
  author: string;
  content: string;
  at: string;
}

export interface TrailObserved {
  title?: string;
  content?: string;
  context?: string;
  circleName?: string;
  itemCount?: number;
  from?: string;
  to?: string;
  items?: TrailObservedItem[];
}

export type TrailAgent = "commons-action-agent" | "sage-trend" | "sage-ride-match" | "proposal-engine" | "comment-evaluation" | "sage-reply"
  | "cadence" | "guardian" | "steward";
export type TrailSourceType = "commons_post" | "commons_comment" | "circle_window" | "circle_ride_match"
  | "proposal" | "proposal_comment" | "sage_mention" | "sage_dm" | "sage_task" | "sage_alert" | "commons_review";
export type TrailTrigger = "NEW_CONTENT" | "SCHEDULED_SCAN" | "ADMIN_SCAN" | "CIRCLE_WINDOW_FULL" | "ADMIN_ANALYZE"
  | "PROPOSAL_SUBMITTED" | "PROPOSAL_RESUBMITTED" | "PROPOSAL_ALTERNATIVE_APPLIED" | "PROPOSAL_COMMENT" | "SAGE_MENTION" | "SAGE_DM"
  | "SAGE_WAKE" | "ESCALATION";
export type TrailVisibility = "COMMONS_MEMBERS" | "CIRCLE" | "ADMINS";

const MAX_LABEL = 300;
const MAX_DETAIL = 2000;
const MAX_STEPS = 60;
const MAX_OBSERVED_ITEMS = 40;
const MAX_OBSERVED_ITEM_CHARS = 600;
const MAX_OBSERVED_TEXT = 4000;

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function percent(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

function boundObserved(observed: TrailObserved): TrailObserved {
  return {
    ...observed,
    ...(observed.title ? { title: clip(observed.title, MAX_LABEL) } : {}),
    ...(observed.content ? { content: clip(observed.content, MAX_OBSERVED_TEXT) } : {}),
    ...(observed.context ? { context: clip(observed.context, MAX_OBSERVED_TEXT) } : {}),
    ...(observed.items ? {
      items: observed.items.slice(-MAX_OBSERVED_ITEMS).map((item) => ({ ...item, content: clip(item.content, MAX_OBSERVED_ITEM_CHARS) })),
    } : {}),
  };
}

export class DecisionTrail {
  private readonly steps: TrailStep[] = [];
  private readonly actionIds = new Set<string>();
  private readonly relatedPostIds: Set<string>;
  private outcome = "";

  constructor(private readonly base: {
    agent: TrailAgent;
    coopId: string;
    circleId?: string | null;
    proposalId?: string | null;
    sourceType: TrailSourceType;
    sourceId: string;
    trigger: TrailTrigger;
    visibility: TrailVisibility;
    observed: TrailObserved;
    relatedPostIds?: string[];
  }) {
    this.relatedPostIds = new Set(base.relatedPostIds ?? []);
  }

  step(stage: TrailStage, label: string, options: Omit<TrailStep, "stage" | "label"> = {}): this {
    if (this.steps.length >= MAX_STEPS) return this;
    this.steps.push({
      stage, label: clip(label, MAX_LABEL),
      ...(options.detail ? { detail: clip(options.detail, MAX_DETAIL) } : {}),
      ...(options.outcome ? { outcome: options.outcome } : {}),
      ...(options.adminOnly ? { adminOnly: true } : {}),
    });
    return this;
  }

  /** Records a deterministic policy check and returns whether it passed, so callers can gate on it. */
  policy(label: string, passed: boolean, detail?: string, adminOnly = false): boolean {
    this.step("POLICY", label, { outcome: passed ? "PASS" : "FAIL", detail, adminOnly });
    return passed;
  }

  taken(label: string, outcome: TrailStepOutcome = "PASS", detail?: string, adminOnly = false): this {
    return this.step("TAKEN", label, { outcome, detail, adminOnly });
  }

  /** For agents whose result is known immediately, such as a posted reply. */
  result(label: string, outcome: TrailStepOutcome, followUp: string, detail?: string): this {
    return this.step("RESULT", label, { outcome, detail }).step("FOLLOW_UP", followUp);
  }

  linkAction(actionId: string): this {
    this.actionIds.add(actionId);
    return this;
  }

  relatePost(postId: string | null | undefined): this {
    if (postId) this.relatedPostIds.add(postId);
    return this;
  }

  setOutcome(outcome: string): this {
    this.outcome = clip(outcome, MAX_LABEL);
    return this;
  }

  /** A one-line outcome: the explicit one if set, otherwise the actions taken, otherwise "No action". */
  summary(): string {
    if (this.outcome) return this.outcome;
    const taken = this.steps.filter((step) => step.stage === "TAKEN" && !step.adminOnly).map((step) => step.label);
    return clip(taken.length ? taken.join("; ") : "No action", MAX_LABEL);
  }

  snapshot() {
    return {
      ...this.base,
      observed: boundObserved(this.base.observed),
      steps: [...this.steps],
      actionIds: [...this.actionIds],
      relatedPostIds: [...this.relatedPostIds],
      outcome: this.summary(),
    };
  }

  /** Best-effort: a failure to record a trail must never change what Sage does. */
  async save(): Promise<string | null> {
    const data = this.snapshot();
    try {
      const row = await db.sageDecisionTrail.create({
        data: {
          agent: data.agent, coopId: data.coopId, circleId: data.circleId ?? null, proposalId: data.proposalId ?? null,
          sourceType: data.sourceType, sourceId: data.sourceId,
          trigger: data.trigger, visibility: data.visibility, outcome: data.outcome,
          observed: data.observed as Prisma.InputJsonValue, steps: data.steps as unknown as Prisma.InputJsonValue,
          relatedPostIds: data.relatedPostIds, actionIds: data.actionIds,
        },
        select: { id: true },
      });
      return row.id;
    } catch (error) {
      console.error("Could not record Sage decision trail", error);
      return null;
    }
  }
}

// ── Reading ──────────────────────────────────────────────────────────────────

type TrailRow = {
  id: string; agent: string; coopId: string; circleId: string | null; proposalId: string | null;
  sourceType: string; sourceId: string; trigger: string;
  visibility: string; outcome: string; observed: unknown; steps: unknown; relatedPostIds: string[]; actionIds: string[];
  createdAt: Date;
};

type TrailReader = Pick<typeof db, "commonsAction" | "commonsActionReview" | "commonsActionAudit" | "proposal">;

export interface TrailView {
  id: string;
  agent: string;
  agentLabel: string;
  coopId: string;
  circleId: string | null;
  proposalId: string | null;
  sourceType: string;
  sourceId: string;
  trigger: string;
  triggerLabel: string;
  outcome: string;
  observed: TrailObserved;
  steps: TrailStep[];
  relatedPostIds: string[];
  actionIds: string[];
  hiddenSteps: number;
  createdAt: string;
}

const TRIGGER_LABEL: Record<string, string> = {
  NEW_CONTENT: "A new post or comment",
  SCHEDULED_SCAN: "The scheduled catch-up scan",
  ADMIN_SCAN: "A platform admin's manual scan",
  CIRCLE_WINDOW_FULL: "40 new items in the circle",
  ADMIN_ANALYZE: "A platform admin's \"Analyze now\"",
  PROPOSAL_SUBMITTED: "A proposal was submitted",
  PROPOSAL_RESUBMITTED: "The proposer edited and resubmitted",
  PROPOSAL_ALTERNATIVE_APPLIED: "The proposer applied a suggested alternative",
  PROPOSAL_COMMENT: "A comment on a proposal",
  SAGE_MENTION: "A member @mentioned Sage",
  SAGE_DM: "A member messaged Sage directly",
  SAGE_WAKE: "Sage checking back on schedule",
  ESCALATION: "Something needed a person's attention",
};

const AGENT_LABEL: Record<string, string> = {
  "commons-action-agent": "Commons feed",
  "sage-trend": "Circle trends",
  "sage-ride-match": "Ride matches",
  "proposal-engine": "Proposal review",
  "comment-evaluation": "Comment evaluation",
  "sage-reply": "Sage replies",
  cadence: "Follow-ups",
  guardian: "Routing",
  steward: "Steward review",
};
export const TRAIL_AGENTS = Object.keys(AGENT_LABEL);

/** A proposal's current status as the trail's result, so an older review still shows where the proposal ended up. */
function proposalResultSteps(proposal: { status: string; councilRequired: boolean } | undefined): TrailStep[] {
  if (!proposal) return [{ stage: "RESULT", label: "The proposal no longer exists", outcome: "INFO" }, { stage: "FOLLOW_UP", label: "None." }];
  switch (proposal.status) {
    case "SUBMITTED": return [
      { stage: "RESULT", label: "Proposal is now: waiting on the proposer", outcome: "INFO" },
      { stage: "FOLLOW_UP", label: "The proposer revises it or adds the missing information, which runs a new review." },
    ];
    case "VOTABLE": return [
      { stage: "RESULT", label: "Proposal is now: open for voting", outcome: "PASS" },
      { stage: "FOLLOW_UP", label: proposal.councilRequired ? "Members vote, and the council must review it." : "Members vote." },
    ];
    case "APPROVED": return [{ stage: "RESULT", label: "Proposal is now: approved", outcome: "PASS" }, { stage: "FOLLOW_UP", label: "Funding follows the Commons' process." }];
    case "FUNDED": return [{ stage: "RESULT", label: "Proposal is now: funded", outcome: "PASS" }, { stage: "FOLLOW_UP", label: "None." }];
    case "REJECTED": return [{ stage: "RESULT", label: "Proposal is now: rejected", outcome: "FAIL" }, { stage: "FOLLOW_UP", label: "None." }];
    case "FAILED": return [{ stage: "RESULT", label: "Proposal is now: failed", outcome: "FAIL" }, { stage: "FOLLOW_UP", label: "None." }];
    case "WITHDRAWN": return [{ stage: "RESULT", label: "Proposal is now: withdrawn", outcome: "INFO" }, { stage: "FOLLOW_UP", label: "None." }];
    default: return [{ stage: "RESULT", label: `Proposal is now: ${proposal.status.toLowerCase()}`, outcome: "INFO" }];
  }
}

function resultSteps(
  action: { id: string; type: string; status: string },
  reviews: Array<{ actionId: string; reviewType: string; status: string }>,
  audits: Array<{ actionId: string; eventType: string; metadata: unknown; createdAt: Date }>,
): TrailStep[] {
  const history = audits.filter((audit) => audit.actionId === action.id);
  const detail = history.map((audit) => `${audit.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC · ${describeSageAuditEvent(audit.eventType, audit.metadata)}`).join("\n") || undefined;
  const pending = reviews.filter((review) => review.actionId === action.id && review.status === "PENDING");
  const escalated = reviews.some((review) => review.actionId === action.id && review.status === "ESCALATED");
  const refusal = history.find((audit) => audit.eventType === "ACTION_REFUSED")?.metadata as { reason?: unknown } | null | undefined;

  if (action.status === "PENDING") {
    if (escalated) return [
      { stage: "RESULT", label: "Sent to an admin to look at", outcome: "INFO", detail },
      { stage: "FOLLOW_UP", label: "A platform admin decides what happens next." },
    ];
    if (pending.some((review) => review.reviewType === "APPROVE_SUGGESTION")) return [
      { stage: "RESULT", label: "Waiting for approval", outcome: "INFO", detail },
      { stage: "FOLLOW_UP", label: "The circle leader approves or declines it. Nothing happens until then." },
    ];
    if (pending.length) return [
      { stage: "RESULT", label: "Waiting on a member's response", outcome: "INFO", detail },
      { stage: "FOLLOW_UP", label: "The member it concerns responds in Sage Suggestions." },
    ];
    return [
      { stage: "RESULT", label: "In the platform admin's review queue", outcome: "INFO", detail },
      { stage: "FOLLOW_UP", label: "A platform admin approves, edits or dismisses it." },
    ];
  }
  if (action.status === "PUBLISHED") return [
    { stage: "RESULT", label: "Published", outcome: "PASS", detail },
    { stage: "FOLLOW_UP", label: "Nothing pending. A platform admin can remove it." },
  ];
  if (action.status === "APPROVED") return [
    { stage: "RESULT", label: "Done", outcome: "PASS", detail },
    { stage: "FOLLOW_UP", label: "Nothing pending." },
  ];
  if (action.status === "DISMISSED") return [
    { stage: "RESULT", label: "Declined or removed", outcome: "FAIL", detail },
    { stage: "FOLLOW_UP", label: action.type === "SUGGEST_ACTION"
      ? "Nothing pending. Sage won't repeat it in this circle for 30 days."
      : "Nothing pending." },
  ];
  return [
    { stage: "RESULT", label: "Couldn't complete", outcome: "FAIL",
      detail: [typeof refusal?.reason === "string" ? refusal.reason : null, detail].filter(Boolean).join("\n") || undefined },
    { stage: "FOLLOW_UP", label: "Nothing pending." },
  ];
}

/** Adds live result and follow-up steps, and removes admin-only steps for a member's view. */
export async function presentTrails(rows: TrailRow[], options: { forAdmin: boolean }, client: TrailReader = db): Promise<TrailView[]> {
  const actionIds = [...new Set(rows.flatMap((row) => row.actionIds))];
  const proposalIds = [...new Set(rows.filter((row) => row.agent === "proposal-engine" && row.proposalId).map((row) => row.proposalId!))];
  const proposals = proposalIds.length
    ? await client.proposal.findMany({ where: { id: { in: proposalIds } }, select: { id: true, status: true, councilRequired: true } })
    : [];
  const proposalsById = new Map(proposals.map((proposal) => [proposal.id, proposal]));
  const [actions, reviews, audits] = actionIds.length ? await Promise.all([
    client.commonsAction.findMany({ where: { id: { in: actionIds } }, select: { id: true, type: true, status: true } }),
    client.commonsActionReview.findMany({ where: { actionId: { in: actionIds } }, select: { actionId: true, reviewType: true, status: true } }),
    client.commonsActionAudit.findMany({ where: { actionId: { in: actionIds } }, orderBy: { createdAt: "asc" }, select: { actionId: true, eventType: true, metadata: true, createdAt: true } }),
  ]) : [[], [], []];
  const actionsById = new Map(actions.map((action) => [action.id, action]));

  return rows.map((row) => {
    const stored = (Array.isArray(row.steps) ? row.steps : []) as TrailStep[];
    const linked = row.actionIds.map((id) => actionsById.get(id)).filter((action): action is NonNullable<typeof action> => !!action);
    // A member never sees result details for an admin escalation; the escalation itself is admin-only.
    const visibleLinked = options.forAdmin ? linked : linked.filter((action) => action.type !== "ESCALATE_TO_ADMIN");
    // Some agents record their result directly (a Sage reply is posted at once); only derive when they didn't.
    const storedResult = stored.some((step) => step.stage === "RESULT");
    const derived: TrailStep[] = storedResult ? []
      : row.agent === "proposal-engine" && row.proposalId ? proposalResultSteps(proposalsById.get(row.proposalId))
      : visibleLinked.length ? visibleLinked.flatMap((action) => resultSteps(action, reviews, audits))
      : [{ stage: "RESULT", label: "Nothing to follow", outcome: "INFO" }, { stage: "FOLLOW_UP", label: "None." }];
    const all = [...stored, ...derived];
    const steps = options.forAdmin ? all : all.filter((step) => !step.adminOnly);
    return {
      id: row.id, agent: row.agent, agentLabel: AGENT_LABEL[row.agent] ?? row.agent,
      coopId: row.coopId, circleId: row.circleId, proposalId: row.proposalId, sourceType: row.sourceType, sourceId: row.sourceId,
      trigger: row.trigger, triggerLabel: TRIGGER_LABEL[row.trigger] ?? row.trigger,
      outcome: row.outcome, observed: (row.observed ?? {}) as TrailObserved, steps,
      relatedPostIds: row.relatedPostIds, actionIds: options.forAdmin ? row.actionIds : visibleLinked.map((action) => action.id),
      hiddenSteps: all.length - steps.length,
      createdAt: row.createdAt.toISOString(),
    };
  });
}
