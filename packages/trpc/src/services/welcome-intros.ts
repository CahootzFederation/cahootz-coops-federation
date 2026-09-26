import { parseCircleNotificationLevel } from "@repo/validators/notification";

import type { Context } from "../context.js";
import { createNotificationAndPush } from "./push-notification-service.js";

type Db = Context["db"];

/** How long an intro can sit with no reply before the lounge guide is nudged. */
export const INTRO_GUIDE_ESCALATION_AFTER_MS = 2 * 60 * 60 * 1000;
/** How long an intro can sit with no reply before the Commons admins are told. */
export const INTRO_ADMIN_ESCALATION_AFTER_MS = 12 * 60 * 60 * 1000;
/** Upper bound on intros handled per escalation stage in one sweep. */
export const INTRO_ESCALATION_BATCH_SIZE = 200;

export const WELCOME_INTRO_REPLY_NOTIFICATION = "WELCOME_INTRO_REPLY";
export const WELCOME_INTRO_UNANSWERED_NOTIFICATION = "WELCOME_INTRO_UNANSWERED";
export const WELCOME_INTRO_UNANSWERED_ADMIN_NOTIFICATION = "WELCOME_INTRO_UNANSWERED_ADMIN";

export const WELCOME_INTRO_PROMPT = "Say hi — what brought you here?";

function displayName(user: { name: string | null; email: string }) {
  return user.name || user.email.split("@")[0] || "A member";
}

/** Plain-text preview of a stored comment: `[@handle]` mention tokens become `@handle`. */
export function commentPreview(content: string, maxLength = 120) {
  const plain = content.replace(/\[@([^\]]+)\]/g, "@$1").replace(/\s+/g, " ").trim();
  return plain.length > maxLength ? `${plain.slice(0, maxLength - 1)}…` : plain;
}

/**
 * The Sage welcome post of a welcome lounge - the thread newcomers introduce
 * themselves on (see assignOrAdvance in welcome-tables.ts). Returns null for
 * any group that isn't a welcome lounge.
 */
