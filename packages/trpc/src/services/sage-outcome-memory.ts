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

/**
 * Recent outcomes of Sage's own suggestions in ONE circle, newest first, as bounded plain-text lines.
 * Scoped by circleId so a private circle's history never reaches another circle or Commons. These are
 * records of what members decided, not facts about the world - the prompt labels them that way.
 */
export async function loadCircleOutcomeMemory(coopId: string, circleId: string, now = new Date()): Promise<string[]> {
  const rows = await db.commonsAction.findMany({
    where: {
      coopId, circleId, type: "SUGGEST_ACTION",
      createdAt: { gte: new Date(now.getTime() - OUTCOME_MEMORY_WINDOW_DAYS * 86400000) },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: OUTCOME_MEMORY_MAX_ITEMS,
    select: {
      summary: true, status: true, createdAt: true, payload: true,
      feedback: { select: { rating: true, notes: true, correctedText: true } },
    },
  });
  const lines: string[] = [];
  let used = 0;
  for (const row of rows) {
    const line = formatOutcomeLine(row);
    if (used + line.length > OUTCOME_MEMORY_MAX_CHARS) break;
    lines.push(line);
    used += line.length;
  }
  return lines;
}
