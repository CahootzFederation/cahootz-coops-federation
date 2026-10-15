import { db } from "@repo/db";

import { auditLogEntry } from "../lib/audit.js";
import { recordObservation } from "./ai-memory.js";
import { formatOutcomeLine, loadLiveCircleOutcomes, OUTCOME_MEMORY_MAX_CHARS, OUTCOME_MEMORY_MAX_ITEMS } from "./sage-outcome-memory.js";

/**
 * Sage's long-term memory (P1 memory consolidation).
 *
 * Each wake cycle turns what actually happened - suggestions approved, declined or failed, reviewer
 * corrections, follow-ups done or dropped - into scoped AIObservation rows with sources. These are
 * records of decisions, not facts about the world. When a remembered action changes afterwards (it is
 * published or fails after approval, or a reviewer rates or corrects it), its memory is rewritten to
 * match. Newer outcomes about the same thing supersede older ones, and everything expires. Retrieval is bounded and scoped: a private circle's memory is only
 * ever returned for that circle, and every system read is audited.
 */
export const MEMORY_TTL_DAYS = 180;
export const MEMORY_REVIEW_DAYS = 90;
const CONSOLIDATE_LOOKBACK_DAYS = 30;
const DAY_MS = 86_400_000;
const AGENT_KEY = "sage-memory";

const TERMINAL = ["APPROVED", "DISMISSED", "FAILED", "PUBLISHED"] as const;

const STOPWORDS = new Set(["a", "an", "the", "for", "to", "of", "and", "our", "your", "in", "on", "at", "with", "about", "this", "that", "some", "is", "be"]);
function words(text: string): Set<string> {
  return new Set(text.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((word) => word.length > 2 && !STOPWORDS.has(word))
    .map((word) => (word.length > 4 && word.endsWith("ies") ? `${word.slice(0, -3)}y` : word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word)));
}

/** Share of the smaller word set found in the other; 0 when either is empty. */
export function overlap(a: string, b: string): number {
  const left = words(a);
  const right = words(b);
  if (!left.size || !right.size) return 0;
  const shared = [...left].filter((word) => right.has(word)).length;
  return shared / Math.min(left.size, right.size);
}

/** This memory's own rows for each source, by source id. Other agents' observations that cite the same source don't count. */
async function alreadyRemembered(sourceType: string, sourceIds: string[]): Promise<Map<string, { id: string; summary: string }>> {
  if (!sourceIds.length) return new Map();
  const rows = await db.aIObservationSource.findMany({
    where: { sourceType, sourceId: { in: sourceIds }, observation: { generatedByAgentKey: AGENT_KEY } },
    select: { sourceId: true, observation: { select: { id: true, summary: true } } },
  });
  return new Map(rows.map((row) => [row.sourceId, row.observation]));
}

/** Marks older active memories in the same scope about nearly the same thing as superseded. */
async function supersedeOlder(scopeType: string, scopeId: string, newId: string, title: string): Promise<number> {
  const older = await db.aIObservation.findMany({
    where: { scopeType, scopeId, status: "ACTIVE", generatedByAgentKey: AGENT_KEY, id: { not: newId } },
    select: { id: true, details: true },
  });
  const stale = older.filter((row) => {
    const previous = (row.details as { title?: unknown } | null)?.title;
    return typeof previous === "string" && overlap(previous, title) >= 0.8;
  }).map((row) => row.id);
  if (!stale.length) return 0;
  await db.aIObservation.updateMany({ where: { id: { in: stale } }, data: { status: "SUPERSEDED" } });
  return stale.length;
}

