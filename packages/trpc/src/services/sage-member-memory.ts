import { db } from "@repo/db";

import { auditLogEntry } from "../lib/audit.js";
import { ASKS_WHAT_SAGE_REMEMBERS, MEMBER_SIGNAL_AGENT_KEY, NEED_SUMMARY_MAX_CHARS, OTHER_NEED_THEME, privateThemeLabel, themeSummary } from "./sage-private-signals.js";
import { cleanseUntrustedText } from "./untrusted-input.js";

/**
 * Needs a member mentioned in weekly check-ins, read back into that member's own private
 * conversations with Sage.
 *
 * The rows are the `member_need_signal` / `member_need_resolution` observations that
 * sage-private-signals.ts saves automatically: a theme plus a short, non-identifying summary
 * ("needs rides to work on weekdays"), never the member's own words. Reads are limited to this one
 * member, to PRIVATE_TO_AUTHOR_SCOPE rows, and to Commons the member still belongs to; with a focus
 * Commons, only needs tied to that Commons. Only the member's 1:1 Sage conversation and their weekly
 * check-in use them, never a feed reply, an @mention or another member's context. Every read is audited.
 *
 * The member can ask "what do you remember about me?" and "forget that / forget 2 / forget
 * everything". Both are answered in code with no model call.
 */
export const MEMBER_MEMORY_MAX_ITEMS = 5;
export const MEMBER_MEMORY_MAX_CHARS = 500;
const MEMBER_MEMORY_TYPES = ["member_need_signal", "member_need_resolution"];
/** A memory request is a short message; anything longer goes to the model as ordinary conversation. */
const MAX_REQUEST_CHARS = 120;

export interface MemberMemoryItem {
  themeKey: string;
  label: string;
  /** The saved one-line summary, or a sentence built from the theme for rows without one. */
  summary: string;
  resolved: boolean;
  /** The day the member told Sage, as YYYY-MM-DD. */
  sourceDate: string;
  commonsName: string | null;
  /** Every active row about this theme, so forgetting it leaves nothing older behind. */
  rowIds: string[];
}

type MemberSignalDetails = { themeKey?: unknown; stance?: unknown; relevantCoopIds?: unknown; sourceDate?: unknown; summaryKind?: unknown };

