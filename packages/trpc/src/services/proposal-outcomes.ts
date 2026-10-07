import { db, type KPIUnit, type ProposalKPI } from "@repo/db";
import type { KPIOutcome, PriorOutcome, ProposalKPI as EngineKPI } from "@repo/validators";

import { auditLogEntry } from "../lib/audit.js";
import { recordObservation } from "./ai-memory.js";
import { MEMORY_REVIEW_DAYS, MEMORY_TTL_DAYS, retrieveSageMemory } from "./sage-memory.js";
import { createSageTask, OUTCOME_WORDS } from "./sage-tasks.js";
import { cleanseUntrustedText, isSteeringAttempt } from "./untrusted-input.js";

/**
 * The proposal outcome loop.
 *
 * The proposal engine sets up to 3 KPIs with a target and a measure date. When a proposal is approved
 * or funded, each KPI gets a measure date and Sage starts an outcome check owned by the proposal's
 * author. On that date Sage privately asks the author for the result (a notification, never a public
 * post), reminds once, and then records "no report". Code, not the model or the author, turns the
 * reported number into met / partly met / missed. Each result is remembered per proposal as a
 * `proposal_outcome` memory, so when a similar proposal comes up later the engine and the Commons agent
 * see what happened last time - labelled as the author's report, not a verified fact.
 *
 * Sage only asks, records and informs. It never votes, spends, or tells members how to vote.
 */
const DAY_MS = 86_400_000;
const DECIDED = ["APPROVED", "FUNDED"] as const;
/** A KPI nobody is following (e.g. the author left the Commons) is closed as "no report" this long after its date. */
export const UNFOLLOWED_NO_REPORT_DAYS = 30;
/** Ask once, remind once. */
const OUTCOME_CHECK_MESSAGES = 2;
/** "Partly met" is at least half way to the target. */
const PARTLY_MET_SHARE = 0.5;
const MEMORY_AGENT_KEY = "sage-memory";
const PRIOR_OUTCOME_MIN_RELEVANCE = 0.5;

// ── Units ─────────────────────────────────────────────────────────────────────

const UNIT_TO_DB: Record<EngineKPI["unit"], KPIUnit> = { USD: "USD", UC: "UC", jobs: "JOBS", percent: "PERCENT", count: "COUNT" };
const UNIT_FROM_DB: Record<KPIUnit, EngineKPI["unit"]> = { USD: "USD", UC: "UC", JOBS: "jobs", PERCENT: "percent", COUNT: "count" };

export function kpiUnitFromDb(unit: KPIUnit): EngineKPI["unit"] {
  return UNIT_FROM_DB[unit] ?? "count";
}

/** Rows for `ProposalKPI.createMany` from the engine's KPIs. */
export function kpiRows(kpis: EngineKPI[] | undefined) {
  return (kpis ?? []).slice(0, 3).map((kpi) => ({
    name: kpi.name.slice(0, 120), target: kpi.target, unit: UNIT_TO_DB[kpi.unit] ?? "COUNT",
    higherIsBetter: kpi.higherIsBetter ?? true, measureAfterDays: kpi.measureAfterDays ?? 90,
  }));
}

export function formatKpiValue(value: number, unit: EngineKPI["unit"]): string {
  const number = Number.isInteger(value) ? value.toLocaleString("en-US") : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (unit === "USD") return `$${number}`;
  if (unit === "percent") return `${number}%`;
  if (unit === "UC") return `${number} coin`;
  if (unit === "jobs") return `${number} ${value === 1 ? "job" : "jobs"}`;
  return number;
}

// ── Deciding the result ───────────────────────────────────────────────────────