/** Turns recent outcomes in a Commons into memory. Safe to run repeatedly: each source is remembered once. */
export async function consolidateSageMemory(coopId: string, now = new Date()): Promise<{ remembered: number; superseded: number; refreshed: number }> {
  const since = new Date(now.getTime() - CONSOLIDATE_LOOKBACK_DAYS * DAY_MS);
  const [actions, tasks] = await Promise.all([
    // RIDE_MATCH_PROPOSAL is retired, but its old rows still name one member's need and must never be remembered.
    db.commonsAction.findMany({
      // A rating or correction added later changes the feedback row, not the action, so look at both.
      where: {
        coopId, status: { in: [...TERMINAL] }, type: { notIn: ["RIDE_MATCH_PROPOSAL", "CONNECT_MEMBERS", "ESCALATE_TO_ADMIN", "NO_ACTION", "ASK_COMMONS"] },
        OR: [{ updatedAt: { gte: since } }, { feedback: { updatedAt: { gte: since } } }],
      },
      select: { id: true, summary: true, status: true, createdAt: true, payload: true, circleId: true, type: true,
        feedback: { select: { rating: true, notes: true, correctedText: true } } },
      orderBy: { updatedAt: "asc" }, take: 200,
    }),
    db.sageTask.findMany({
      // Suggestion follow-ups aren't remembered separately: the suggestion's own outcome is (above), with
      // personal kinds (introductions) excluded, which a task's title alone can't tell.
      where: { coopId, status: { in: ["DONE", "ABANDONED", "DISMISSED"] }, updatedAt: { gte: since }, subjectType: { not: "suggestion_review" } },
      select: { id: true, title: true, status: true, outcome: true, circleId: true, updatedAt: true },
      orderBy: { updatedAt: "asc" }, take: 200,
    }),
  ]);
  const [doneActions, doneTasks] = await Promise.all([
    alreadyRemembered("commons_action", actions.map((action) => action.id)),
    alreadyRemembered("sage_task", tasks.map((task) => task.id)),
  ]);

  let remembered = 0;
  let superseded = 0;
  let refreshed = 0;
  for (const action of actions) {
    const line = formatOutcomeLine({ summary: action.summary, status: action.status, createdAt: action.createdAt, payload: action.payload, feedback: action.feedback });
    const details = { title: action.summary, status: action.status, actionType: action.type, capability: (action.payload as { capability?: string } | null)?.capability ?? null };
    const existing = doneActions.get(action.id);
    if (existing) {
      // Remembered before its status or feedback changed: bring the memory up to date instead of
      // leaving an outdated outcome next to the live one.
      if (existing.summary !== line) {
        await db.aIObservation.update({ where: { id: existing.id }, data: { summary: line, details } });
        refreshed++;
      }
      continue;
    }
    const scope = action.circleId && !action.circleId.startsWith("general:") ? { scopeType: "circle", scopeId: action.circleId, visibility: "CIRCLE" as const }
      : { scopeType: "commons", scopeId: coopId, visibility: "COMMONS_MEMBERS" as const };
    const row = await recordObservation({
      type: "sage_outcome", ...scope, confidence: 1, summary: line,
      details,
      sources: [{ type: "commons_action", id: action.id }],
      expiresAt: new Date(now.getTime() + MEMORY_TTL_DAYS * DAY_MS), reviewAt: new Date(now.getTime() + MEMORY_REVIEW_DAYS * DAY_MS),
      generatedByAgentKey: AGENT_KEY,
    });
    remembered++;
    superseded += await supersedeOlder(scope.scopeType, scope.scopeId, row.id, action.summary);
  }
  for (const task of tasks) {
    if (doneTasks.has(task.id)) continue;
    const scope = task.circleId ? { scopeType: "circle", scopeId: task.circleId, visibility: "CIRCLE" as const }
      : { scopeType: "commons", scopeId: coopId, visibility: "COMMONS_MEMBERS" as const };
    const label = task.status === "DONE" ? "FOLLOW-UP DONE" : task.status === "DISMISSED" ? "FOLLOW-UP DISMISSED" : "FOLLOW-UP DROPPED";
    await recordObservation({
      type: "sage_follow_up", ...scope, confidence: 1,
      summary: `[${label}] · ${task.updatedAt.toISOString().slice(0, 10)} · ${task.title}${task.outcome ? ` · ${task.outcome}` : ""}`.slice(0, 300),
      details: { title: task.title, status: task.status }, sources: [{ type: "sage_task", id: task.id }],
      expiresAt: new Date(now.getTime() + MEMORY_TTL_DAYS * DAY_MS), reviewAt: new Date(now.getTime() + MEMORY_REVIEW_DAYS * DAY_MS),
      generatedByAgentKey: AGENT_KEY,
    });
    remembered++;
  }
  return { remembered, superseded, refreshed };
}

/** Expires memories past their date in this Commons and its circles. */
export async function expireSageMemory(coopId: string, now = new Date()): Promise<number> {
  const circles = await db.group.findMany({ where: { coopId }, select: { id: true } });
  const result = await db.aIObservation.updateMany({
    where: {
      status: "ACTIVE", expiresAt: { lte: now },
      OR: [{ scopeType: "commons", scopeId: coopId }, { scopeType: "circle", scopeId: { in: circles.map((circle) => circle.id) } }],
    },
    data: { status: "EXPIRED" },
  });
  return result.count;
}

export interface MemoryLine {
  text: string;
  scope: "circle" | "commons";
  sourceIds: string[];
  ageDays: number;
}

/**
 * Bounded, scoped memory for an agent. Reads only this circle's memory (if given) and the Commons'
 * member-visible memory - never another circle's - ranks by relevance to `about` and recency, and
 * stops at the character budget. Every read is audited as a system access.
 */
