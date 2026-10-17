import { db } from "@repo/db";

import { ensureSageBotUser } from "../lib/bot.js";
import { createNotificationAndPush } from "./push-notification-service.js";
import { countQuestionResponders } from "./sage-community-question.js";
import { createSageTask, FULFILLED_TASK_OUTCOMES } from "./sage-tasks.js";
import { findUnansweredNeedPosts } from "./sage-unanswered-needs.js";
import { checkSageOutput, cleanseUntrustedText } from "./untrusted-input.js";

/**
 * Sage's weekly community rhythm in each Commons feed:
 * - Monday: this week's three priorities, from closing votes, upcoming events, open requests and mission goals.
 * - Midweek: requests nobody has answered and conversations waiting on a next step, by title only.
 * - Friday: an appreciation digest counted from verified records only, plus movement toward each mission goal.
 * - Monthly (first days of the month): what improved, what stalled and what could stop, against the month before.
 *
 * Every post is a fixed template filled from records: no model call, no model claims. It goes through
 * Sage's output check, posts at most once per Commons per period (a unique COMMUNITY_RHYTHM action key),
 * and only in Commons with enough active members that counts can't point at one person. Nobody in need
 * is ever named. A helper, host or contributor is named only if they turned on "Name me in Sage's
 * appreciation"; everyone else is a count.
 *
 * Each category is a member setting (SageRhythmPreference): FEED (default) shows the item with no alert,
 * NOTIFY adds an inbox alert and push, MUTED hides the item for that member and sends nothing.
 */
export const SCHEDULED_RHYTHM_CATEGORIES = ["weekly_priorities", "midweek_open_work", "friday_appreciation", "monthly_review"] as const;
export type ScheduledRhythmCategory = (typeof SCHEDULED_RHYTHM_CATEGORIES)[number];
export const RHYTHM_CATEGORIES = [...SCHEDULED_RHYTHM_CATEGORIES, "before_decisions"] as const;
export type RhythmCategory = (typeof RHYTHM_CATEGORIES)[number];
export const RHYTHM_MODES = ["NOTIFY", "FEED", "MUTED"] as const;
export type RhythmMode = (typeof RHYTHM_MODES)[number];
export const DEFAULT_RHYTHM_MODE: RhythmMode = "FEED";
export const RHYTHM_SOURCE = "community_rhythm";
export const RHYTHM_NOTIFICATION_TYPE = "SAGE_RHYTHM";
/** Below this many active members, counts could point at one person, so Sage posts no rhythm at all. */
export const RHYTHM_MIN_ACTIVE_MEMBERS = 5;
/** The first day of each window waits until this UTC hour (morning in the Americas); the catch-up day doesn't. */
export const RHYTHM_POST_HOUR_UTC = 13;
/** A proposal counts toward a mission goal when its score for that goal is at least this. */
export const GOAL_SCORE_THRESHOLD = 0.6;
const CONFIG_KEY = "sage-community-rhythm:v1";
const DAY_MS = 86_400_000;

export const RHYTHM_LABELS: Record<RhythmCategory, { title: string; short: string }> = {
  weekly_priorities: { title: "Monday priorities", short: "Monday priorities" },
  midweek_open_work: { title: "Midweek open requests", short: "midweek open requests" },
  friday_appreciation: { title: "Friday appreciation", short: "Friday appreciation" },
  monthly_review: { title: "Monthly review", short: "monthly review" },
  before_decisions: { title: "Before decisions", short: "before-decision summaries" },
};

export function rhythmClassification(category: RhythmCategory) {
  return `sage_rhythm_${category}`;
}

export function isRhythmCategory(value: unknown): value is RhythmCategory {
  return typeof value === "string" && (RHYTHM_CATEGORIES as readonly string[]).includes(value);
}

export function isScheduledRhythmCategory(value: unknown): value is ScheduledRhythmCategory {
  return typeof value === "string" && (SCHEDULED_RHYTHM_CATEGORIES as readonly string[]).includes(value);
}

// ── Schedule ────────────────────────────────────────────────────────────────

