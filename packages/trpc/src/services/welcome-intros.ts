import { parseCircleNotificationLevel } from "@repo/validators/notification";

import type { Context } from "../context.js";
import { PLATFORM_ADMIN_EMAILS, PLATFORM_ADMIN_WALLETS } from "../lib/admin-config.js";
import { createNotificationAndPush } from "./push-notification-service.js";

type Db = Context["db"];

/** How long an intro can sit with no reply before the lounge guide is nudged. */
export const INTRO_GUIDE_ESCALATION_AFTER_MS = 2 * 60 * 60 * 1000;
/** How long an intro can sit with no reply before the platform admins are told. */
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
    select: { id: true, commentId: true, newcomerId: true, coopId: true, groupId: true, postId: true },
  });
  const mentioned = new Set(input.mentionedUserIds);
  const answered = openIntros.filter(
    (intro) => intro.commentId === input.replyToCommentId || mentioned.has(intro.newcomerId),
  );

  for (const intro of answered) {
    const notified = await claimIntroResponse(db, intro, {
      responder: input.author,
      responseCommentId: input.comment.id,
      title: `💬 ${displayName(input.author)} replied to your intro`,
      body:
        commentPreview(input.comment.content) ||
        `${displayName(input.author)} said hi in ${lounge.group.name}.`,
      data: { replyCommentId: input.comment.id },
    });
    if (notified) result.notifiedNewcomerIds.push(intro.newcomerId);
  }

  return result;
}

type OpenIntro = {
  id: string;
  commentId: string;
  newcomerId: string;
  coopId: string;
  groupId: string;
  postId: string;
};

/**
 * Marks an intro answered and alerts its newcomer - but only if this is the
 * intro's first response. The claim is a conditional update on
 * `respondedAt: null`, so a reply and a reaction (or two of either) racing
 * each other alert the newcomer exactly once. Answering also stops the
 * unanswered-intro escalations, which only look at `respondedAt: null`.
 */
async function claimIntroResponse(
  db: Db,
  intro: OpenIntro,
  response: {
    responder: { id: string };
    responseCommentId: string | null;
    title: string;
    body: string;
    data: Record<string, unknown>;
  },
): Promise<boolean> {
  const claimed = await db.welcomeIntro.updateMany({
    where: { id: intro.id, respondedAt: null },
    data: {
      respondedAt: new Date(),
      responderId: response.responder.id,
      responseCommentId: response.responseCommentId,
    },
  });
  if (claimed.count !== 1) return false;

  // A newcomer who muted the lounge (level NONE) still gets the inbox row,
  // just no phone push - same rule as other circle alerts.
  const newcomerMembership = await db.groupMember.findUnique({
    where: { groupId_userId: { groupId: intro.groupId, userId: intro.newcomerId } },
    select: { notificationLevel: true },
  });
  const push = parseCircleNotificationLevel(newcomerMembership?.notificationLevel) !== "NONE";

  void createNotificationAndPush(db, {
    userId: intro.newcomerId,
    coopId: intro.coopId,
    push,
    type: WELCOME_INTRO_REPLY_NOTIFICATION,
    title: response.title,
    body: response.body,
    data: {
      postId: intro.postId,
      commentId: intro.commentId,
      groupId: intro.groupId,
      coopId: intro.coopId,
      ...response.data,
    },
  }).catch((error) =>
    console.error("[push] Welcome intro response notification failed", { introId: intro.id, error }),
  );
  return true;
}

/**
 * Hook for a new comment reaction. A reaction on an unanswered intro from
 * anyone but its newcomer (and not a bot) counts as the intro's first
 * response: the newcomer gets the one-time alert and escalation stops.
 * Returns whether this reaction triggered that alert.
 */