/** Met, partly met or missed, decided from the number alone. Partly met is at least half way. */
export function classifyKpiOutcome(kpi: { target: number; higherIsBetter: boolean }, actual: number): Exclude<KPIOutcome, "NO_REPORT"> {
  if (kpi.higherIsBetter) {
    if (actual >= kpi.target) return "MET";
    return kpi.target > 0 && actual >= kpi.target * PARTLY_MET_SHARE ? "PARTLY_MET" : "MISSED";
  }
  if (actual <= kpi.target) return "MET";
  return actual <= kpi.target * (1 + PARTLY_MET_SHARE) ? "PARTLY_MET" : "MISSED";
}

// ── Starting outcome checks ───────────────────────────────────────────────────

async function userIdForWallet(walletAddress: string): Promise<string | null> {
  const user = await db.user.findFirst({
    where: {
      OR: [
        { walletAddress: { equals: walletAddress, mode: "insensitive" } },
        { wallets: { some: { address: { equals: walletAddress, mode: "insensitive" } } } },
      ],
    },
    select: { id: true },
  });
  return user?.id ?? null;
}

/** What Sage waits for, phrased to follow "Waiting for you to …" in the Following tab. */
function checkExpected(kpi: Pick<ProposalKPI, "name" | "target" | "unit" | "higherIsBetter">, proposalTitle: string): string {
  const goal = `${kpi.higherIsBetter ? "at least" : "at most"} ${formatKpiValue(kpi.target, kpiUnitFromDb(kpi.unit))}`;
  return `report how "${kpi.name}" went for "${proposalTitle}" (goal: ${goal})`;
}

/**
 * Gives each KPI of an approved or funded proposal its measure date and starts the author's outcome
 * check. Safe to call repeatedly: a KPI that already has a date is left alone.
 */
export async function startProposalOutcomeTracking(proposalId: string, now = new Date()): Promise<{ started: number; reason?: string }> {
  const proposal = await db.proposal.findUnique({
    where: { id: proposalId },
    select: { id: true, coopId: true, title: true, status: true, proposerWallet: true, kpis: { where: { measureBy: null } } },
  });
  if (!proposal) return { started: 0, reason: "Proposal not found" };
  if (!(DECIDED as readonly string[]).includes(proposal.status)) return { started: 0, reason: "The proposal isn't approved or funded" };
  if (!proposal.kpis.length) return { started: 0, reason: "Nothing left to schedule" };

  const ownerUserId = await userIdForWallet(proposal.proposerWallet);
  let started = 0;
  for (const kpi of proposal.kpis) {
    const measureBy = new Date(now.getTime() + Math.min(365, Math.max(7, kpi.measureAfterDays)) * DAY_MS);
    // Claim the KPI first so two concurrent callers never both start a check.
    const claimed = await db.proposalKPI.updateMany({ where: { id: kpi.id, measureBy: null }, data: { measureBy } });
    if (!claimed.count) continue;
    if (!ownerUserId) continue;
    const result = await createSageTask({
      coopId: proposal.coopId, kind: "CHECK_OUTCOME", title: `${kpi.name} · ${proposal.title}`.slice(0, 160),
      reason: `"${proposal.title}" was ${proposal.status.toLowerCase()}. Sage asks its author how each goal turned out, so the Commons learns what works.`,
      expected: checkExpected(kpi, proposal.title),
      offer: "Sage will show the result on the proposal and remember it when a similar proposal comes up.",
      ownerUserId, subjectType: "proposal_kpi", subjectId: kpi.id, dueAt: measureBy, maxAttempts: OUTCOME_CHECK_MESSAGES,
      createdBy: "SYSTEM",
    }, now);
    if (result.created) started++;
  }
  return { started };
}

// ── Recording results ─────────────────────────────────────────────────────────

/** Closes the KPI's open outcome check, if any, with the result. */
async function closeOutcomeTask(kpiId: string, outcome: string) {
  const open = await db.sageTask.findMany({ where: { subjectType: "proposal_kpi", subjectId: kpiId, status: "OPEN" }, select: { id: true } });
  for (const task of open) {
    await db.sageTask.update({
      where: { id: task.id },
      data: { status: "DONE", outcome, leaseUntil: null, lastWokeAt: new Date(), events: { create: { eventType: "RESOLVED", detail: outcome } } },
    });
  }
  return open.map((task) => task.id);
}

