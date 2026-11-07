import { db } from "@repo/db";

// Fixed budget for what Sage is told about its own past suggestions, so prompt size and cost stay
// flat no matter how long a circle has existed.
export const OUTCOME_MEMORY_MAX_ITEMS = 8;
export const OUTCOME_MEMORY_MAX_CHARS = 1500;
export const OUTCOME_MEMORY_WINDOW_DAYS = 90;
const LINE_MAX_CHARS = 220;

const STATUS_LABEL: Record<string, string> = {
  PENDING: "AWAITING REVIEW",
  APPROVED: "APPROVED",
  PUBLISHED: "PUBLISHED",
  DISMISSED: "DECLINED",
  FAILED: "FAILED",
};

type OutcomeRow = {
  summary: string;
  status: string;
  createdAt: Date;
  payload: unknown;
  feedback: { rating: string; notes: string | null; correctedText: string | null } | null;
};

export function formatOutcomeLine(row: OutcomeRow): string {
  const capability = (row.payload as { capability?: unknown } | null)?.capability;
  const parts = [
    `[${STATUS_LABEL[row.status] ?? row.status}]`,
    row.createdAt.toISOString().slice(0, 10),
    typeof capability === "string" ? capability : null,
    row.summary.replace(/\s+/g, " ").trim(),
  ].filter(Boolean);
  let line = parts.join(" · ");
  if (row.feedback?.correctedText || row.feedback?.notes) {
    line += ` · reviewer correction: ${(row.feedback.correctedText || row.feedback.notes)!.replace(/\s+/g, " ").trim()}`;
  }
  return line.length > LINE_MAX_CHARS ? `${line.slice(0, LINE_MAX_CHARS - 1)}…` : line;
}

/** One live outcome line and the action it came from, so other memory about that action can be dropped. */
export interface LiveOutcome {
  actionId: string;
  text: string;
}

/**
 * Recent outcomes of Sage's own suggestions in ONE circle, newest first, as bounded plain-text lines.
 * Scoped by circleId so a private circle's history never reaches another circle or Commons. These are
 * records of what members decided, not facts about the world - the prompt labels them that way.
 * Read straight from CommonsAction, so the status and any reviewer correction are current.
 */
export async function loadLiveCircleOutcomes(
  coopId: string, circleId: string, now = new Date(),
  budget: { maxItems?: number; maxChars?: number } = {},
): Promise<LiveOutcome[]> {
  const maxItems = budget.maxItems ?? OUTCOME_MEMORY_MAX_ITEMS;
  const maxChars = budget.maxChars ?? OUTCOME_MEMORY_MAX_CHARS;
  const rows = await db.commonsAction.findMany({
    where: {
      coopId, circleId, type: "SUGGEST_ACTION",
      createdAt: { gte: new Date(now.getTime() - OUTCOME_MEMORY_WINDOW_DAYS * 86400000) },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: maxItems,
    select: {
      id: true, summary: true, status: true, createdAt: true, payload: true,
      feedback: { select: { rating: true, notes: true, correctedText: true } },
    },
  });
  const lines: LiveOutcome[] = [];
  let used = 0;
  for (const row of rows) {
    const text = formatOutcomeLine(row);
    if (used + text.length > maxChars) break;
    lines.push({ actionId: row.id, text });
    used += text.length;
  }
  return lines;
}

/** The live outcome lines alone, for callers that don't merge them with consolidated memory. */
export async function loadCircleOutcomeMemory(coopId: string, circleId: string, now = new Date()): Promise<string[]> {
  return (await loadLiveCircleOutcomes(coopId, circleId, now)).map((line) => line.text);
}
