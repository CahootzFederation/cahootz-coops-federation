import { db, type SageTask } from "@repo/db";
import type { NotificationPreferences } from "@repo/validators/notification";
import { defaultNotificationPreferences } from "@repo/validators/notification";

import { findMembersForNeed, needWords } from "../agents/tools/specialist-tools.js";
import { auditLogEntry } from "../lib/audit.js";
import { isEmailConfigured, sendOnboardingDripEmail } from "../lib/email.js";
import {
  DRIP_EMAIL_CTA_LABEL, eventStartsLabel, isDeliverableEmail, MEMBER_APP_NAME, memberAppLinkUrl, snippet,
} from "./onboarding-drip-config.js";
import { DecisionTrail } from "./sage-decision-trail.js";
import { LIMITED_RETRIES, PROACTIVE_WEEKLY_LIMIT, proactiveCountThisWeek, sageConversation, sendProactiveSageMessage } from "./sage-proactive.js";
import { checkSageOutput, cleanseUntrustedText } from "./untrusted-input.js";

/**
 * Sage's new-member activation journey. It replaces the day 1/3/7 notification drip: one journey per
 * new Commons membership, sent as Sage messages that share the 7-per-week outreach limit.
 *
 *   ~hour 1   welcome    the Commons in its own words: mission, coin, current goals, what's active now
 *   day 3     connect    one person (a consent-first introduction), circle, event or resource
 *   day 7     contribute one small first contribution: an unanswered need that fits their profile
 *   day 14    check      verified from app records; if nothing happened, ask privately what got in the way
 *   day 30    close      the outcome is recorded either way
 *
 * Success means a useful connection or contribution, read from records, never from the member's word:
 * a reply to someone's need, an accepted introduction, joining a circle, an RSVP, or a post. Opening the
 * app doesn't count. Outcomes live on the journey's SageTask, so a success rate per Commons can be read
 * back (`activationStats`). Every message is a fixed template filled from records: no model call.
 *
 * The hourly `onboarding-drip-sweep` runs the steps; the Sage wake loop runs the day 14 and 30 checks.
 */

export const ACTIVATION_SUBJECT = "member_activation";
export const ACTIVATION_TASK_KIND = "ACTIVATION_CHECK";
export const ACTIVATION_CHECK_DAY = 14;
export const ACTIVATION_CLOSE_DAY = 30;
/** Memberships that started this recently are swept for a due step. */
export const ACTIVATION_LOOKBACK_HOURS = 14 * 24;
export const ACTIVATION_BATCH_SIZE = 500;
/** Needs this old or newer can be suggested as a first contribution. */
export const CONTRIBUTION_NEED_MAX_AGE_DAYS = 14;
/** Upcoming events within this many days are mentioned. */
export const EVENT_HORIZON_DAYS = 14;
/** A circle with activity this recent counts as active. */
export const ACTIVE_CIRCLE_DAYS = 14;
export const MIN_SUGGESTED_CIRCLE_MEMBERS = 2;
/** The schema default for `CoopConfig.scTokenName`; a Commons that never named its coin shows none. */
const PLACEHOLDER_COIN_NAMES = new Set(["fakecoin"]);

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const ASK_KIND = "activation-ask";
const OUTCOME_AUDIT = "SAGE_ACTIVATION_OUTCOME";

export type ActivationStepKey = "welcome" | "connect" | "contribute";

export interface ActivationStep {
  key: ActivationStepKey;
  /** Number stored in `OnboardingDripSend.step` (the per-step ledger the drip used). */
  ledgerStep: 1 | 3 | 7;
  dueAfterHours: number;
  /** A step that missed its window is dropped, never sent late and out of order. */
  windowHours: number;
}

export const ACTIVATION_STEPS: readonly ActivationStep[] = [
  { key: "welcome", ledgerStep: 1, dueAfterHours: 1, windowHours: 71 },
  { key: "connect", ledgerStep: 3, dueAfterHours: 72, windowHours: 96 },
  { key: "contribute", ledgerStep: 7, dueAfterHours: 168, windowHours: 168 },
];

export type ActivationSkip = "NOT_DUE" | "ALREADY_SENT";

/** The step in its window right now, if any. Windows don't overlap. */
export function planActivationStep(
  candidate: { joinedAt: Date; sentSteps: ReadonlySet<number> },
  now: Date,
): { step: ActivationStep } | { skip: ActivationSkip } {
  const joined = candidate.joinedAt.getTime();
  const step = ACTIVATION_STEPS.find((config) => {
    const due = joined + config.dueAfterHours * HOUR_MS;
    return now.getTime() >= due && now.getTime() < due + config.windowHours * HOUR_MS;
  });
  if (!step) return { skip: "NOT_DUE" };
  if (candidate.sentSteps.has(step.ledgerStep)) return { skip: "ALREADY_SENT" };
  return { step };
}

// ── Verified outcomes ────────────────────────────────────────────────────────