/** ISO week key, e.g. 2026-W42. */
export function isoWeekKey(date: Date): string {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((day.getTime() - yearStart) / DAY_MS + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function monthKey(year: number, month: number) {
  const date = new Date(Date.UTC(year, month, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Which rituals are due now (UTC). Each has a two-day window so a missed cycle catches up the next day;
 * the period key keeps it to one post per window. The monthly review runs on days 1–3 about the month before.
 */
export function dueRhythms(now: Date): Array<{ category: ScheduledRhythmCategory; periodKey: string }> {
  const weekday = now.getUTCDay();
  const hour = now.getUTCHours();
  const due: Array<{ category: ScheduledRhythmCategory; periodKey: string }> = [];
  const week = isoWeekKey(now);
  const window = (first: number, category: ScheduledRhythmCategory) => {
    if ((weekday === first && hour >= RHYTHM_POST_HOUR_UTC) || weekday === first + 1) due.push({ category, periodKey: week });
  };
  window(1, "weekly_priorities");
  window(3, "midweek_open_work");
  window(5, "friday_appreciation");
  const date = now.getUTCDate();
  if ((date === 1 && hour >= RHYTHM_POST_HOUR_UTC) || date === 2 || date === 3) {
    due.push({ category: "monthly_review", periodKey: monthKey(now.getUTCFullYear(), now.getUTCMonth() - 1) });
  }
  return due;
}

// ── Text (pure, from records) ───────────────────────────────────────────────

export interface RhythmText { title: string; body: string }

const DAY_FORMAT = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });

/** A member-written title, cleaned and checked on its own, or null if it can't be shown. */
function safeTitle(raw: string | null | undefined, maxChars = 80): string | null {
  const text = cleanseUntrustedText(raw, { maxChars }).text.replace(/[“”"]/g, "'").trim();
  return text && checkSageOutput(text).ok ? text : null;
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/** Drops list lines from the end until the post fits the output limit. */
function fit(title: string, head: string[], lines: string[], tail: string[]): RhythmText | null {
  const items = [...lines];
  while (items.length) {
    const body = [...head, ...items, ...tail].join("\n").replace(/\n{3,}/g, "\n\n").trim();
    if (checkSageOutput(`${title}\n${body}`).ok) return { title, body };
    items.pop();
  }
  return null;
}

export interface PrioritiesInput {
  proposals: Array<{ id: string; title: string; votingEndsAt: Date; hasDecisionSummary?: boolean }>;
  events: Array<{ title: string; startAt: Date }>;
  openRequests: number;
  goals: Array<{ label: string }>;
}

/** The exact, safe lines selected for Monday's numbered list. Stored with the action for follow-through. */
function selectedPriorityLines(input: PrioritiesInput): string[] {
  const proposals = input.proposals.flatMap((proposal) => {
    const title = safeTitle(proposal.title);
    return title ? [`Vote on '${title}' before voting closes ${DAY_FORMAT.format(proposal.votingEndsAt)}.${proposal.hasDecisionSummary ? " Read the discussion summary in the thread first." : ""}`] : [];
  });
  const events = input.events.flatMap((event) => {
    const title = safeTitle(event.title);
    return title ? [`Show up for '${title}' on ${DAY_FORMAT.format(event.startAt)}.`] : [];
  });
  const requests = input.openRequests > 0
    ? [`Answer a request: ${plural(input.openRequests, "post in the feed is", "posts in the feed are")} still waiting for a reply.`]
    : [];
  const goals = input.goals.flatMap((goal) => {
    const label = safeTitle(goal.label, 60);
    return label ? [`Take one step toward our goal: ${label}.`] : [];
  });
  const firsts = [proposals[0], events[0], requests[0], goals[0]].filter((item): item is string => !!item);
  return [...firsts, ...proposals.slice(1), ...events.slice(1), ...goals.slice(1)].slice(0, 3);
}

/** Monday: up to three priorities, one from each source first (closing vote, event, open requests, goal), then the rest. */
export function prioritiesText(input: PrioritiesInput): RhythmText | null {
  const picked = selectedPriorityLines(input);
  if (!picked.length) return null;
  const title = picked.length === 3 ? "This week's three priorities" : "This week's priorities";
  return fit(title, [], picked.map((item, index) => `${index + 1}. ${item}`), ["", "Choose one if it fits. Reply with the priority number, what you'll do, and invite a partner."]);
}

export interface MondayFollowUp {
  postId: string;
  priorities: string[];
  commitments: Array<{ priority: number | null; text: string }>;
  unowned: Array<{ priority: number; text: string }>;
  feedbackCount: number;
  tasksCreated: number;
}

export interface OpenWorkInput {
  requests: Array<{ title: string }>;
  stalled: Array<{ title: string }>;
  monday?: MondayFollowUp | null;
}

/** Midweek: open requests and stalled conversations by title only. Never who asked or who is in need. */
export function openWorkText(input: OpenWorkInput): RhythmText | null {
  const requests = [...new Set(input.requests.map((request) => safeTitle(request.title)).filter((title): title is string => !!title))].slice(0, 4);
  const stalled = [...new Set(input.stalled.map((item) => safeTitle(item.title)).filter((title): title is string => !!title))]
    .filter((title) => !requests.includes(title)).slice(0, 3);
  const mondayLines = input.monday ? (() => {
    const owned = input.monday.priorities.flatMap((text, index) => {
      const count = input.monday!.commitments.filter((item) => item.priority === index + 1).length;
      return count ? [`• Priority ${index + 1} has ${count === 1 ? "a volunteer" : `${count} volunteers`}: ${text}`] : [];
    });
    const otherOffers = input.monday.commitments.filter((item) => !item.priority).length;
    return [
      "From Monday's priorities:",
      ...owned,
      ...(otherOffers ? [`• ${plural(otherOffers, "other volunteer made", "other volunteers made")} an offer without a priority number.`] : []),
      ...input.monday.unowned.slice(0, 3).map((item) => `• Priority ${item.priority} still needs an owner: ${item.text}`),
      ...(input.monday.feedbackCount ? [`• ${plural(input.monday.feedbackCount, "question or concern needs", "questions or concerns need")} a response.`] : []),
    ];
  })() : [];
  if (!requests.length && !stalled.length && !mondayLines.length) return null;
  const lines = [
    ...mondayLines,
    ...(mondayLines.length && (requests.length || stalled.length) ? [""] : []),
    ...(requests.length ? ["These requests haven't had a reply yet:", ...requests.map((title) => `• '${title}'`)] : []),
    ...(requests.length && stalled.length ? [""] : []),
    ...(stalled.length ? ["These conversations are waiting on a next step:", ...stalled.map((title) => `• '${title}'`)] : []),
  ];
  return fit("Still waiting for a hand", [], lines, ["", "Pick one up, or—with their permission—connect someone who can help. If you volunteered Monday, reply there when the next step is done."]);
}

export interface ActivityCounts {
  helpConfirmed: number;
  requestsAnswered: number;
  resourcesShared: number;
  eventsHosted: number;
  proposalsAdvanced: number;
  commitmentsKept: number;
}

export const EMPTY_ACTIVITY: ActivityCounts = { helpConfirmed: 0, requestsAnswered: 0, resourcesShared: 0, eventsHosted: 0, proposalsAdvanced: 0, commitmentsKept: 0 };

const ACTIVITY_LINES: Array<{ key: keyof ActivityCounts; line: (count: number) => string; label: string }> = [
  { key: "helpConfirmed", label: "Help confirmed", line: (count) => `${plural(count, "time", "times")} a member confirmed someone's help made a difference` },
  { key: "requestsAnswered", label: "Requests answered", line: (count) => `${plural(count, "request", "requests")} got an answer` },
  { key: "resourcesShared", label: "Resources shared", line: (count) => `${plural(count, "resource", "resources")} shared with the Commons` },
  { key: "eventsHosted", label: "Events hosted", line: (count) => `${plural(count, "event", "events")} hosted` },
  { key: "proposalsAdvanced", label: "Proposals moved forward", line: (count) => `${plural(count, "proposal", "proposals")} moved forward` },
  { key: "commitmentsKept", label: "Commitments kept", line: (count) => `${plural(count, "commitment", "commitments")} kept` },
];

export interface GoalMovement { label: string; proposals: number }

function nameList(names: string[]) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Friday: counts from verified records, goal movement, and the names of members who opted in. */
export function appreciationText(counts: ActivityCounts, goals: GoalMovement[], names: string[], monday?: MondayFollowUp | null): RhythmText | null {
  const lines = ACTIVITY_LINES.filter((entry) => counts[entry.key] > 0).map((entry) => `• ${entry.line(counts[entry.key])}`);
  const carry = monday ? [
    `${plural(monday.commitments.length, "member has", "members have")} volunteered on Monday's priorities.`,
    ...(monday.unowned.length ? [`${plural(monday.unowned.length, "priority still needs", "priorities still need")} an owner.`] : []),
    ...(monday.feedbackCount ? [`${plural(monday.feedbackCount, "comment is", "comments are")} still waiting for a response.`] : []),
  ] : [];
  if (!lines.length && !carry.length) return null;
  const goalLines = goals.length && goals.every((goal) => !goal.proposals) ? ["• No proposals tied to our goals moved forward this week."] : goals.flatMap((goal) => {
    const label = safeTitle(goal.label, 60);
    if (!label) return [];
    return [`• ${label}: ${goal.proposals ? `${plural(goal.proposals, "proposal", "proposals")} moved forward` : "nothing recorded this week"}`];
  });
  const shownNames = names.map((name) => safeTitle(name, 40)).filter((name): name is string => !!name).slice(0, 8);
  const thanks = shownNames.length ? `Thank you, ${nameList(shownNames)}, and everyone else who showed up.` : "Thank you to everyone who showed up.";
  return fit("This week's appreciation", ["Here's what members did for each other this week, counted from records in the app:"], [
    ...lines,
    ...(goalLines.length ? ["", "Toward our goals:", ...goalLines] : []),
    ...(carry.length ? ["", "Still open from Monday:", ...carry.map((line) => `• ${line}`)] : []),
  ], ["", thanks, "Reply with a specific thank-you, an update on an open priority, or a contribution the records missed.", "Members are named only if they turn it on in Sage settings."]);
}

export interface StopCandidate { text: string }

/** Monthly: each count against the month before. Improved means up; stalled means flat or down from something. */
export function monthlyText(monthLabel: string, current: ActivityCounts, previous: ActivityCounts, stops: StopCandidate[]): RhythmText | null {
  const compared = ACTIVITY_LINES.filter((entry) => current[entry.key] > 0 || previous[entry.key] > 0);
  if (!compared.length) return null;
  const improved = compared.filter((entry) => current[entry.key] > previous[entry.key])
    .map((entry) => `• ${entry.label}: ${current[entry.key]} (up from ${previous[entry.key]})`);
  const stalled = compared.filter((entry) => current[entry.key] <= previous[entry.key])
    .map((entry) => `• ${entry.label}: ${current[entry.key]} (${current[entry.key] === previous[entry.key] ? "same as" : "down from"} ${previous[entry.key]})`);
  const stopLines = stops.slice(0, 3).map((stop) => `• ${stop.text}`);
  return fit(`How ${monthLabel} went`, [`Comparing ${monthLabel} with the month before, from records in the app:`], [
    "", "What improved:", ...(improved.length ? improved : ["• Nothing grew this month."]),
    "", "What stalled:", ...(stalled.length ? stalled : ["• Nothing slipped this month."]),
    "", "What could stop:", ...(stopLines.length ? stopLines : ["• Nothing stands out. Reply if something isn't working."]),
  ], ["", "Reply with one thing to keep, change, or stop next month."]);
}

// ── Records ─────────────────────────────────────────────────────────────────

function generalFeed(coopId: string) {
  return [{ circleId: null }, { circleId: `general:${coopId}` }];
}

const NEED_POST = { OR: [{ tag: { in: ["Need", "Ask"] } }, { classification: "need" }] };

/**
 * When a proposal has a published before-decision summary, Monday's priority line points members to it.
 */
export async function hasDecisionSummary(proposalId: string): Promise<boolean> {
  return !!(await db.commonsAction.findFirst({
    where: { type: "SUMMARIZE_DISCUSSION", sourceId: proposalId, status: "PUBLISHED" },
    select: { id: true },
  }));
}

export async function countActiveMembers(coopId: string) {
  return db.userCoopMembership.count({ where: { coopId, status: "ACTIVE", user: { isBot: false } } });
}

async function missionGoals(coopId: string): Promise<Array<{ key: string; label: string; weight: number }>> {
  const config = await db.coopConfig.findFirst({ where: { coopId, isActive: true }, orderBy: { version: "desc" }, select: { missionGoals: true } });
  const raw = Array.isArray(config?.missionGoals) ? config.missionGoals : [];
  return raw.flatMap((goal) => {
    const value = goal as { key?: unknown; label?: unknown; priorityWeight?: unknown };
    return typeof value.key === "string" && typeof value.label === "string"
      ? [{ key: value.key, label: value.label, weight: typeof value.priorityWeight === "number" ? value.priorityWeight : 0 }]
      : [];
  }).sort((a, b) => b.weight - a.weight);
}

export async function gatherPriorities(coopId: string, now: Date): Promise<PrioritiesInput> {
  const weekAhead = new Date(now.getTime() + 7 * DAY_MS);
  const [proposals, events, requests, goals] = await Promise.all([
    db.proposal.findMany({
      where: { coopId, status: "VOTABLE", votingEndsAt: { gte: now, lte: weekAhead } },
      orderBy: { votingEndsAt: "asc" }, take: 5, select: { id: true, title: true, votingEndsAt: true },
    }),
    db.event.findMany({
      where: { coopId, OR: generalFeed(coopId), startAt: { gte: now, lte: weekAhead } },
      orderBy: { startAt: "asc" }, take: 5, select: { startAt: true, post: { select: { title: true } } },
    }),
    findUnansweredNeedPosts(coopId, now),
    missionGoals(coopId),
  ]);
  return {
    proposals: await Promise.all(proposals.map(async (proposal) => ({
      id: proposal.id, title: proposal.title, votingEndsAt: proposal.votingEndsAt!, hasDecisionSummary: await hasDecisionSummary(proposal.id),
    }))),
    events: events.map((event) => ({ title: event.post.title, startAt: event.startAt })),
    openRequests: requests.length,
    goals,
  };
}

const COMMITMENT_RE = /\b(?:i(?:'|’)ll|i will|i(?:'|’)m going to|i am going to|count me in|i volunteer|i can (?:take|help|host|call|bring|write|draft|organize|lead|answer|contact|review|share|do|handle|own))\b/i;
const OPEN_FEEDBACK_RE = /\?|\b(?:concern|disagree|missing|what about|how (?:will|do|can)|who (?:will|can)|cannot|can't|need an? (?:answer|decision))\b/i;

/** Only first-person, explicit offers count as commitments. Agreement and "we should" do not. */
export function explicitCommitment(raw: string): { text: string; priority: number | null } | null {
  if (!COMMITMENT_RE.test(raw)) return null;
  const text = cleanseUntrustedText(raw, { maxChars: 120 }).text.replace(/\s+/g, " ").replace(/[“”"]/g, "'").trim();
  if (!text || !checkSageOutput(text).ok) return null;
  const numbered = raw.match(/^\s*(?:#|priority\s*)?([1-3])\b/i) ?? raw.match(/\bpriority\s*#?([1-3])\b/i);
  return { text, priority: numbered ? Number(numbered[1]) : null };
}

/**
 * Reopens the current week's Monday thread from its audit record. Public replies are summarized without
 * naming members. Explicit first-person offers become ledger tasks; vague support never becomes ownership.
 */
export async function gatherMondayFollowUp(coopId: string, periodKey: string, now = new Date()): Promise<MondayFollowUp | null> {
  const action = await db.commonsAction.findUnique({
    where: { sourceType_sourceId_contentHash_charterConfigId_position: rhythmKey(coopId, "weekly_priorities", periodKey) },
    select: { id: true, sourcePostId: true, payload: true },
  });
  if (!action) return null;
  const payload = action.payload as { priorities?: unknown } | null;
  const priorities = Array.isArray(payload?.priorities)
    ? payload!.priorities.flatMap((item) => typeof item === "string" && safeTitle(item, 180) ? [safeTitle(item, 180)!] : []).slice(0, 3)
    : [];
  if (!priorities.length) return null;
  const comments = await db.commonsComment.findMany({
    where: { postId: action.sourcePostId, author: { isBot: false } },
    orderBy: { createdAt: "asc" },
    select: { id: true, authorId: true, content: true },
  });
  const commitments: MondayFollowUp["commitments"] = [];
  let tasksCreated = 0;
  for (const comment of comments) {
    const commitment = explicitCommitment(comment.content);
    if (!commitment) continue;
    commitments.push(commitment);
    const subjectId = `${action.sourcePostId}:${comment.id}`;
    const existing = await db.sageTask.findFirst({
      where: { coopId, subjectType: "commons_post", subjectId, ownerUserId: comment.authorId }, select: { id: true },
    });
    if (existing) continue;
    const task = await createSageTask({
      coopId, circleId: `general:${coopId}`, kind: "FOLLOW_UP",
      title: "Follow through on Monday's priorities",
      reason: "The member explicitly volunteered in Sage's Monday priorities thread.",
      expected: commitment.text, ownerUserId: comment.authorId,
      subjectType: "commons_post", subjectId,
      postId: action.sourcePostId, sourceActionId: action.id, dueInDays: 5, createdBy: "SYSTEM",
    }, now);
    if (task.created) tasksCreated++;
  }
  const owned = new Set(commitments.flatMap((item) => item.priority ? [item.priority] : []));
  return {
    postId: action.sourcePostId,
    priorities,
    commitments,
    unowned: priorities.flatMap((text, index) => owned.has(index + 1) ? [] : [{ priority: index + 1, text }]),
    feedbackCount: comments.filter((comment) => !explicitCommitment(comment.content) && OPEN_FEEDBACK_RE.test(comment.content)).length,
    tasksCreated,
  };
}

export async function gatherOpenWork(coopId: string, now: Date, needPostIds?: string[]): Promise<OpenWorkInput & { postIds: string[] }> {
  const requests = await findUnansweredNeedPosts(coopId, now, needPostIds);
  // Follow-ups on public threads that passed their due date without the next step, or that Sage gave up on lately.
  const tasks = await db.sageTask.findMany({
    where: {
      coopId, subjectType: "commons_post",
      OR: [
        { status: "OPEN", dueAt: { lt: now }, attempts: { gte: 1 } },
        { status: "ABANDONED", updatedAt: { gte: new Date(now.getTime() - 14 * DAY_MS) } },
      ],
    },
    orderBy: { dueAt: "asc" }, take: 20, select: { postId: true, subjectId: true },
  });
  const postIds = [...new Set(tasks.map((task) => task.postId ?? task.subjectId))];
  const stalled = postIds.length
    ? await db.commonsPost.findMany({ where: { id: { in: postIds }, coopId, OR: generalFeed(coopId) }, select: { id: true, title: true } })
    : [];
  return {
    requests: requests.map((post) => ({ title: post.title })),
    stalled: stalled.map((post) => ({ title: post.title })),
    postIds: [...requests.map((post) => post.id), ...stalled.map((post) => post.id)],
  };
}

export interface Activity { counts: ActivityCounts; contributorIds: Set<string>; goals: GoalMovement[] }

/** Verified actions in [from, to): each count comes from a record a member's action created, never a model claim. */
export async function gatherActivity(coopId: string, from: Date, to: Date): Promise<Activity> {
  const range = { gte: from, lt: to };
  const contributorIds = new Set<string>();
  const add = (id: string | null | undefined) => { if (id) contributorIds.add(id); };

  // Help: the member who was helped said yes, it helped (HELP_CONFIRMED on the introduction). Only the helper is credited.
  const helped = await db.commonsActionAudit.findMany({
    where: { eventType: "HELP_CONFIRMED", createdAt: range, action: { coopId } },
    select: { actionId: true, action: { select: { participants: { where: { role: "HELPER" }, select: { userId: true } } } } },
  });
  helped.forEach((entry) => entry.action.participants.forEach((participant) => add(participant.userId)));

  // Requests answered: a Need/Ask post's first reply from someone other than its author landed in the window.
  const replies = await db.commonsComment.findMany({
    where: { createdAt: range, author: { isBot: false }, post: { coopId, AND: [NEED_POST, { OR: generalFeed(coopId) }] } },
    orderBy: { createdAt: "asc" }, take: 500,
    select: { postId: true, authorId: true, post: { select: { authorId: true } } },
  });
  const firstReplies = new Map<string, string>();
  for (const reply of replies) {
    if (reply.authorId === reply.post.authorId || firstReplies.has(reply.postId)) continue;
    firstReplies.set(reply.postId, reply.authorId);
  }
  if (firstReplies.size) {
    const earlier = await db.commonsComment.findMany({
      where: { postId: { in: [...firstReplies.keys()] }, createdAt: { lt: from }, author: { isBot: false } },
      select: { postId: true, authorId: true, post: { select: { authorId: true } } },
    });
    earlier.filter((reply) => reply.authorId !== reply.post.authorId).forEach((reply) => firstReplies.delete(reply.postId));
  }
  firstReplies.forEach((authorId) => add(authorId));

  // Resources: published after a person verified them.
  const resources = await db.commonsResource.findMany({ where: { coopId, status: "PUBLISHED", publishedAt: range }, select: { candidateUserId: true } });
  resources.forEach((resource) => add(resource.candidateUserId));

  // Events hosted: ended in the window, before now, with at least one member other than a host saying they'd go.
  const ended = await db.event.findMany({
    where: { coopId, endAt: { gte: from, lt: new Date(Math.min(to.getTime(), Date.now())) } },
    select: { hosts: { select: { userId: true } }, rsvps: { where: { status: "GOING" }, select: { userId: true } } },
  });
  const held = ended.filter((event) => {
    const hosts = new Set(event.hosts.map((host) => host.userId));
    return event.hosts.length > 0 && event.rsvps.some((rsvp) => !hosts.has(rsvp.userId));
  });
  held.forEach((event) => event.hosts.forEach((host) => add(host.userId)));

  // Proposals that reached voting, approval or funding (status is the record; timing is its last update).
  const proposals = await db.proposal.findMany({
    where: { coopId, status: { in: ["VOTABLE", "APPROVED", "FUNDED"] }, updatedAt: range, withdrawnAt: null },
    select: { id: true },
  });

  // Commitments: a member's follow-up that Sage closed because they did what they said, checked from app data.
  const kept = await db.sageTask.findMany({
    where: { coopId, status: "DONE", updatedAt: range, outcome: { in: Object.values(FULFILLED_TASK_OUTCOMES) } },
    select: { ownerUserId: true },
  });
  kept.forEach((task) => add(task.ownerUserId));

  const goals = await missionGoals(coopId);
  const scores = proposals.length && goals.length
    ? await db.proposalGoalScore.findMany({
        where: { proposalId: { in: proposals.map((proposal) => proposal.id) }, finalScore: { gte: GOAL_SCORE_THRESHOLD } },
        select: { proposalId: true, goalId: true },
      })
    : [];
  const byGoal = new Map<string, Set<string>>();
  scores.forEach((score) => byGoal.set(score.goalId, (byGoal.get(score.goalId) ?? new Set()).add(score.proposalId)));

  return {
    counts: {
      helpConfirmed: helped.length, requestsAnswered: firstReplies.size, resourcesShared: resources.length,
      eventsHosted: held.length, proposalsAdvanced: proposals.length, commitmentsKept: kept.length,
    },
    contributorIds,
    goals: goals.slice(0, 3).map((goal) => ({ label: goal.label, proposals: byGoal.get(goal.key)?.size ?? 0 })),
  };
}

/** Names of contributors who opted in and are still active members here. Everyone else stays a count. */
export async function consentedNames(coopId: string, userIds: Set<string>): Promise<string[]> {
  if (!userIds.size) return [];
  const users = await db.user.findMany({
    where: {
      id: { in: [...userIds] }, isBot: false, nameInSageAppreciation: true, deletedAt: null,
      memberships: { some: { coopId, status: "ACTIVE" } },
    },
    orderBy: { name: "asc" },
    select: { name: true, handle: true },
  });
  return users.map((user) => user.name?.trim() || user.handle?.trim() || "").filter(Boolean);
}

/** Deterministic "could stop" candidates for a month: unanswered rhythm posts, stuck proposals, unattended series. */
export async function gatherStopCandidates(coopId: string, from: Date, to: Date): Promise<StopCandidate[]> {
  const stops: StopCandidate[] = [];
  const posts = await db.commonsAction.findMany({
    where: { coopId, type: "COMMUNITY_RHYTHM", status: "PUBLISHED", createdAt: { gte: from, lt: to } },
    select: { sourcePostId: true, payload: true },
  });
  const byCategory = new Map<RhythmCategory, string[]>();
  posts.forEach((post) => {
    const category = (post.payload as { category?: unknown } | null)?.category;
    if (isRhythmCategory(category) && category !== "monthly_review") byCategory.set(category, [...(byCategory.get(category) ?? []), post.sourcePostId]);
  });
  for (const [category, postIds] of byCategory) {
    if (postIds.length < 2) continue;
    const responders = await Promise.all(postIds.map((postId) => countQuestionResponders(postId)));
    if (responders.every((count) => !count)) {
      stops.push({ text: `Sage's ${RHYTHM_LABELS[category].short} posts got no replies or reactions. If they aren't useful, mute them in Sage settings or say so here.` });
    }
  }
  const weeklyActionIds = posts.flatMap((post) => {
    const category = (post.payload as { category?: unknown } | null)?.category;
    return category === "weekly_priorities" ? [post.sourcePostId] : [];
  });
  if (weeklyActionIds.length) {
    const comments = await db.commonsComment.findMany({
      where: { postId: { in: weeklyActionIds }, createdAt: { lt: to }, author: { isBot: false } },
      orderBy: { createdAt: "asc" }, select: { postId: true, content: true, createdAt: true },
    });
    const unansweredFeedback = comments.filter((comment, index) => OPEN_FEEDBACK_RE.test(comment.content)
      && !comments.slice(index + 1).some((later) => later.postId === comment.postId && later.createdAt > comment.createdAt)).length;
    if (unansweredFeedback) stops.push({
      text: `${plural(unansweredFeedback, "question or concern in a Monday priority thread has", "questions or concerns in Monday priority threads have")} no later response. Carry them into next month.`,
    });
    const openCommitments = await db.sageTask.count({
      where: { coopId, status: "OPEN", postId: { in: weeklyActionIds }, createdAt: { gte: from, lt: to } },
    });
    if (openCommitments) stops.push({ text: `${plural(openCommitments, "commitment from a Monday priority is", "commitments from Monday priorities are")} still open. Finish, reassign, or close them.` });
  }
  const stuck = await db.proposal.count({ where: { coopId, status: "SUBMITTED", withdrawnAt: null, createdAt: { lt: new Date(to.getTime() - 30 * DAY_MS) } } });
  if (stuck) stops.push({ text: `${plural(stuck, "proposal has", "proposals have")} waited more than 30 days without reaching a vote. Revive or withdraw them.` });
  const series = await db.event.findMany({
    where: { coopId, seriesId: { not: null }, endAt: { gte: from, lt: to } },
    select: { seriesId: true, post: { select: { title: true } }, rsvps: { where: { status: "GOING" }, select: { id: true } } },
  });
  const bySeries = new Map<string, { title: string; sessions: number; going: number }>();
  series.forEach((event) => {
    const entry = bySeries.get(event.seriesId!) ?? { title: event.post.title, sessions: 0, going: 0 };
    bySeries.set(event.seriesId!, { ...entry, sessions: entry.sessions + 1, going: entry.going + event.rsvps.length });
  });
  for (const entry of bySeries.values()) {
    const title = safeTitle(entry.title);
    if (title && entry.sessions >= 2 && entry.going === 0) stops.push({ text: `'${title}' had no RSVPs across ${entry.sessions} sessions. Pause it or change the time?` });
  }
  return stops;
}

// ── Publishing ──────────────────────────────────────────────────────────────

export function rhythmSourceId(coopId: string, category: ScheduledRhythmCategory, periodKey: string) {
  return `${coopId}:${category}:${periodKey}`;
}

function rhythmKey(coopId: string, category: ScheduledRhythmCategory, periodKey: string) {
  return { sourceType: RHYTHM_SOURCE, sourceId: rhythmSourceId(coopId, category, periodKey), contentHash: category, charterConfigId: CONFIG_KEY, position: 0 };
}

export type RhythmResult = { category: ScheduledRhythmCategory; periodKey: string; posted: boolean; reason?: string; postId?: string; actionId?: string; notified?: number };

/** Inbox alert and push for members who chose NOTIFY for this category. MUTED and FEED members get nothing. */
export async function notifyRhythmSubscribers(
  coopId: string,
  category: RhythmCategory,
  notification: { title: string; body: string; data: Record<string, string> },
): Promise<number> {
  const subscribers = await db.sageRhythmPreference.findMany({
    where: { category, mode: "NOTIFY", user: { isBot: false, memberships: { some: { coopId, status: "ACTIVE" } } } },
    select: { userId: true },
  });
  let notified = 0;
  for (const { userId } of subscribers) {
    try {
      await createNotificationAndPush(db as never, {
        userId, coopId, type: RHYTHM_NOTIFICATION_TYPE, title: notification.title, body: notification.body.slice(0, 140),
        data: { ...notification.data, coopId, category },
      });
      notified++;
    } catch (error) {
      console.error("Could not send a Sage rhythm alert", { coopId, category, error });
    }
  }
  return notified;
}

/**
 * Claims the period's key, then posts (or records why not). The unique action key means two overlapping
 * wake cycles can't both post; a period with nothing to say is recorded as dismissed, so it isn't retried.
 */
export async function publishRhythmPost(
  coopId: string, category: ScheduledRhythmCategory, periodKey: string, text: RhythmText | null, extra: Record<string, unknown> = {},
): Promise<RhythmResult> {
  const base = { category, periodKey };
  const check = text ? checkSageOutput(`${text.title}\n${text.body}`) : null;
  const requestedSkip = typeof extra.skipReason === "string" ? extra.skipReason : null;
  const reason = requestedSkip ?? (!text ? "Nothing to post for this period" : !check!.ok ? "The post failed Sage's output check" : null);
  const sage = await ensureSageBotUser(db, coopId);
  let action;
  try {
    action = await db.commonsAction.create({
      data: {
        coopId, ...rhythmKey(coopId, category, periodKey), sourcePostId: rhythmSourceId(coopId, category, periodKey), sourceAuthorId: sage.id,
        type: "COMMUNITY_RHYTHM", status: reason ? "DISMISSED" : "PENDING",
        summary: reason ? `Sage skipped the ${RHYTHM_LABELS[category].short} post: ${reason.toLowerCase()}` : `Sage's ${RHYTHM_LABELS[category].short} post`,
        confidence: 1, draftText: text?.body ?? null, generatedDraftText: text?.body ?? null,
        payload: { category, periodKey, title: text?.title ?? null, body: text?.body ?? null, ...extra },
        auditEvents: { create: { eventType: reason ? "RHYTHM_SKIPPED" : "SUGGESTION_CREATED", metadata: { kind: RHYTHM_SOURCE, category, periodKey, ...(reason ? { reason } : {}) } } },
      },
      select: { id: true },
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return { ...base, posted: false, reason: "Already posted this period" };
    throw error;
  }
  if (reason || !text) return { ...base, posted: false, reason: reason ?? undefined, actionId: action.id };

  try {
    const post = await db.commonsPost.create({
      data: {
        coopId, circleId: `general:${coopId}`, authorId: sage.id, title: text.title, content: text.body, tag: "Update",
        classification: rhythmClassification(category), classificationConfidence: 1,
        classificationSignals: { version: 1, source: RHYTHM_SOURCE, actionId: action.id, category, periodKey },
      },
      select: { id: true },
    });
    // sourcePostId now points at the post itself, so the admin page can remove it.
    await db.commonsAction.update({ where: { id: action.id }, data: { status: "PUBLISHED", sourcePostId: post.id } });
    await db.commonsActionAudit.create({ data: { actionId: action.id, eventType: "RHYTHM_POSTED", metadata: { resultEntityType: "CommonsPost", resultEntityId: post.id, category } } });
    const notified = await notifyRhythmSubscribers(coopId, category, {
      title: `Sage: ${text.title}`,
      body: text.body.split("\n").find(Boolean)!,
      data: { postId: post.id },
    });
    return { ...base, posted: true, postId: post.id, actionId: action.id, notified };
  } catch (error) {
    await db.commonsAction.update({ where: { id: action.id }, data: { status: "FAILED" } }).catch(() => {});
    await db.commonsActionAudit.create({ data: { actionId: action.id, eventType: "ACTION_FAILED", metadata: { error: error instanceof Error ? error.message : String(error) } } }).catch(() => {});
    throw error;
  }
}

const MONTH_FORMAT = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" });

/** Builds one ritual's text from records. `needPostIds` is an internal test control (E2E fixtures), never a public input. */
export async function buildRhythm(
  coopId: string, category: ScheduledRhythmCategory, periodKey: string, now: Date,
  options: { needPostIds?: string[]; mondayPeriodKey?: string } = {},
): Promise<{ text: RhythmText | null; extra: Record<string, unknown> }> {
  if (category === "weekly_priorities") {
    const input = await gatherPriorities(coopId, now);
    return { text: prioritiesText(input), extra: { proposalIds: input.proposals.map((proposal) => proposal.id), priorities: selectedPriorityLines(input) } };
  }
  if (category === "midweek_open_work") {
    const [input, monday] = await Promise.all([
      gatherOpenWork(coopId, now, options.needPostIds), gatherMondayFollowUp(coopId, options.mondayPeriodKey ?? isoWeekKey(now), now),
    ]);
    return { text: openWorkText({ ...input, monday }), extra: { postIds: input.postIds, mondayPostId: monday?.postId, commitments: monday?.commitments.length ?? 0, tasksCreated: monday?.tasksCreated ?? 0 } };
  }
  if (category === "friday_appreciation") {
    const [activity, monday] = await Promise.all([
      gatherActivity(coopId, new Date(now.getTime() - 7 * DAY_MS), now), gatherMondayFollowUp(coopId, options.mondayPeriodKey ?? isoWeekKey(now), now),
    ]);
    const names = await consentedNames(coopId, activity.contributorIds);
    return { text: appreciationText(activity.counts, activity.goals, names, monday), extra: { counts: activity.counts, named: names.length, mondayPostId: monday?.postId } };
  }
  const [year, month] = periodKey.split("-").map(Number);
  const start = new Date(Date.UTC(year!, month! - 1, 1));
  const end = new Date(Date.UTC(year!, month!, 1));
  const previousStart = new Date(Date.UTC(year!, month! - 2, 1));
  const [current, previous, stops] = await Promise.all([
    gatherActivity(coopId, start, end), gatherActivity(coopId, previousStart, start), gatherStopCandidates(coopId, start, end),
  ]);
  return {
    text: monthlyText(MONTH_FORMAT.format(start), current.counts, previous.counts, stops),
    extra: { current: current.counts, previous: previous.counts, stops: stops.length },
  };
}

/** A recent member reply means the existing General discussion should keep breathing instead of being replaced. */
export async function hasActiveRhythmDiscussion(coopId: string, category: ScheduledRhythmCategory, now: Date): Promise<boolean> {
  return !!(await db.commonsPost.findFirst({
    where: {
      coopId, OR: generalFeed(coopId), classification: rhythmClassification(category),
      createdAt: { gte: new Date(now.getTime() - (category === "monthly_review" ? 35 : 9) * DAY_MS) },
      comments: { some: { createdAt: { gte: new Date(now.getTime() - 2 * DAY_MS) }, author: { isBot: false } } },
    },
    select: { id: true },
  }));
}

/** The wake-cycle step: posts whichever rituals are due and not yet posted for their period. */
export async function runCommunityRhythm(coopId: string, now = new Date(), only?: ScheduledRhythmCategory[]): Promise<{ skipped?: string; results: RhythmResult[] }> {
  const due = dueRhythms(now).filter((entry) => !only || only.includes(entry.category));
  if (!due.length) return { results: [] };
  const pending = [];
  for (const entry of due) {
    const existing = await db.commonsAction.findUnique({
      where: { sourceType_sourceId_contentHash_charterConfigId_position: rhythmKey(coopId, entry.category, entry.periodKey) },
      select: { id: true },
    });
    if (!existing) pending.push(entry);
  }
  if (!pending.length) return { results: [] };
  const config = await db.coopConfig.findFirst({ where: { coopId, isActive: true }, orderBy: { version: "desc" }, select: { isDemo: true } });
  if (!config || config.isDemo) return { skipped: "Not an active Commons", results: [] };
  if ((await countActiveMembers(coopId)) < RHYTHM_MIN_ACTIVE_MEMBERS) return { skipped: "Too few active members", results: [] };
  const results: RhythmResult[] = [];
  for (const entry of pending) {
    if (await hasActiveRhythmDiscussion(coopId, entry.category, now)) {
      results.push(await publishRhythmPost(coopId, entry.category, entry.periodKey, null, {
        skipReason: "The existing General discussion is still active",
      }));
      continue;
    }
    const built = await buildRhythm(coopId, entry.category, entry.periodKey, now);
    results.push(await publishRhythmPost(coopId, entry.category, entry.periodKey, built.text, built.extra));
  }
  return { results };
}

// ── Member settings ─────────────────────────────────────────────────────────

export async function rhythmModesFor(userId: string): Promise<Record<RhythmCategory, RhythmMode>> {
  const rows = await db.sageRhythmPreference.findMany({ where: { userId }, select: { category: true, mode: true } });
  const modes = Object.fromEntries(RHYTHM_CATEGORIES.map((category) => [category, DEFAULT_RHYTHM_MODE])) as Record<RhythmCategory, RhythmMode>;
  rows.forEach((row) => {
    if (isRhythmCategory(row.category) && (RHYTHM_MODES as readonly string[]).includes(row.mode)) modes[row.category] = row.mode as RhythmMode;
  });
  return modes;
}

/** Feed classifications this member muted, for hiding those posts from their feeds. */
export async function mutedRhythmClassifications(userId: string | null | undefined, client: { sageRhythmPreference: { findMany: typeof db.sageRhythmPreference.findMany } } = db): Promise<string[]> {
  if (!userId) return [];
  const rows = await client.sageRhythmPreference.findMany({ where: { userId, mode: "MUTED" }, select: { category: true } });
  return rows.map((row) => row.category).filter(isRhythmCategory).map(rhythmClassification);
}