/** "2026-10-10" → "Oct 10". Memory only holds recent notes, so the year isn't needed. */
function shortDate(sourceDate: string): string {
  const date = new Date(`${sourceDate}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? sourceDate : date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function describe(item: MemberMemoryItem): string {
  const where = item.commonsName ? ` (${item.commonsName})` : "";
  return `${shortDate(item.sourceDate)}: ${item.summary}${where}`;
}

/**
 * The member's remembered needs, newest first, one per theme with the latest thing they said winning.
 * With `focusCoopId` (the Commons of the conversation), only needs tied to that Commons; a need Sage
 * couldn't tie to one Commons is shown only when the member asks what Sage remembers.
 */
export async function loadMemberMemory(input: {
  memberId: string; purpose: string; focusCoopId?: string | null; maxItems?: number; now?: Date;
  /** Only notes saved before this time, so a reply never "remembers" the message it answers. */
  before?: Date;
}): Promise<MemberMemoryItem[]> {
  const now = input.now ?? new Date();
  const [rows, memberships] = await Promise.all([
    db.aIObservation.findMany({
      where: {
        scopeType: "member", scopeId: input.memberId, visibility: "PRIVATE_TO_AUTHOR_SCOPE", status: "ACTIVE",
        generatedByAgentKey: MEMBER_SIGNAL_AGENT_KEY, type: { in: MEMBER_MEMORY_TYPES },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        ...(input.before ? { createdAt: { lt: input.before } } : {}),
      },
      orderBy: { createdAt: "desc" }, take: 50,
      select: { id: true, summary: true, details: true, createdAt: true },
    }),
    db.userCoopMembership.findMany({ where: { userId: input.memberId, status: "ACTIVE" }, select: { coopId: true }, take: 50 }),
  ]);
  const activeCoopIds = new Set(memberships.map((membership) => membership.coopId));

  const byTheme = new Map<string, { themeKey: string; latest: (typeof rows)[number]; details: MemberSignalDetails; coopIds: string[]; rowIds: string[] }>();
  for (const row of rows) {
    const details = (row.details ?? {}) as MemberSignalDetails;
    if (typeof details.themeKey !== "string") continue;
    const coopIds = Array.isArray(details.relevantCoopIds) ? details.relevantCoopIds.filter((id): id is string => typeof id === "string") : [];
    // A theme tied to Commons the member has left stays out; so does one from another Commons when Sage
    // is writing about a specific one.
    if (coopIds.length && !coopIds.some((id) => activeCoopIds.has(id))) continue;
    if (input.focusCoopId && !coopIds.includes(input.focusCoopId)) continue;
    // Notes under "other" are unrelated to each other, so each one is its own item.
    const groupKey = details.themeKey === OTHER_NEED_THEME.key ? `${details.themeKey}:${row.id}` : details.themeKey;
    const existing = byTheme.get(groupKey);
    if (existing) existing.rowIds.push(row.id);
    else byTheme.set(groupKey, { themeKey: details.themeKey, latest: row, details, coopIds, rowIds: [row.id] });
  }

  const singleCoopIds = [...new Set([...byTheme.values()].filter((theme) => theme.coopIds.length === 1).map((theme) => theme.coopIds[0]!))];
  const configs = singleCoopIds.length
    ? await db.coopConfig.findMany({ where: { coopId: { in: singleCoopIds }, isActive: true }, orderBy: { version: "desc" }, select: { coopId: true, name: true } })
    : [];
  const names = new Map<string, string>();
  for (const config of configs) if (!names.has(config.coopId) && config.name) names.set(config.coopId, config.name);

  const maxItems = input.maxItems ?? MEMBER_MEMORY_MAX_ITEMS;
  const items: MemberMemoryItem[] = [];
  let used = 0;
  for (const theme of byTheme.values()) {
    const { themeKey } = theme;
    if (items.length >= maxItems) break;
    const label = privateThemeLabel(themeKey);
    const resolved = theme.details.stance === "CONTRADICT";
    // Summaries are model-written from member text, so they are cleansed again on the way out. Rows
    // saved before summaries existed fall back to the theme sentence.
    const saved = theme.details.summaryKind === "model"
      ? cleanseUntrustedText(theme.latest.summary, { maxChars: NEED_SUMMARY_MAX_CHARS })
      : null;
    const item: MemberMemoryItem = {
      themeKey,
      label,
      summary: saved && saved.text && !saved.flags.length ? saved.text : themeSummary({ themeLabel: label, stance: resolved ? "CONTRADICT" : "SUPPORT" }),
      resolved,
      sourceDate: typeof theme.details.sourceDate === "string" ? theme.details.sourceDate : theme.latest.createdAt.toISOString().slice(0, 10),
      commonsName: theme.coopIds.length === 1 ? names.get(theme.coopIds[0]!) ?? null : null,
      rowIds: theme.rowIds,
    };
    const length = describe(item).length;
    if (used + length > MEMBER_MEMORY_MAX_CHARS) break;
    items.push(item);
    used += length;
  }

  await db.auditLog.create({
    data: auditLogEntry({
      actorId: "system/sage", action: "SAGE_MEMBER_MEMORY_READ", resource: "User", resourceId: input.memberId,
      metadata: { purpose: input.purpose, returned: items.length, focusCoopId: input.focusCoopId ?? null },
    }),
  }).catch((error) => console.error("Could not audit member memory read", error));
  return items;
}

/**
 * Which Commons' needs a Sage DM may use. A DM in a specific Commons sees that Commons. Sage's
 * platform-wide DM sees the Commons the current check-in is about (nothing if that's unclear), and
 * outside a check-in, any Commons the member still belongs to (`focusCoopId: null`).
 * Returns null when no memory may be used.
 */
export function memberMemoryScopeForDm(input: {
  dmCoopId: string; platformCoopId: string; inCheckin: boolean; checkinCoopIds: string[];
}): { focusCoopId: string | null } | null {
  if (input.dmCoopId !== input.platformCoopId) return { focusCoopId: input.dmCoopId };
  if (!input.inCheckin) return { focusCoopId: null };
  return input.checkinCoopIds.length === 1 ? { focusCoopId: input.checkinCoopIds[0]! } : null;
}

/** Prompt lines for a model. Generated by code from themes, so they carry no member-written text. */
export function memberMemoryLines(items: MemberMemoryItem[]): string[] {
  return items.map(describe);
}

/** Instructions that go with memberMemoryLines, for agents that talk to the member privately. */
export const MEMBER_MEMORY_INSTRUCTIONS = [
  "\"You remember\" lists needs this member mentioned in earlier check-ins (date first). You may gently bring one up, for example to ask how it's going, and you may say you remember it.",
  "Never claim to remember anything that isn't listed, never add details they didn't give, and never mention a Commons other than the one shown with an item.",
  "If an item says something is no longer a need, don't ask about it as if it were.",
].join(" ");

/** The prompt section that carries memberMemoryLines. The lines are code-built and cleansed. */
export function memberMemoryPrompt(lines: string[]): string {
  return lines.length ? `You remember (from their earlier check-ins):\n${lines.map((line) => `- ${line}`).join("\n")}` : "";
}

export type MemberMemoryRequest =
  | { kind: "list" }
  | { kind: "forget"; target: "latest" | "all" | number | { words: string } };

/** Recognizes "what do you remember about me?" and "forget …" in a short message. */
export function parseMemberMemoryRequest(content: string): MemberMemoryRequest | null {
  const text = content.trim();
  if (!text || text.length > MAX_REQUEST_CHARS) return null;
  if (ASKS_WHAT_SAGE_REMEMBERS.test(text)) return { kind: "list" };
  if (/\b(?:don'?t|do not|never|not)\s+forget\b/i.test(text)) return null;
  const forget = /\b(?:forget|delete|erase|remove)\b\s*(.*)$/i.exec(text);
  if (!forget) return null;
  const rest = forget[1]!.replace(/[.!?]+$/, "").trim();
  if (/^(?:everything|all(?:\s+of\s+(?:it|that|this|them))?|it\s+all|what\s+you\s+(?:remember|know)(?:\s+about\s+me)?)\b/i.test(rest)) {
    return { kind: "forget", target: "all" };
  }
  const number = /^(?:#|number\s+|item\s+|no\.?\s*)?(\d{1,2})$/i.exec(rest);
  if (number) return { kind: "forget", target: Number(number[1]) };
  if (!rest || /^(?:(?:about\s+)?(?:that|it|this)|the (?:last|latest) one)$/i.test(rest)) return { kind: "forget", target: "latest" };
  // "forget about my ride situation": only when the words name a remembered theme (checked later).
  const words = rest.replace(/^(?:about|that)\s+/i, "");
  return words.length >= 3 && /^forget\b/i.test(text.replace(/^(?:please|can you|could you|sage,?)\s+/i, "")) ? { kind: "forget", target: { words } } : null;
}

function themeMatches(item: MemberMemoryItem, words: string): boolean {
  const wanted = words.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter((word) => word.length > 3);
  const theme = `${item.label} ${item.themeKey.replace(/_/g, " ")}`.toLowerCase();
  // Common ways members name a theme that the label doesn't contain.
  const aliases: Record<string, string[]> = {
    transportation_access: ["ride", "rides", "transport", "carpool", "bus"], food_access: ["food", "groceries", "meals"],
    housing_stability: ["housing", "rent", "home"], time_and_workload: ["schedule", "busy"],
    childcare_and_care: ["childcare", "kids", "babysit", "daycare", "caregiv"], jobs_and_work: ["job", "work", "hiring", "shift"],
    learning_and_school: ["school", "tutor", "class", "homework"], digital_access: ["internet", "wifi", "laptop", "computer", "phone"],
  };
  const extra = aliases[item.themeKey] ?? [];
  return wanted.some((word) => theme.includes(word) || extra.some((alias) => word.startsWith(alias)));
}

const LIST_FOOTER = "Say \"forget 1\" (or another number), \"forget that\" for the newest, or \"forget everything\". I only bring these up in our private chats. When enough members mention the same need, I count it in group totals for your Commons, without your name.";
const NOTHING_KEPT = "I'm not keeping anything about you right now. When you mention a need in a check-in, I jot down a short note, tell you when I do, and forget it whenever you ask.";

/**
 * Answers a memory request in code: lists what Sage remembers, or forgets what the member names.
 * Returns null when the message isn't a memory request, so the conversation carries on as usual.
 * A bare "forget that" only counts when Sage's last message was about remembering; otherwise it
 * probably means "never mind" about something else, and the model handles it.
 */
export async function handleMemberMemoryRequest(input: {
  memberId: string; content: string; lastSageMessage?: string | null; now?: Date;
}): Promise<{ reply: string } | null> {
  const request = parseMemberMemoryRequest(input.content);
  if (!request) return null;
  if (request.kind === "forget" && request.target === "latest" && !/\bremember/i.test(input.lastSageMessage ?? "")) return null;
  const items = await loadMemberMemory({ memberId: input.memberId, purpose: request.kind === "list" ? "member asked what Sage remembers" : "member asked Sage to forget", maxItems: 10, now: input.now });

  if (request.kind === "list") {
    if (!items.length) return { reply: NOTHING_KEPT };
    return { reply: ["Here's what I remember from our check-ins:", ...items.map((item, i) => `${i + 1}. ${describe(item)}`), "", LIST_FOOTER].join("\n") };
  }

  const target = request.target;
  const chosen = target === "all" ? items
    : target === "latest" ? items.slice(0, 1)
    : typeof target === "number" ? items.slice(target - 1, target)
    : items.filter((item) => themeMatches(item, target.words));
  if (!chosen.length) {
    // "forget about the weather" names nothing Sage keeps: let the conversation carry on as usual.
    if (typeof target === "object") return null;
    if (!items.length) return { reply: NOTHING_KEPT };
    return { reply: `I'm not sure which one you meant. ${["Here's what I remember:", ...items.map((item, i) => `${i + 1}. ${describe(item)}`)].join("\n")}\n\nSay "forget" and its number.` };
  }

  const ids = chosen.flatMap((item) => item.rowIds);
  // The member scope is repeated in the update so a wrong id can never touch someone else's memory.
  await db.aIObservation.updateMany({
    where: { id: { in: ids }, scopeType: "member", scopeId: input.memberId, generatedByAgentKey: MEMBER_SIGNAL_AGENT_KEY },
    data: { status: "DISMISSED" },
  });
  await db.auditLog.create({
    data: auditLogEntry({
      actorId: input.memberId, action: "SAGE_MEMBER_MEMORY_FORGOTTEN", resource: "User", resourceId: input.memberId,
      metadata: { themes: chosen.map((item) => item.themeKey), rows: ids.length, all: target === "all" },
    }),
  }).catch((error) => console.error("Could not audit member memory forget", error));

  const what = target === "all" ? `everything I remembered about you (${chosen.length === 1 ? "1 thing" : `${chosen.length} things`})`
    : chosen.map((item) => `"${item.summary}"`).join(" and ");
  return { reply: `Done, I've forgotten ${what}. I won't bring it up again, and it'll drop out of any group totals by tomorrow.` };
}