export async function recordWelcomeIntroReaction(
  db: Db,
  input: { commentId: string; reactor: { id: string; name: string | null; email: string; isBot?: boolean } },
): Promise<boolean> {
  if (input.reactor.isBot) return false;
  const intro = await db.welcomeIntro.findUnique({
    where: { commentId: input.commentId },
    select: {
      id: true, commentId: true, newcomerId: true, coopId: true, groupId: true, postId: true, respondedAt: true,
      group: { select: { name: true } },
    },
  });
  if (!intro || intro.respondedAt || intro.newcomerId === input.reactor.id) return false;

  const name = displayName(input.reactor);
  return claimIntroResponse(db, intro, {
    responder: input.reactor,
    responseCommentId: null,
    title: `💬 ${name} reacted to your intro`,
    body: `${name} liked your intro in ${intro.group.name}.`,
    data: {},
  });
}


export interface IntroEscalationResult {
  guideNotified: number;
  adminNotified: number;
}

/**
 * Nudges people about intros nobody has answered: the lounge guide after
 * INTRO_GUIDE_ESCALATION_AFTER_MS, then the platform admins after
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

  // Platform admins (not Commons admins) take the 12h stage: they're the
  // ones who can assign lounge guides. Looked up once per sweep, only if
  // something is due.
  let platformAdminIds: string[] | null = null;
  for (const intro of adminDue) {
    const claimed = await db.welcomeIntro.updateMany({
      where: { id: intro.id, respondedAt: null, adminEscalatedAt: null },
      data: { adminEscalatedAt: now },
    });
    if (claimed.count !== 1) continue;

    platformAdminIds ??= await findPlatformAdminUserIds(db);
    const adminPath = welcomeLoungesAdminPath(intro.coopId);
    const adminUrl = process.env.APP_URL ? `${process.env.APP_URL.replace(/\/+$/, "")}${adminPath}` : null;

    for (const adminId of platformAdminIds) {
      if (adminId === intro.newcomerId) continue;
      try {
        // Lounges rely on guides: admins get no read access to the private
        // thread, so this alert carries no post link - it points at the
        // portal page where a guide is assigned instead.
        await createNotificationAndPush(db, {
          userId: adminId,
          coopId: intro.coopId,
          type: WELCOME_INTRO_UNANSWERED_ADMIN_NOTIFICATION,
          title: `${intro.group.name} needs a guide`,
          body: `${displayName(intro.newcomer)} introduced themselves in ${intro.group.name} (commons ${intro.coopId}) ${Math.round(
            INTRO_ADMIN_ESCALATION_AFTER_MS / 3_600_000,
          )}+ hours ago and no one has responded. Assign a guide from the admin portal: ${adminUrl ?? adminPath}`,
          data: {
            groupId: intro.groupId,
            coopId: intro.coopId,
            introId: intro.id,
            adminPath,
            ...(adminUrl ? { adminUrl } : {}),
          },
        });
        result.adminNotified += 1;
      } catch (error) {
        console.error("[push] Unanswered intro admin alert failed", { introId: intro.id, error });
      }
    }
  }

  return result;
}

/** The platform admin portal page where a commons' lounge guide is assigned. */
export function welcomeLoungesAdminPath(coopId: string) {
  return `/portal/admin/commons/${encodeURIComponent(coopId)}/welcome-tables`;
}

/**
 * Accounts on the platform admin allowlist (PLATFORM_ADMIN_EMAILS /
 * PLATFORM_ADMIN_WALLETS - see lib/admin-config.ts), matched by email or by
 * any linked wallet.
 */
async function findPlatformAdminUserIds(db: Db): Promise<string[]> {
  const emails = [...PLATFORM_ADMIN_EMAILS];
  const wallets = [...PLATFORM_ADMIN_WALLETS];
  if (!emails.length && !wallets.length) {
    console.warn("[welcome-intros] No platform admins configured; unanswered-intro admin alerts have no recipients");
    return [];
  }
  const or: Array<Record<string, unknown>> = [];
  if (emails.length) or.push({ email: { in: emails, mode: "insensitive" } });
  if (wallets.length) {
    or.push({ walletAddress: { in: wallets, mode: "insensitive" } });
    or.push({ wallets: { some: { address: { in: wallets, mode: "insensitive" } } } });
  }
  const users = await db.user.findMany({
    where: { OR: or, isBot: false, deletedAt: null },
    select: { id: true },
  });
  return users.map((user) => user.id);
}