export class OutcomeReportError extends Error {
  constructor(public code: "NOT_FOUND" | "FORBIDDEN" | "BAD_REQUEST", message: string) {
    super(message);
  }
}

/**
 * The proposal's author reports a KPI's result. `actualValue` null means they couldn't measure it.
 * Allowed once the measure date has passed; a later report replaces an earlier one or a "no report".
 */
export async function reportKpiOutcome(input: {
  kpiId: string; userId: string; actualValue: number | null; note?: string | null; now?: Date;
}) {
  const now = input.now ?? new Date();
  const kpi = await db.proposalKPI.findUnique({
    where: { id: input.kpiId },
    include: { proposal: { select: { id: true, coopId: true, status: true, proposerWallet: true, title: true } } },
  });
  if (!kpi) throw new OutcomeReportError("NOT_FOUND", "That goal wasn't found.");
  const ownerUserId = await userIdForWallet(kpi.proposal.proposerWallet);
  if (!ownerUserId || ownerUserId !== input.userId) throw new OutcomeReportError("FORBIDDEN", "Only the proposal's author can report its results.");
  if (!(DECIDED as readonly string[]).includes(kpi.proposal.status)) {
    throw new OutcomeReportError("BAD_REQUEST", "Results can be reported once a proposal is approved or funded.");
  }
  if (!kpi.measureBy || kpi.measureBy > now) {
    throw new OutcomeReportError("BAD_REQUEST", kpi.measureBy
      ? `This goal is measured on ${kpi.measureBy.toISOString().slice(0, 10)}. Report it then.`
      : "This goal doesn't have a measure date yet.");
  }
  if (input.actualValue !== null && (!Number.isFinite(input.actualValue) || input.actualValue < 0)) {
    throw new OutcomeReportError("BAD_REQUEST", "Enter the result as a number of zero or more.");
  }

  const outcome: KPIOutcome = input.actualValue === null ? "NO_REPORT" : classifyKpiOutcome(kpi, input.actualValue);
  const note = input.note?.trim() ? input.note.trim().slice(0, 500) : null;
  const taskIds = await closeOutcomeTask(kpi.id, `The author reported the result: ${OUTCOME_WORDS[outcome]}`);
  const sources = [
    { type: "owner_report", id: input.userId },
    { type: "proposal", id: kpi.proposal.id },
    ...taskIds.map((id) => ({ type: "sage_task", id })),
  ];
  const updated = await db.proposalKPI.update({
    where: { id: kpi.id },
    data: {
      outcome, actualValue: input.actualValue, outcomeNote: note,
      verification: input.actualValue === null ? "NONE" : "OWNER_REPORTED",
      outcomeSources: sources, outcomeRecordedAt: now, reportedById: input.userId,
    },
  });
  await db.auditLog.create({
    data: auditLogEntry({
      actorId: input.userId, action: "PROPOSAL_KPI_OUTCOME_REPORTED", resource: "ProposalKPI", resourceId: kpi.id,
      metadata: { proposalId: kpi.proposal.id, coopId: kpi.proposal.coopId, outcome, actualValue: input.actualValue, target: kpi.target },
    }),
  }).catch((error) => console.error("Could not audit KPI outcome report", error));
  await rememberProposalOutcome(kpi.proposal.id, now).catch((error) => console.error("Could not remember proposal outcome", error));
  return updated;
}