export type ActivationSignalKind = "NEED_REPLY" | "INTRODUCTION" | "CIRCLE_JOINED" | "RSVP" | "POST";

export interface ActivationSignal {
  kind: ActivationSignalKind;
  at: Date;
  detail: string;
}

const NEED_POST = { OR: [{ tag: { in: ["Need", "Ask"] } }, { classification: "need" }] };

/**
 * The member's first useful connection or contribution in this Commons since they joined, read from
 * records only. Null when there's none yet.
 */
export async function findActivationSignal(coopId: string, userId: string, since: Date): Promise<ActivationSignal | null> {
  const [needReply, introduction, circle, rsvp, post] = await Promise.all([
    db.commonsComment.findFirst({
      where: { authorId: userId, createdAt: { gte: since }, post: { coopId, authorId: { not: userId }, author: { isBot: false }, ...NEED_POST } },
      orderBy: { createdAt: "asc" }, select: { createdAt: true },
    }),
    db.commonsAction.findFirst({
      where: { coopId, type: "CONNECT_MEMBERS", sourceType: "sage_introduction", status: "APPROVED", updatedAt: { gte: since }, participants: { some: { userId } } },
      orderBy: { updatedAt: "asc" }, select: { updatedAt: true },
    }),
    db.groupMember.findFirst({
      where: { userId, joinedAt: { gte: since }, group: { coopId, kind: "STANDARD" } },
      orderBy: { joinedAt: "asc" }, select: { joinedAt: true },
    }),
    db.eventRSVP.findFirst({
      where: { userId, status: { in: ["GOING", "MAYBE"] }, createdAt: { gte: since }, event: { coopId } },
      orderBy: { createdAt: "asc" }, select: { createdAt: true },
    }),
    db.commonsPost.findFirst({
      where: { authorId: userId, coopId, createdAt: { gte: since } },
      orderBy: { createdAt: "asc" }, select: { createdAt: true },
    }),
  ]);
  const found: ActivationSignal[] = [
    needReply && { kind: "NEED_REPLY" as const, at: needReply.createdAt, detail: "Replied to another member's need" },
    introduction && { kind: "INTRODUCTION" as const, at: introduction.updatedAt, detail: "Accepted an introduction" },
    circle && { kind: "CIRCLE_JOINED" as const, at: circle.joinedAt, detail: "Joined a circle" },
    rsvp && { kind: "RSVP" as const, at: rsvp.createdAt, detail: "RSVP'd to an event" },
    post && { kind: "POST" as const, at: post.createdAt, detail: "Posted in the Commons" },
  ].filter((signal): signal is ActivationSignal => !!signal);
  return found.sort((a, b) => a.at.getTime() - b.at.getTime())[0] ?? null;
}

// ── The Commons in its own words ─────────────────────────────────────────────

export interface CommonsLanguage {
  name: string;
  mission: string | null;
  coin: string | null;
  goals: string[];
}

