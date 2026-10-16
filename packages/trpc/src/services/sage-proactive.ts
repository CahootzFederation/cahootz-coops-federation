import { db, type SageTask } from "@repo/db";

import { auditLogEntry } from "../lib/audit.js";
import { ensureSageBotUser } from "../lib/bot.js";
import { COMMONS_COOP_ID } from "../lib/commons.js";
import { createSageTask } from "./sage-tasks.js";
import { checkSageOutput } from "./untrusted-input.js";

/**
 * Messages Sage starts on its own (outreach), and the one weekly limit they share.
 *
 * Every outreach message goes through sendProactiveSageMessage, which stamps a `sage-<kind>:<key>`
 * systemKey. Only those count toward PROACTIVE_WEEKLY_LIMIT. Sage's replies in a conversation,
 * confirmations after a "yes", and relays of replies the member's own post received are written
 * without a systemKey, so a back-and-forth never uses up the limit.
 *
 * Outreach lands in the member's private conversation with Sage (the platform Commons, like the
 * weekly check-in).
 */

export const PROACTIVE_WEEKLY_LIMIT = 7;
export const PROACTIVE_KEY_PREFIX = "sage-";
export const CHECK_IN_MAX_DAYS = 14;
export const LIMITED_RETRIES = 3;
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

export type ProactiveKind = "weekly" | "promise" | "need" | "thanks-ask" | "thanks" | "post-reminder" | "activation" | "activation-ask";
export type ProactiveResult = { status: "SENT"; groupId: string } | { status: "LIMITED" } | { status: "DUPLICATE" };

/** The member's private conversation with Sage, if it exists yet. */
async function existingConversation(userId: string) {
  const sage = await ensureSageBotUser(db, COMMONS_COOP_ID);
  const { directKeyFor } = await import("./direct-circles.js");
  const group = await db.group.findUnique({ where: { directKey: directKeyFor(COMMONS_COOP_ID, sage.id, userId) }, select: { id: true } });
  return { sage, groupId: group?.id ?? null };
}

/** The member's private conversation with Sage, created if needed. */
export async function sageConversation(userId: string) {
  const sage = await ensureSageBotUser(db, COMMONS_COOP_ID);
  const { openDirectCircle } = await import("./direct-circles.js");
  const { group } = await openDirectCircle(db, { coopId: COMMONS_COOP_ID, userId: sage.id, otherUserId: userId });
  return { sage, group };
}