/** Records "no report" for a KPI nobody reported on. Never overwrites a recorded result. */
export async function recordNoReport(kpiId: string, reason: string, now = new Date()): Promise<boolean> {
  const kpi = await db.proposalKPI.findUnique({ where: { id: kpiId }, select: { id: true, proposalId: true } });
  if (!kpi) return false;
  const taskIds = await closeOutcomeTask(kpiId, `No report: ${reason}`);
  const result = await db.proposalKPI.updateMany({
    where: { id: kpiId, outcome: null },
    data: {
      outcome: "NO_REPORT", verification: "NONE", outcomeNote: null, outcomeRecordedAt: now,
      outcomeSources: [{ type: "proposal", id: kpi.proposalId }, ...taskIds.map((id) => ({ type: "sage_task", id })), { type: "reason", id: reason.slice(0, 120) }],
    },
  });
  if (!result.count) return false;
  await rememberProposalOutcome(kpi.proposalId, now).catch((error) => console.error("Could not remember proposal outcome", error));
  return true;
}

/**
 * Wake-cycle upkeep for one Commons: starts outcome checks for approved or funded proposals that don't
 * have them yet (whatever path approved them), and records "no report" where the author dismissed the
 * check, didn't answer it and its reminder, or isn't followed at all a month after the date.
 */
export async function scheduleProposalOutcomeChecks(coopId: string, now = new Date()): Promise<{ started: number; noReport: number }> {
  const pending = await db.proposal.findMany({
    where: { coopId, status: { in: [...DECIDED] }, kpis: { some: { measureBy: null } } },
    select: { id: true }, take: 50,
  });
  let started = 0;
  for (const proposal of pending) started += (await startProposalOutcomeTracking(proposal.id, now)).started;

  const due = await db.proposalKPI.findMany({
    where: { outcome: null, measureBy: { lte: now }, proposal: { coopId, status: { in: [...DECIDED] } } },
    select: { id: true, measureBy: true }, take: 100,
  });
  let noReport = 0;
  for (const kpi of due) {
    const tasks = await db.sageTask.findMany({
      where: { subjectType: "proposal_kpi", subjectId: kpi.id }, select: { status: true }, orderBy: { createdAt: "desc" }, take: 1,
    });
    const last = tasks[0];
    const reason = !last
      ? kpi.measureBy && kpi.measureBy.getTime() <= now.getTime() - UNFOLLOWED_NO_REPORT_DAYS * DAY_MS ? "nobody was following this goal" : null
      : last.status === "DISMISSED" ? "the author dismissed the check-in"
        : last.status === "ABANDONED" ? "no answer after a reminder"
          : last.status === "FAILED" ? "Sage couldn't check this" : null;
    if (reason && await recordNoReport(kpi.id, reason, now)) noReport++;
  }
  return { started, noReport };
}

// ── Memory ────────────────────────────────────────────────────────────────────

/** One memory line for a proposal's results so far. Pure, for tests. */
export function proposalOutcomeLine(proposal: {
  title: string; status: string; budgetAmount: number; budgetCurrency: string;
  kpis: Array<Pick<ProposalKPI, "name" | "target" | "unit" | "outcome" | "actualValue" | "verification" | "outcomeNote" | "outcomeRecordedAt">>;
}, now: Date): string {
  const measured = proposal.kpis.filter((kpi) => kpi.outcome);
  const results = measured.map((kpi) => {
    const unit = kpiUnitFromDb(kpi.unit);
    const word = OUTCOME_WORDS[kpi.outcome!] ?? kpi.outcome!.toLowerCase();
    return kpi.actualValue !== null && kpi.actualValue !== undefined
      ? `${kpi.name}: ${formatKpiValue(kpi.actualValue, unit)} of ${formatKpiValue(kpi.target, unit)} target, ${word}`
      : `${kpi.name}: ${word}`;
  });
  const reported = measured.some((kpi) => kpi.verification === "OWNER_REPORTED");
  const notes = measured.map((kpi) => {
    if (!kpi.outcomeNote) return null;
    // Member-written text goes into future prompts, so it is cleansed, and dropped if it tries to steer.
    const check = cleanseUntrustedText(kpi.outcomeNote, { maxChars: 140 });
    return isSteeringAttempt(check.flags) || !check.text ? null : `author's note: "${check.text}"`;
  }).filter(Boolean);
  const budget = proposal.budgetCurrency === "USD" ? `$${Math.round(proposal.budgetAmount).toLocaleString("en-US")}` : `${Math.round(proposal.budgetAmount).toLocaleString("en-US")} ${proposal.budgetCurrency}`;
  return [
    `[PROPOSAL OUTCOME] · ${now.toISOString().slice(0, 10)} · "${proposal.title}" (${budget}, ${proposal.status.toLowerCase()})`,
    results.join("; "),
    reported ? "reported by the author, not verified" : "no results reported",
    ...notes,
  ].filter(Boolean).join(" · ").slice(0, 500);
}