export async function findLoungeWelcomePost(db: Db, groupId: string) {
  const group = await db.group.findUnique({
    where: { id: groupId },
    select: { id: true, coopId: true, kind: true, name: true },
  });
  if (!group || group.kind !== "WELCOME_TABLE") return null;
  const post = await db.commonsPost.findFirst({
    where: { circleId: group.id, coopId: group.coopId, author: { isBot: true } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return post ? { group, postId: post.id } : null;
}

/**
 * What the lounge feed should show a member about their intro: whether to
 * prompt for one (a NEWCOMER who hasn't posted yet) and, once posted, the
 * intro itself.
 */
export async function getWelcomeIntroStatus(db: Db, groupId: string, userId: string) {
  const lounge = await findLoungeWelcomePost(db, groupId);
  if (!lounge) return { eligible: false as const, welcomePostId: null, prompt: WELCOME_INTRO_PROMPT, intro: null };

  const [membership, intro] = await Promise.all([
    db.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
      select: { role: true },
    }),
    db.welcomeIntro.findUnique({
      where: { groupId_newcomerId: { groupId, newcomerId: userId } },
      select: { id: true, commentId: true, respondedAt: true },
    }),
  ]);

  return {
    eligible: membership?.role === "NEWCOMER" && !intro,
    welcomePostId: lounge.postId,
    prompt: WELCOME_INTRO_PROMPT,
    intro: intro
      ? { id: intro.id, commentId: intro.commentId, respondedAt: intro.respondedAt?.toISOString() ?? null }
      : null,
  };
}

export interface WelcomeIntroCommentInput {
  post: { id: string; coopId: string; circleId: string | null };
  comment: { id: string; content: string; createdAt: Date };
  author: { id: string; name: string | null; email: string; isBot?: boolean };
  /** Human users the comment @mentions (already resolved by encodeMentions). */
  mentionedUserIds: string[];
  /** Set when the commenter tapped "Reply" on a specific comment. */
  replyToCommentId?: string | null;
}

export interface WelcomeIntroCommentResult {
  /** True when this comment was recorded as the author's intro. */
  introRecorded: boolean;
  /**
   * Newcomers who were just sent a "replied to your intro" alert. Callers use
   * this to skip the generic mention alert for the same comment.
   */
  notifiedNewcomerIds: string[];
}

/**
 * Hook for every new comment. On a welcome lounge's Sage welcome post it:
 * - records a NEWCOMER's first top-level comment there as their intro, and
 * - marks open intros answered when another human replies to or @mentions
 *   their author, alerting that newcomer the first time only.
 *
 * Each intro's first response is claimed with a conditional update
 * (`respondedAt: null`), so concurrent replies alert the newcomer once.
 */
export async function recordWelcomeIntroActivity(
  db: Db,
  input: WelcomeIntroCommentInput,
): Promise<WelcomeIntroCommentResult> {
  const result: WelcomeIntroCommentResult = { introRecorded: false, notifiedNewcomerIds: [] };
  if (!input.post.circleId || input.author.isBot) return result;

  const lounge = await findLoungeWelcomePost(db, input.post.circleId);
  if (!lounge || lounge.postId !== input.post.id) return result;
  const groupId = lounge.group.id;

  if (!input.replyToCommentId) {
    const membership = await db.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: input.author.id } },
      select: { role: true },
    });
    if (membership?.role === "NEWCOMER") {
      const existing = await db.welcomeIntro.findUnique({
        where: { groupId_newcomerId: { groupId, newcomerId: input.author.id } },
        select: { id: true },
      });
      if (!existing) {
        try {
          await db.welcomeIntro.create({
            data: {
              coopId: input.post.coopId,
              groupId,
              postId: input.post.id,
              commentId: input.comment.id,
              newcomerId: input.author.id,
              createdAt: input.comment.createdAt,
            },
          });
          result.introRecorded = true;
          return result;
        } catch (error) {
          // A concurrent comment already became their intro - treat this
          // one like any other comment below.
          if ((error as { code?: string } | undefined)?.code !== "P2002") throw error;
        }
      }
    }
  }

  const openIntros = await db.welcomeIntro.findMany({
    where: {
      postId: input.post.id,
      respondedAt: null,
      newcomerId: { not: input.author.id },
      createdAt: { lte: input.comment.createdAt },
    },
    select: { id: true, commentId: true, newcomerId: true, coopId: true, groupId: true },
  });
  const mentioned = new Set(input.mentionedUserIds);
  const answered = openIntros.filter(
    (intro) => intro.commentId === input.replyToCommentId || mentioned.has(intro.newcomerId),
  );

  const actorName = displayName(input.author);
  for (const intro of answered) {
    const claimed = await db.welcomeIntro.updateMany({
      where: { id: intro.id, respondedAt: null },
      data: {
        respondedAt: new Date(),
        responderId: input.author.id,
        responseCommentId: input.comment.id,
      },
    });
    if (claimed.count !== 1) continue;

    // A newcomer who muted the lounge (level NONE) still gets the inbox row,
    // just no phone push - same rule as other circle alerts.
    const newcomerMembership = await db.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: intro.newcomerId } },
      select: { notificationLevel: true },
    });
    const push = parseCircleNotificationLevel(newcomerMembership?.notificationLevel) !== "NONE";

    result.notifiedNewcomerIds.push(intro.newcomerId);
    void createNotificationAndPush(db, {
      userId: intro.newcomerId,
      coopId: intro.coopId,
      push,
      type: WELCOME_INTRO_REPLY_NOTIFICATION,
      title: `💬 ${actorName} replied to your intro`,
      body: commentPreview(input.comment.content) || `${actorName} said hi in ${lounge.group.name}.`,
      data: {
        postId: input.post.id,
        commentId: intro.commentId,
        replyCommentId: input.comment.id,
        groupId: intro.groupId,
        coopId: intro.coopId,
      },
    }).catch((error) =>
      console.error("[push] Welcome intro reply notification failed", { introId: intro.id, error }),
    );
  }

  return result;
}

export interface IntroEscalationResult {
  guideNotified: number;
  adminNotified: number;
}

/**
 * Nudges people about intros nobody has answered: the lounge guide after
 * INTRO_GUIDE_ESCALATION_AFTER_MS, then the Commons admins after
 * INTRO_ADMIN_ESCALATION_AFTER_MS. Each stage is claimed per intro with a
 * conditional update before any alert goes out, so overlapping or retried
 * sweeps never alert anyone twice for the same intro.
 */