export async function retrieveSageMemory(input: {
  coopId: string; circleId?: string | null; about?: string; purpose: string; maxItems?: number; maxChars?: number; now?: Date;
}): Promise<MemoryLine[]> {
  const now = input.now ?? new Date();
  const scopes = [
    { scopeType: "commons", scopeId: input.coopId, visibility: { in: ["COMMONS_MEMBERS", "PUBLIC"] as ("COMMONS_MEMBERS" | "PUBLIC")[] } },
    ...(input.circleId && !input.circleId.startsWith("general:") ? [{ scopeType: "circle", scopeId: input.circleId }] : []),
  ];
  const rows = await db.aIObservation.findMany({
    where: {
      status: "ACTIVE", generatedByAgentKey: AGENT_KEY,
      OR: scopes.map((scope) => ({ scopeType: scope.scopeType, scopeId: scope.scopeId, ...("visibility" in scope ? { visibility: scope.visibility } : {}) })),
      AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
    },
    include: { sources: { select: { sourceId: true } } },
    orderBy: { createdAt: "desc" }, take: 100,
  });
  const ranked = rows.map((row) => {
    const ageDays = Math.max(0, Math.floor((now.getTime() - row.createdAt.getTime()) / DAY_MS));
    const title = (row.details as { title?: unknown } | null)?.title;
    const relevance = input.about ? overlap(typeof title === "string" ? title : row.summary, input.about) : 0;
    const recency = 1 / (1 + ageDays / 30);
    return { row, ageDays, score: relevance * 2 + recency + (row.scopeType === "circle" ? 0.25 : 0) };
  }).sort((a, b) => b.score - a.score);

  const maxItems = input.maxItems ?? 8;
  const maxChars = input.maxChars ?? 1500;
  const lines: MemoryLine[] = [];
  let used = 0;
  for (const { row, ageDays } of ranked) {
    if (lines.length >= maxItems) break;
    const text = `${row.summary} (${ageDays}d ago)`;
    if (used + text.length > maxChars) break;
    lines.push({ text, scope: row.scopeType as MemoryLine["scope"], sourceIds: row.sources.map((source) => source.sourceId), ageDays });
    used += text.length;
  }
  await db.auditLog.create({
    data: auditLogEntry({
      actorId: "system/sage", action: "SAGE_MEMORY_READ", resource: "AIObservation", resourceId: input.circleId ?? input.coopId,
      metadata: { coopId: input.coopId, circleId: input.circleId ?? null, purpose: input.purpose, returned: lines.length },
    }),
  }).catch((error) => console.error("Could not audit Sage memory read", error));
  return lines;
}

/** Memory upkeep for one Commons, run by each wake cycle. */
export async function maintainSageMemory(coopId: string, now = new Date()) {
  const consolidated = await consolidateSageMemory(coopId, now);
  const expired = await expireSageMemory(coopId, now);
  return { ...consolidated, expired };
}

export interface OutcomeContextLine {
  text: string;
  /** live: read from the action itself just now. remembered: consolidated memory. */
  origin: "live" | "remembered";
}

/** Share of the outcome budget kept for consolidated memory, so follow-ups and Commons outcomes aren't crowded out. */
const LIVE_MAX_ITEMS = 6;
const LIVE_MAX_CHARS = 1100;

/**
 * Everything a circle agent is told about Sage's past outcomes, as one list under one budget.
 * The circle's own actions come first and straight from CommonsAction, which is the authority for
 * their current status. Consolidated memory then fills the rest with what the live read can't show
 * (follow-up results, Commons-level outcomes, anything older than the live window). A memory whose
 * source is one of the live actions is dropped, so one outcome never appears twice.
 */
export async function loadOutcomeContext(input: {
  coopId: string; circleId: string; about?: string; purpose: string; maxItems?: number; maxChars?: number; now?: Date;
}): Promise<OutcomeContextLine[]> {
  const now = input.now ?? new Date();
  const maxItems = input.maxItems ?? OUTCOME_MEMORY_MAX_ITEMS;
  const maxChars = input.maxChars ?? OUTCOME_MEMORY_MAX_CHARS;
  const live = await loadLiveCircleOutcomes(input.coopId, input.circleId, now, {
    maxItems: Math.min(LIVE_MAX_ITEMS, maxItems), maxChars: Math.min(LIVE_MAX_CHARS, maxChars),
  });
  const liveIds = new Set(live.map((line) => line.actionId));
  const lines: OutcomeContextLine[] = live.map((line) => ({ text: line.text, origin: "live" }));
  let used = live.reduce((sum, line) => sum + line.text.length, 0);
  if (lines.length >= maxItems) return lines;
  const remembered = await retrieveSageMemory({
    coopId: input.coopId, circleId: input.circleId, about: input.about, purpose: input.purpose, maxItems, maxChars, now,
  }).catch(() => []);
  for (const line of remembered) {
    if (lines.length >= maxItems) break;
    if (line.sourceIds.some((id) => liveIds.has(id))) continue;
    if (used + line.text.length > maxChars) break;
    lines.push({ text: line.text, origin: "remembered" });
    used += line.text.length;
  }
  return lines;
}