/**
 * Writes the proposal's results so far into Commons memory, replacing its earlier outcome memory.
 * Commons-wide: proposals are visible to every member of their Commons.
 */
export async function rememberProposalOutcome(proposalId: string, now = new Date()) {
  const proposal = await db.proposal.findUnique({
    where: { id: proposalId },
    select: { id: true, coopId: true, title: true, summary: true, status: true, budgetAmount: true, budgetCurrency: true, kpis: true },
  });
  if (!proposal || !proposal.kpis.some((kpi) => kpi.outcome)) return null;
  const earlier = await db.aIObservation.findMany({
    where: { type: "proposal_outcome", scopeType: "commons", scopeId: proposal.coopId, status: "ACTIVE", sources: { some: { sourceType: "proposal", sourceId: proposal.id } } },
    select: { id: true },
  });
  const reported = proposal.kpis.some((kpi) => kpi.verification === "OWNER_REPORTED");
  const row = await recordObservation({
    type: "proposal_outcome", scopeType: "commons", scopeId: proposal.coopId, visibility: "COMMONS_MEMBERS",
    // An author's own report is a claim, not a verified fact.
    confidence: reported ? 0.6 : 1,
    summary: proposalOutcomeLine(proposal, now),
    details: {
      title: proposal.title, proposalId: proposal.id, status: proposal.status,
      kpis: proposal.kpis.map((kpi) => ({ id: kpi.id, name: kpi.name, target: kpi.target, outcome: kpi.outcome, actualValue: kpi.actualValue, verification: kpi.verification })),
    },
    sources: [{ type: "proposal", id: proposal.id }, ...proposal.kpis.filter((kpi) => kpi.outcome).map((kpi) => ({ type: "proposal_kpi", id: kpi.id }))],
    expiresAt: new Date(now.getTime() + MEMORY_TTL_DAYS * 2 * DAY_MS), reviewAt: new Date(now.getTime() + MEMORY_REVIEW_DAYS * DAY_MS),
    generatedByAgentKey: MEMORY_AGENT_KEY,
  });
  if (earlier.length) await db.aIObservation.updateMany({ where: { id: { in: earlier.map((item) => item.id) } }, data: { status: "SUPERSEDED" } });
  return row;
}

/**
 * Results of past proposals in this Commons similar to the one being reviewed, from Sage's scoped
 * memory (never another Commons'). Excludes the proposal itself. At most 3, within a small budget.
 */
export async function findPriorProposalOutcomes(input: {
  coopId: string; about: { title: string; summary: string }; excludeProposalId?: string; now?: Date;
}): Promise<PriorOutcome[]> {
  const about = `${input.about.title} ${input.about.summary}`.trim();
  if (!about) return [];
  const lines = await retrieveSageMemory({
    coopId: input.coopId, about, purpose: "proposal review: similar past proposals", types: ["proposal_outcome"],
    minRelevance: PRIOR_OUTCOME_MIN_RELEVANCE, maxItems: 4, maxChars: 1200, now: input.now,
  });
  return lines
    .filter((line) => !input.excludeProposalId || !line.sourceIds.includes(input.excludeProposalId))
    .slice(0, 3)
    .map((line) => ({ text: line.text, sourceIds: line.sourceIds, ageDays: line.ageDays }));
}