function firstSentence(text: string): string {
  const plain = text.replace(/^#+\s.*$/gm, " ").replace(/[*_`>]/g, "").replace(/\s+/g, " ").trim();
  return plain.match(/^.{20,}?[.!?](?=\s|$)/)?.[0] ?? plain;
}

/** Admin-written text still passes the same checks as anything Sage says. */
function safePhrase(raw: string | null | undefined, maxChars: number): string | null {
  const cleansed = cleanseUntrustedText(raw, { maxChars: maxChars * 4 });
  const text = snippet(cleansed.text, maxChars);
  if (text.length < 2 || cleansed.flags.length || !checkSageOutput(text).ok) return null;
  return text;
}

export function coinName(scTokenName: string | null | undefined): string | null {
  const name = scTokenName?.trim();
  if (!name || PLACEHOLDER_COIN_NAMES.has(name.toLowerCase())) return null;
  return safePhrase(name, 40);
}

export function topGoals(missionGoals: unknown, limit = 3): string[] {
  if (!Array.isArray(missionGoals)) return [];
  return missionGoals
    .filter((goal): goal is { label: string; priorityWeight?: number } => typeof goal?.label === "string")
    .sort((a, b) => (Number(b.priorityWeight) || 0) - (Number(a.priorityWeight) || 0))
    .map((goal) => safePhrase(goal.label, 80))
    .filter((label): label is string => !!label)
    .slice(0, limit);
}

export async function commonsLanguage(coopId: string): Promise<CommonsLanguage> {
  const config = await db.coopConfig.findFirst({
    where: { coopId, isActive: true }, orderBy: { version: "desc" },
    select: { name: true, displayMission: true, tagline: true, description: true, charterText: true, missionGoals: true, scTokenName: true },
  });
  const missionSource = [config?.displayMission, config?.tagline, config?.description, config?.charterText ? firstSentence(config.charterText) : null]
    .find((text) => text?.trim());
  return {
    name: safePhrase(config?.name, 60) ?? "your Commons",
    mission: missionSource ? safePhrase(firstSentence(missionSource), 220) : null,
    coin: coinName(config?.scTokenName),
    goals: topGoals(config?.missionGoals),
  };
}

// ── Message content ──────────────────────────────────────────────────────────

export type ActivationTarget = { type: "POST" | "EVENT" | "CIRCLE" | "RESOURCE" | "INTRODUCTION" | "NONE"; id: string | null };

export interface ActivationContent {
  content: string;
  target: ActivationTarget;
  /** Runs right before sending (e.g. creates the introduction the message asks about). Null aborts the step. */
  prepare?: () => Promise<string | null>;
}

interface ActivationMember {
  id: string;
  name: string | null;
  email: string;
  skills: string[];
  interests: string[];
  resourcesOffered: string[];
}

function joinParts(parts: Array<string | null | undefined>): string {
  return parts.filter((part): part is string => !!part && checkSageOutput(part).ok).join("\n\n");
}

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

async function memberCircleIds(userId: string, coopId: string): Promise<string[]> {
  const rows = await db.groupMember.findMany({ where: { userId, group: { coopId } }, select: { groupId: true } });
  return rows.map((row) => row.groupId);
}

async function nextEvent(coopId: string, userId: string, now: Date) {
  const circleIds = await memberCircleIds(userId, coopId);
  return db.event.findFirst({
    where: {
      coopId,
      startAt: { gt: now, lte: new Date(now.getTime() + EVENT_HORIZON_DAYS * DAY_MS) },
      OR: [{ circleId: null }, { circleId: `general:${coopId}` }, ...(circleIds.length ? [{ circleId: { in: circleIds } }] : [])],
    },
    orderBy: { startAt: "asc" },
    select: { id: true, startAt: true, post: { select: { title: true } }, _count: { select: { rsvps: { where: { status: "GOING" } } } } },
  });
}

/** What's active right now: open votes, the next event, and lively public circles. */
export async function activeWorkLine(coopId: string, userId: string, now: Date): Promise<string | null> {
  const [votable, event, circles] = await Promise.all([
    db.proposal.count({ where: { coopId, status: "VOTABLE" } }),
    nextEvent(coopId, userId, now),
    db.group.findMany({
      where: { coopId, kind: "STANDARD", privacy: "public", lastActivityAt: { gte: new Date(now.getTime() - ACTIVE_CIRCLE_DAYS * DAY_MS) } },
      orderBy: { lastActivityAt: "desc" }, take: 3, select: { name: true },
    }),
  ]);
  const parts: string[] = [];
  if (votable) parts.push(`${plural(votable, "proposal")} open for a vote`);
  const eventTitle = event ? safePhrase(event.post.title, 70) : null;
  if (event && eventTitle) parts.push(`“${eventTitle}” ${eventStartsLabel(event.startAt, now)}`);
  const circleNames = circles.map((circle) => safePhrase(circle.name, 40)).filter((name): name is string => !!name);
  if (circleNames.length) parts.push(`active circles: ${circleNames.join(", ")}`);
  return parts.length ? `Happening now: ${parts.join("; ")}.` : null;
}

export async function welcomeContent(member: ActivationMember, coopId: string, now: Date): Promise<ActivationContent> {
  const language = await commonsLanguage(coopId);
  const work = await activeWorkLine(coopId, member.id, now);
  const content = joinParts([
    `Welcome to ${language.name}! I'm Sage, the AI helper here (not a person).`,
    language.mission && `In ${language.name}'s own words: “${language.mission}”`,
    language.coin && `Members share ownership and rewards here through ${language.coin}, our own coin.`,
    language.goals.length ? `What we're working toward right now: ${language.goals.join("; ")}.` : null,
    work,
    "Over your first two weeks I'll point you to one person or circle to meet and one small way to pitch in. You can turn these off with Getting started tips in your notification settings.",
  ]);
  return { content, target: { type: "NONE", id: null } };
}

function profileTerms(member: ActivationMember): string[] {
  return [...new Set([...member.interests, ...member.skills, ...member.resourcesOffered].map((term) => term.trim()).filter(Boolean))].slice(0, 12);
}

/** Words of `text` that match `terms` by the same prefix rule `findMembersForNeed` uses. */
export function matchingTerms(terms: string[], text: string): string[] {
  const words = needWords(text);
  return terms.filter((term) => needWords(term).some((word) => words.some((want) => word.startsWith(want.slice(0, 5)) || want.startsWith(word.slice(0, 5)))));
}

/** One circle, person, event or resource to connect with. */
export async function connectContent(member: ActivationMember, coopId: string, now: Date): Promise<ActivationContent | null> {
  const { name } = await commonsLanguage(coopId);
  const terms = profileTerms(member);

  // 1. A person, through the consent-first introduction. The newcomer is asked first.
  if (terms.length) {
    const [match] = await findMembersForNeed({ db, requestingUserId: member.id, coopId }, terms.join(" "), member.id, 1);
    const shared = match ? (matchingTerms(terms, match.matched.join(" ")).map((term) => safePhrase(term, 30)).filter(Boolean) as string[]).slice(0, 3) : [];
    if (match && shared.length) {
      const target: ActivationTarget = { type: "INTRODUCTION", id: null };
      return {
        content: "",
        target,
        prepare: async () => {
          const { proposeIntroduction } = await import("./sage-member-actions.js");
          const { group } = await sageConversation(member.id);
          const proposal = await proposeIntroduction({
            memberId: member.id, conversationGroupId: group.id, coopId, helperUserId: match.userId,
            need: `meeting another member of ${name} who is into ${shared.join(", ")}`, matched: match.matched,
          });
          if (!proposal.ok) return null;
          target.id = proposal.actionId;
          return `Here's someone to meet in ${name}. ${proposal.ask}`;
        },
      };
    }
  }

  const circleIds = await memberCircleIds(member.id, coopId);
  const circles = await db.group.findMany({
    where: { coopId, kind: "STANDARD", privacy: "public", ...(circleIds.length ? { id: { notIn: circleIds } } : {}) },
    orderBy: [{ members: { _count: "desc" } }, { lastActivityAt: "desc" }], take: 30,
    select: { id: true, name: true, purpose: true, _count: { select: { members: true } } },
  });
  const describeCircle = (circle: (typeof circles)[number], why: string) => {
    const circleName = safePhrase(circle.name, 50);
    if (!circleName) return null;
    const purpose = safePhrase(circle.purpose, 120);
    return {
      content: joinParts([
        `One circle to try in ${name}: ${circleName}, ${plural(circle._count.members, "member")}${why}.`,
        purpose && `What it's for: ${purpose}`,
        "Joining a circle is the easiest way to meet people here. You'll find it under Circles.",
      ]),
      target: { type: "CIRCLE" as const, id: circle.id },
    };
  };

  // 2. A circle that fits their profile.
  for (const circle of terms.length ? circles : []) {
    const shared = matchingTerms(terms, `${circle.name} ${circle.purpose ?? ""}`).map((term) => safePhrase(term, 30)).filter(Boolean);
    if (shared.length) {
      const described = describeCircle(circle, `, and it fits your interest in ${shared.slice(0, 2).join(" and ")}`);
      if (described) return described;
    }
  }

  // 3. Something to show up for.
  const event = await nextEvent(coopId, member.id, now);
  const eventTitle = event ? safePhrase(event.post.title, 80) : null;
  if (event && eventTitle) {
    const going = event._count.rsvps ? ` ${plural(event._count.rsvps, "person is", "people are")} going.` : "";
    return {
      content: `One thing to show up for in ${name}: “${eventTitle}” ${eventStartsLabel(event.startAt, now)}.${going} RSVP in the app so people know you're coming.`,
      target: { type: "EVENT", id: event.id },
    };
  }

  // 4. A shared resource that fits their profile.
  if (terms.length) {
    const resources = await db.commonsResource.findMany({
      where: { coopId, status: "PUBLISHED" }, orderBy: { publishedAt: "desc" }, take: 30, select: { id: true, title: true, description: true },
    });
    for (const resource of resources) {
      const title = safePhrase(resource.title, 80);
      if (title && matchingTerms(terms, `${resource.title} ${resource.description ?? ""}`).length) {
        return {
          content: `${name} has a shared resource that fits what's on your profile: “${title}”. You'll find it in the Commons' resources, and asking about it there is a good way to meet the people behind it.`,
          target: { type: "RESOURCE", id: resource.id },
        };
      }
    }
  }

  // 5. The liveliest circle they haven't joined.
  const popular = circles.find((circle) => circle._count.members >= MIN_SUGGESTED_CIRCLE_MEMBERS);
  return popular ? describeCircle(popular, "") : null;
}

/** One small first contribution: an unanswered need that fits their profile, else an invitation to offer something. */
export async function contributeContent(member: ActivationMember, coopId: string, now: Date): Promise<ActivationContent> {
  const { name } = await commonsLanguage(coopId);
  const terms = [...new Set([...member.skills, ...member.resourcesOffered, ...member.interests].map((term) => term.trim()).filter(Boolean))];
  if (terms.length) {
    const needs = await db.commonsPost.findMany({
      where: {
        coopId, authorId: { not: member.id }, author: { isBot: false, deletedAt: null }, ...NEED_POST,
        AND: [{ OR: [{ circleId: null }, { circleId: `general:${coopId}` }] }],
        createdAt: { gte: new Date(now.getTime() - CONTRIBUTION_NEED_MAX_AGE_DAYS * DAY_MS), lte: now },
      },
      orderBy: { createdAt: "desc" }, take: 30,
      select: { id: true, title: true, content: true, authorId: true },
    });
    for (const need of needs) {
      const shared = matchingTerms(terms, `${need.title} ${need.content}`).map((term) => safePhrase(term, 30)).filter(Boolean) as string[];
      const title = safePhrase(need.title, 90);
      if (!shared.length || !title) continue;
      const answered = await db.commonsComment.findFirst({ where: { postId: need.id, authorId: { not: need.authorId } }, select: { id: true } });
      if (answered) continue;
      return {
        content: `A small first way to pitch in: a member posted “${title}” in ${name}, and nobody has answered yet. Your profile mentions ${shared.slice(0, 3).join(", ")}. If you can help, a reply on that post is a great start.`,
        target: { type: "POST", id: need.id },
      };
    }
  }
  return {
    content: `A small first way to pitch in: share one thing you could offer ${name}, like a skill, a tool, a ride or an hour of help. A short post in the ${name} feed is enough, and it's how neighbors find you.`,
    target: { type: "NONE", id: null },
  };
}

export function blockerAskText(commonsName: string): string {
  return `It's been two weeks since you joined ${commonsName}. From what I can see in the app, you haven't connected with anyone or pitched in there yet, and that's okay. What got in the way? A few words is plenty, and it helps me suggest something that fits.`;
}

export async function resolveActivationContent(step: ActivationStepKey, member: ActivationMember, coopId: string, now: Date) {
  if (step === "welcome") return welcomeContent(member, coopId, now);
  if (step === "connect") return connectContent(member, coopId, now);
  return contributeContent(member, coopId, now);
}

// ── The journey's task: verify at day 14, close at day 30 ────────────────────

export function activationSubjectId(coopId: string, userId: string) {
  return `${coopId}:${userId}`;
}

/** One journey task per membership, ever. Created when Sage first messages the member. */
export async function ensureActivationTask(input: { coopId: string; userId: string; joinedAt: Date; commonsName: string; now: Date }) {
  const subjectId = activationSubjectId(input.coopId, input.userId);
  const existing = await db.sageTask.findFirst({ where: { subjectType: ACTIVATION_SUBJECT, subjectId }, select: { id: true } });
  if (existing) return existing.id;
  const dueAt = new Date(Math.max(input.joinedAt.getTime() + ACTIVATION_CHECK_DAY * DAY_MS, input.now.getTime() + DAY_MS));
  const task = await db.sageTask.create({
    data: {
      coopId: input.coopId, kind: ACTIVATION_TASK_KIND, title: `Getting started in ${input.commonsName}`.slice(0, 160),
      reason: "Sage checks the app's records at two weeks, and once more at 30 days, to see whether you've connected with someone or pitched in. Dismiss this to stop the getting-started messages.",
      expected: "connect with someone or pitch in: reply to a need, accept an introduction, join a circle, RSVP to an event, or post",
      ownerUserId: input.userId, subjectType: ACTIVATION_SUBJECT, subjectId, dueAt, nextWakeAt: dueAt, createdBy: "SYSTEM",
      events: { create: { eventType: "CREATED", detail: "New-member activation journey started" } },
    },
    select: { id: true },
  });
  return task.id;
}

function signalOutcome(signal: ActivationSignal) {
  return `[${signal.kind}] ${signal.detail}`;
}

async function recordOutcome(task: Pick<SageTask, "id" | "coopId" | "ownerUserId">, joinedAt: Date, result: { activated: true; signal: ActivationSignal } | { activated: false; reason: "NONE" | "LEFT"; answeredAsk?: boolean }) {
  await db.auditLog.create({
    data: auditLogEntry({
      actorId: "system/sage", action: OUTCOME_AUDIT, resource: "SageTask", resourceId: task.id,
      metadata: result.activated
        ? { coopId: task.coopId, outcome: "ACTIVATED", signal: result.signal.kind, daysToActivate: Math.round((result.signal.at.getTime() - joinedAt.getTime()) / DAY_MS * 10) / 10 }
        : { coopId: task.coopId, outcome: result.reason === "LEFT" ? "LEFT" : "NOT_ACTIVATED", answeredAsk: result.answeredAsk ?? false },
    }),
  }).catch((error) => console.error("Could not record the activation outcome", error));
}

/** Closes an open journey task as activated. Used by the sweep the moment it sees a signal. */
export async function closeActivationTask(taskId: string, joinedAt: Date, signal: ActivationSignal): Promise<boolean> {
  const closed = await db.sageTask.updateMany({
    where: { id: taskId, status: "OPEN" },
    data: { status: "DONE", outcome: signalOutcome(signal), leaseUntil: null, lastWokeAt: new Date() },
  });
  if (!closed.count) return false;
  const task = await db.sageTask.findUnique({ where: { id: taskId }, select: { id: true, coopId: true, ownerUserId: true } });
  await db.sageTaskEvent.create({ data: { taskId, eventType: "RESOLVED", detail: signalOutcome(signal) } });
  if (task) await recordOutcome(task, joinedAt, { activated: true, signal });
  return true;
}

async function preferencesFor(userId: string): Promise<NotificationPreferences> {
  return (await db.notificationPreference.findUnique({ where: { userId } })) ?? defaultNotificationPreferences;
}

async function memberAnsweredAsk(userId: string, coopId: string): Promise<boolean> {
  const ask = await db.groupComment.findUnique({ where: { systemKey: `sage-${ASK_KIND}:${activationSubjectId(coopId, userId)}` }, select: { groupId: true, createdAt: true } });
  if (!ask) return false;
  return !!(await db.groupComment.findFirst({ where: { groupId: ask.groupId, authorId: userId, createdAt: { gt: ask.createdAt } }, select: { id: true } }));
}

/**
 * The wake loop's handler for a journey task. Day 14: closed if a signal is on record, otherwise Sage
 * asks once what got in the way (the reply goes through the check-in memory path). Day 30: closed
 * either way, and the outcome recorded.
 */
export async function wakeActivationTask(task: SageTask, now = new Date()): Promise<"DONE" | "REMINDED" | "ABANDONED" | "FAILED"> {
  const trail = new DecisionTrail({
    agent: "cadence", coopId: task.coopId, sourceType: "sage_task", sourceId: task.id, trigger: "SAGE_WAKE", visibility: "ADMINS",
    observed: { title: task.title, content: task.expected ?? task.reason },
  }).step("OBSERVED", `Checked back on: ${task.title}`);
  const finish = async (status: "DONE" | "ABANDONED", outcome: string, eventType: string) => {
    await db.sageTask.update({
      where: { id: task.id },
      data: { status, outcome, leaseUntil: null, lastWokeAt: now, events: { create: { eventType, detail: outcome } } },
    });
  };
  try {
    const userId = task.ownerUserId;
    const membership = userId
      ? await db.userCoopMembership.findUnique({ where: { userId_coopId: { userId, coopId: task.coopId } }, select: { status: true, joinedAt: true, createdAt: true } })
      : null;
    if (!userId || membership?.status !== "ACTIVE") {
      await finish("ABANDONED", "[LEFT] The member is no longer active in this Commons", "ABANDONED");
      if (membership) await recordOutcome(task, membership.joinedAt ?? membership.createdAt, { activated: false, reason: "LEFT" });
      await trail.taken("Closed: the member left", "INFO").result("Closed", "INFO", "None.").setOutcome("Activation closed: member left").save();
      return "ABANDONED";
    }
    const joinedAt = membership.joinedAt ?? membership.createdAt;
    const signal = await findActivationSignal(task.coopId, userId, joinedAt);
    trail.policy("A connection or contribution is on record", !!signal, signal?.detail);
    if (signal) {
      await finish("DONE", signalOutcome(signal), "RESOLVED");
      await recordOutcome(task, joinedAt, { activated: true, signal });
      await trail.taken("Closed: the member connected or pitched in", "PASS").result("Activated", "PASS", "None.").setOutcome(`Activated: ${signal.detail}`).save();
      return "DONE";
    }

    const closeAt = new Date(joinedAt.getTime() + ACTIVATION_CLOSE_DAY * DAY_MS);
    const events = await db.sageTaskEvent.findMany({ where: { taskId: task.id, eventType: { in: ["ASKED", "ASK_SKIPPED", "DEFERRED"] } }, select: { eventType: true } });
    const asked = events.some((event) => event.eventType !== "DEFERRED");
    if (asked || now >= closeAt) {
      const answeredAsk = await memberAnsweredAsk(userId, task.coopId);
      await finish("ABANDONED", `[NONE] No verified connection or contribution in the first ${ACTIVATION_CLOSE_DAY} days`, "ABANDONED");
      await recordOutcome(task, joinedAt, { activated: false, reason: "NONE", answeredAsk });
      await trail.taken("Closed: nothing on record after 30 days", "INFO").result("Not activated", "INFO", "None. Sage doesn't keep asking.").setOutcome("Activation closed: not activated").save();
      return "ABANDONED";
    }

    const later = async (eventType: string, detail: string, nextWakeAt: Date) => {
      await db.sageTask.update({
        where: { id: task.id },
        data: { nextWakeAt, leaseUntil: null, lastWokeAt: now, attempts: { increment: eventType === "DEFERRED" ? 1 : 0 }, events: { create: { eventType, detail } } },
      });
    };
    const preferences = await preferencesFor(userId);
    if (!preferences.onboarding) {
      await later("ASK_SKIPPED", "Getting started tips are off, so Sage didn't ask", closeAt);
      await trail.taken("Didn't ask: getting started tips are off", "INFO").result("Waiting", "INFO", "Sage records the outcome at 30 days.").setOutcome("Activation ask skipped").save();
      return "REMINDED";
    }
    const { name } = await commonsLanguage(task.coopId);
    const sent = await sendProactiveSageMessage({ userId, kind: ASK_KIND, key: activationSubjectId(task.coopId, userId), content: blockerAskText(name), now });
    trail.policy("Under the weekly outreach limit", sent.status !== "LIMITED");
    if (sent.status === "LIMITED") {
      const deferrals = events.filter((event) => event.eventType === "DEFERRED").length;
      if (deferrals < LIMITED_RETRIES) {
        await later("DEFERRED", "Weekly outreach limit reached; trying tomorrow", new Date(now.getTime() + DAY_MS));
        await trail.taken("Waited a day: the member already heard from Sage enough this week", "INFO").result("Waiting", "INFO", "Sage tries again tomorrow.").setOutcome("Activation ask deferred").save();
        return "REMINDED";
      }
      await later("ASK_SKIPPED", "The weekly limit kept blocking the question", closeAt);
      await trail.taken("Didn't ask: the weekly limit kept blocking it", "INFO").result("Waiting", "INFO", "Sage records the outcome at 30 days.").setOutcome("Activation ask skipped").save();
      return "REMINDED";
    }
    await later("ASKED", "Asked privately what got in the way", closeAt);
    await trail.taken("Asked privately what got in the way", "PASS").result("Waiting", "INFO", `Sage records the outcome around ${closeAt.toISOString().slice(0, 10)}.`).setOutcome("Activation ask sent").save();
    return "REMINDED";
  } catch (error) {
    await db.sageTask.update({ where: { id: task.id }, data: { status: "FAILED", outcome: "Sage couldn't check this", leaseUntil: null } }).catch(() => {});
    await trail.taken("Couldn't check this", "FAIL", error instanceof Error ? error.message : String(error), true).setOutcome("Activation check failed").save();
    return "FAILED";
  }
}

// ── Success rate ─────────────────────────────────────────────────────────────

export interface ActivationStats {
  started: number;
  activated: number;
  notActivated: number;
  inProgress: number;
  /** Left the Commons or dismissed the journey: not counted in the rate. */
  excluded: number;
  /** activated / (activated + notActivated), or null before any journey has finished. */
  successRate: number | null;
  bySignal: Partial<Record<ActivationSignalKind, number>>;
}

export async function activationStats(coopId: string, since?: Date, client: Pick<typeof db, "sageTask"> = db): Promise<ActivationStats> {
  const tasks = await client.sageTask.findMany({
    where: { coopId, subjectType: ACTIVATION_SUBJECT, ...(since ? { createdAt: { gte: since } } : {}) },
    select: { status: true, outcome: true },
  });
  const stats: ActivationStats = { started: tasks.length, activated: 0, notActivated: 0, inProgress: 0, excluded: 0, successRate: null, bySignal: {} };
  for (const task of tasks) {
    const code = task.outcome?.match(/^\[([A-Z_]+)\]/)?.[1];
    if (task.status === "OPEN") stats.inProgress++;
    else if (task.status === "DONE" && code) {
      stats.activated++;
      stats.bySignal[code as ActivationSignalKind] = (stats.bySignal[code as ActivationSignalKind] ?? 0) + 1;
    } else if (task.status === "ABANDONED" && code === "NONE") stats.notActivated++;
    else stats.excluded++;
  }
  const finished = stats.activated + stats.notActivated;
  stats.successRate = finished ? stats.activated / finished : null;
  return stats;
}

// ── The sweep ────────────────────────────────────────────────────────────────

export interface ActivationRunSummary {
  considered: number;
  sent: number;
  failed: number;
  skipped: Record<ActivationSkip | "ONE_PER_RUN" | "OPTED_OUT" | "STOPPED" | "ACTIVATED" | "NOTHING_TO_SHOW" | "LIMITED", number>;
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

/** Members without a push device read Sage's welcome by email too, so it isn't lost. */
async function emailWelcomeIfUnreachable(member: ActivationMember, commonsName: string, content: string, preferences: NotificationPreferences) {
  const pushable = preferences.pushEnabled && (await db.pushDevice.count({ where: { userId: member.id, enabled: true } })) > 0;
  if (pushable || !isDeliverableEmail(member.email) || !isEmailConfigured()) return false;
  try {
    await sendOnboardingDripEmail({
      to: member.email, commonsName, subject: `Welcome to ${commonsName}`, heading: `Welcome to ${commonsName}`,
      body: `${content}\n\nOpen the ${MEMBER_APP_NAME} app to reply to Sage.`, ctaLabel: DRIP_EMAIL_CTA_LABEL, ctaUrl: memberAppLinkUrl(),
    });
    return true;
  } catch (error) {
    console.warn("[sage-activation] Welcome email failed", { userId: member.id, error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

/**
 * One hourly sweep over memberships that started in the last two weeks. `userIds` / `coopId` narrow it
 * (the E2E fixture uses them); the scheduled task passes neither.
 */
export async function runActivationSweep(options: { now?: Date; userIds?: string[]; coopId?: string } = {}): Promise<ActivationRunSummary> {
  const now = options.now ?? new Date();
  const lookbackStart = new Date(now.getTime() - ACTIVATION_LOOKBACK_HOURS * HOUR_MS);
  const summary: ActivationRunSummary = {
    considered: 0, sent: 0, failed: 0,
    skipped: { NOT_DUE: 0, ALREADY_SENT: 0, ONE_PER_RUN: 0, OPTED_OUT: 0, STOPPED: 0, ACTIVATED: 0, NOTHING_TO_SHOW: 0, LIMITED: 0 },
  };
  // A member who joined several Commons this week hears from at most one per sweep.
  const messagedThisRun = new Set<string>();

  let cursor: string | undefined;
  for (;;) {
    const page = await db.userCoopMembership.findMany({
      where: {
        status: "ACTIVE",
        ...(options.userIds ? { userId: { in: options.userIds } } : {}),
        ...(options.coopId ? { coopId: options.coopId } : {}),
        OR: [{ joinedAt: { gte: lookbackStart, lte: now } }, { joinedAt: null, createdAt: { gte: lookbackStart, lte: now } }],
        user: { deletedAt: null, isBot: false, status: { notIn: ["SUSPENDED", "REJECTED"] } },
      },
      orderBy: { id: "asc" }, take: ACTIVATION_BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true, userId: true, coopId: true, joinedAt: true, createdAt: true,
        user: { select: { id: true, name: true, email: true, skills: true, interests: true, resourcesOffered: true } },
      },
    });
    if (!page.length) break;
    cursor = page[page.length - 1]!.id;

    const userIds = [...new Set(page.map((membership) => membership.userId))];
    const [sends, tasks] = await Promise.all([
      db.onboardingDripSend.findMany({ where: { userId: { in: userIds } }, select: { userId: true, coopId: true, step: true } }),
      db.sageTask.findMany({ where: { subjectType: ACTIVATION_SUBJECT, ownerUserId: { in: userIds } }, select: { id: true, subjectId: true, status: true } }),
    ]);
    const sentByMembership = new Map<string, Set<number>>();
    for (const send of sends) {
      const key = activationSubjectId(send.coopId, send.userId);
      if (!sentByMembership.has(key)) sentByMembership.set(key, new Set());
      sentByMembership.get(key)!.add(send.step);
    }
    const taskBySubject = new Map(tasks.map((task) => [task.subjectId, task]));

    for (const membership of page) {
      summary.considered++;
      const key = activationSubjectId(membership.coopId, membership.userId);
      const joinedAt = membership.joinedAt ?? membership.createdAt;
      const plan = planActivationStep({ joinedAt, sentSteps: sentByMembership.get(key) ?? new Set() }, now);
      if ("skip" in plan) {
        summary.skipped[plan.skip]++;
        continue;
      }
      const task = taskBySubject.get(key);
      // The member dismissed the journey in Following, or it already closed.
      if (task && task.status !== "OPEN") {
        summary.skipped.STOPPED++;
        continue;
      }
      if (messagedThisRun.has(membership.userId)) {
        summary.skipped.ONE_PER_RUN++;
        continue;
      }
      try {
        const preferences = await preferencesFor(membership.userId);
        if (!preferences.onboarding) {
          summary.skipped.OPTED_OUT++;
          continue;
        }
        // Once they've connected or pitched in, the nudges stop and the outcome is recorded now.
        if (plan.step.key !== "welcome") {
          const signal = await findActivationSignal(membership.coopId, membership.userId, joinedAt);
          if (signal) {
            if (task) await closeActivationTask(task.id, joinedAt, signal);
            summary.skipped.ACTIVATED++;
            continue;
          }
        }
        if (await proactiveCountThisWeek(membership.userId, now) >= PROACTIVE_WEEKLY_LIMIT) {
          summary.skipped.LIMITED++;
          continue;
        }
        const resolved = await resolveActivationContent(plan.step.key, membership.user, membership.coopId, now);
        const content = resolved?.prepare ? await resolved.prepare() : resolved?.content;
        if (!resolved || !content || !checkSageOutput(content).ok) {
          // The step stays unsent, so a later sweep inside its window can still send it.
          summary.skipped.NOTHING_TO_SHOW++;
          continue;
        }
        const sent = await sendProactiveSageMessage({ userId: membership.userId, kind: "activation", key: `${key}:${plan.step.key}`, content, now });
        if (sent.status === "LIMITED") {
          summary.skipped.LIMITED++;
          continue;
        }
        const { name } = await commonsLanguage(membership.coopId);
        const emailed = plan.step.key === "welcome" && sent.status === "SENT"
          ? await emailWelcomeIfUnreachable(membership.user, name, content, preferences)
          : false;
        await db.onboardingDripSend.create({
          data: {
            userId: membership.userId, coopId: membership.coopId, step: plan.step.ledgerStep, status: "SENT",
            channel: emailed ? "SAGE+EMAIL" : "SAGE", targetType: resolved.target.type, targetId: resolved.target.id, sentAt: now,
          },
        }).catch((error) => {
          if (!isUniqueViolation(error)) throw error;
        });
        await ensureActivationTask({ coopId: membership.coopId, userId: membership.userId, joinedAt, commonsName: name, now });
        summary.sent++;
        messagedThisRun.add(membership.userId);
      } catch (error) {
        summary.failed++;
        console.error("[sage-activation] Could not process membership", {
          userId: membership.userId, coopId: membership.coopId, error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (page.length < ACTIVATION_BATCH_SIZE) break;
  }
  return summary;
}