export async function escalateUnansweredIntros(db: Db, now: Date = new Date()): Promise<IntroEscalationResult> {
  const result: IntroEscalationResult = { guideNotified: 0, adminNotified: 0 };

  const guideDue = await db.welcomeIntro.findMany({
    where: {
      respondedAt: null,
      guideEscalatedAt: null,
      createdAt: { lte: new Date(now.getTime() - INTRO_GUIDE_ESCALATION_AFTER_MS) },
    },
    orderBy: { createdAt: "asc" },
    take: INTRO_ESCALATION_BATCH_SIZE,
    include: {
      group: { select: { name: true } },
      newcomer: { select: { name: true, email: true } },
    },
  });

  for (const intro of guideDue) {
    const claimed = await db.welcomeIntro.updateMany({
      where: { id: intro.id, respondedAt: null, guideEscalatedAt: null },
      data: { guideEscalatedAt: now },
    });
    if (claimed.count !== 1) continue;

    const guides = await db.groupMember.findMany({
      where: {
        groupId: intro.groupId,
        role: "GUIDE",
        userId: { not: intro.newcomerId },
        user: { isBot: false, deletedAt: null },
      },
      select: { userId: true, notificationLevel: true },
    });
    // No guide seated: nothing to do at this stage - the admin stage still
    // picks the intro up if it stays unanswered.
    for (const guide of guides) {
      try {
        await createNotificationAndPush(db, {
          userId: guide.userId,
          coopId: intro.coopId,
          push: parseCircleNotificationLevel(guide.notificationLevel) !== "NONE",
          type: WELCOME_INTRO_UNANSWERED_NOTIFICATION,
          title: `👋 ${displayName(intro.newcomer)} is waiting for a hello`,
          body: `Their intro in ${intro.group.name} hasn't had a reply yet. Say hi?`,
          data: { postId: intro.postId, commentId: intro.commentId, groupId: intro.groupId, coopId: intro.coopId },
        });
        result.guideNotified += 1;
      } catch (error) {
        console.error("[push] Unanswered intro guide alert failed", { introId: intro.id, error });
      }
    }
  }

  const adminDue = await db.welcomeIntro.findMany({
    where: {
      respondedAt: null,
      adminEscalatedAt: null,
      createdAt: { lte: new Date(now.getTime() - INTRO_ADMIN_ESCALATION_AFTER_MS) },
    },
    orderBy: { createdAt: "asc" },
    take: INTRO_ESCALATION_BATCH_SIZE,
    include: {
      group: { select: { name: true } },
      newcomer: { select: { name: true, email: true } },
    },
  });

  const adminsByCoop = new Map<string, string[]>();
  for (const intro of adminDue) {
    const claimed = await db.welcomeIntro.updateMany({
      where: { id: intro.id, respondedAt: null, adminEscalatedAt: null },
      data: { adminEscalatedAt: now },
    });
    if (claimed.count !== 1) continue;

    let admins = adminsByCoop.get(intro.coopId);
    if (!admins) {
      const memberships = await db.userCoopMembership.findMany({
        where: {
          coopId: intro.coopId,
          status: "ACTIVE",
          roles: { has: "admin" },
          user: { isBot: false, deletedAt: null },
        },
        select: { userId: true },
      });
      admins = memberships.map((membership) => membership.userId);
      adminsByCoop.set(intro.coopId, admins);
    }

    for (const adminId of admins) {
      if (adminId === intro.newcomerId) continue;
      try {
        // Welcome lounges are private, so an admin who isn't seated there
        // can't open the thread - this alert carries no post link.
        await createNotificationAndPush(db, {
          userId: adminId,
          coopId: intro.coopId,
          type: WELCOME_INTRO_UNANSWERED_ADMIN_NOTIFICATION,
          title: `${intro.group.name}: a newcomer's intro is unanswered`,
          body: `${displayName(intro.newcomer)} introduced themselves ${Math.round(
            INTRO_ADMIN_ESCALATION_AFTER_MS / 3_600_000,
          )}+ hours ago and no one has replied. Consider seating a lounge guide.`,
          data: { groupId: intro.groupId, coopId: intro.coopId, introId: intro.id },
        });
        result.adminNotified += 1;
      } catch (error) {
        console.error("[push] Unanswered intro admin alert failed", { introId: intro.id, error });
      }
    }
  }

  return result;
}