/** Outreach messages Sage started with this member in the last 7 days. Replies never count. */
export async function proactiveCountThisWeek(userId: string, now = new Date()): Promise<number> {
  const { sage, groupId } = await existingConversation(userId);
  if (!groupId) return 0;
  return db.groupComment.count({
    where: { groupId, authorId: sage.id, systemKey: { startsWith: PROACTIVE_KEY_PREFIX }, createdAt: { gte: new Date(now.getTime() - WEEK_MS) } },
  });
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

/** Sends one outreach message unless the member has had PROACTIVE_WEEKLY_LIMIT this week. Idempotent per kind+key. */
export async function sendProactiveSageMessage(input: {
  userId: string; kind: ProactiveKind; key: string; content: string; now?: Date;
}): Promise<ProactiveResult> {
  const now = input.now ?? new Date();
  const systemKey = `${PROACTIVE_KEY_PREFIX}${input.kind}:${input.key}`;
  if (await db.groupComment.findUnique({ where: { systemKey }, select: { id: true } })) return { status: "DUPLICATE" };
  if (await proactiveCountThisWeek(input.userId, now) >= PROACTIVE_WEEKLY_LIMIT) {
    await db.auditLog.create({
      data: auditLogEntry({
        actorId: "system/sage", action: "SAGE_PROACTIVE_LIMITED", resource: "User", resourceId: input.userId,
        metadata: { kind: input.kind, key: input.key, limit: PROACTIVE_WEEKLY_LIMIT },
      }),
    }).catch(console.error);
    return { status: "LIMITED" };
  }
  const { sage, group } = await sageConversation(input.userId);
  const { sendDirectCircleMessage } = await import("./direct-circles.js");
  try {
    await sendDirectCircleMessage(db, { group, sender: sage, content: input.content, systemKey });
  } catch (error) {
    if (isUniqueViolation(error)) return { status: "DUPLICATE" };
    throw error;
  }
  return { status: "SENT", groupId: group.id };
}

// ── Promises Sage keeps ───────────────────────────────────────────────────────

/** Cleans what Sage will ask about; null if it isn't safe to send. */
export function checkInTopic(about: string): string | null {
  const text = about.trim().replace(/[?.!\s]+$/g, "").slice(0, 120);
  if (text.length < 3 || !checkSageOutput(text).ok) return null;
  return text;
}

/**
 * Sage promises to check back with a member: one open promise per member. A new one replaces the old
 * one's topic and date. Used by every agent that has the member toolkit and by the steward.
 */
export async function scheduleMemberCheckIn(input: {
  memberId: string; coopId: string; about: string; days: number; createdBy?: "SAGE" | "SYSTEM"; now?: Date;
}): Promise<{ ok: true; taskId: string; days: number } | { ok: false; reason: string }> {
  const now = input.now ?? new Date();
  const about = checkInTopic(input.about);
  if (!about) return { ok: false, reason: "Describe what to check back about in a few plain words, with no links or @mentions." };
  const days = Math.min(CHECK_IN_MAX_DAYS, Math.max(1, Math.round(input.days)));
  const created = await createSageTask({
    coopId: input.coopId, kind: "FOLLOW_UP", title: `Check back: ${about}`.slice(0, 160),
    reason: "Sage said it would check back with the member.", expected: about,
    ownerUserId: input.memberId, subjectType: "member_conversation", subjectId: input.memberId,
    dueInDays: days, createdBy: input.createdBy ?? "SAGE",
  }, now);
  if (created.created && created.taskId) return { ok: true, taskId: created.taskId, days };
  if (!created.taskId) return { ok: false, reason: created.reason ?? "Couldn't schedule that" };
  const dueAt = new Date(now.getTime() + days * DAY_MS);
  await db.sageTask.update({
    where: { id: created.taskId },
    data: {
      title: `Check back: ${about}`.slice(0, 160), expected: about, dueAt, nextWakeAt: dueAt, attempts: 0,
      events: { create: { eventType: "RESCHEDULED", detail: `Check back in ${days} days: ${about}` } },
    },
  });
  return { ok: true, taskId: created.taskId, days };
}

/** A promise is already kept if the member talked with Sage after it was made and Sage answered. */
export async function promiseAlreadyKept(task: Pick<SageTask, "ownerUserId" | "createdAt">): Promise<boolean> {
  if (!task.ownerUserId) return false;
  const { sage, groupId } = await existingConversation(task.ownerUserId);
  if (!groupId) return false;
  const memberMessage = await db.groupComment.findFirst({
    where: { groupId, authorId: task.ownerUserId, createdAt: { gt: task.createdAt } }, orderBy: { createdAt: "asc" }, select: { createdAt: true },
  });
  if (!memberMessage) return false;
  const answered = await db.groupComment.findFirst({
    where: { groupId, authorId: sage.id, systemKey: null, createdAt: { gt: memberMessage.createdAt } }, select: { id: true },
  });
  return !!answered;
}

/** Runs a due outreach task (a promise or an introduction outcome). The wake loop handles the result. */
export async function runProactiveTask(task: SageTask, now = new Date()): Promise<"SENT" | "LIMITED" | "SKIPPED"> {
  if (!task.ownerUserId) return "SKIPPED";
  if (task.subjectType === "member_conversation") {
    const about = checkInTopic(task.expected ?? "");
    if (!about) return "SKIPPED";
    const sent = await sendProactiveSageMessage({
      userId: task.ownerUserId, kind: "promise", key: task.id, now,
      content: `Checking back like I said: ${about.charAt(0).toLowerCase()}${about.slice(1)}?`,
    });
    return sent.status === "LIMITED" ? "LIMITED" : "SENT";
  }
  if (task.subjectType === "introduction_outcome") {
    const { askWhetherIntroductionHelped } = await import("./sage-member-actions.js");
    return askWhetherIntroductionHelped(task.subjectId, task.ownerUserId, now);
  }
  return "SKIPPED";
}
