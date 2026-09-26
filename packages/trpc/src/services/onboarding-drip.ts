import type { NotificationPreferences } from "@repo/validators/notification";
import { defaultNotificationPreferences } from "@repo/validators/notification";

import type { Context } from "../context.js";
import type { DripMessage, DripStepConfig, DripStepDay } from "./onboarding-drip-config.js";
import { isEmailConfigured, sendOnboardingDripEmail } from "../lib/email.js";
import {
  DAY1_POST_LOOKBACK_HOURS,
  DAY3_EVENT_HORIZON_DAYS,
  DRIP_BATCH_SIZE,
  DRIP_LOOKBACK_HOURS,
  DRIP_STEPS,
  dripCopy,
  dripLinkBaseUrl,
  eventStartsLabel,
  firstName,
  isDeliverableEmail,
  MIN_POPULAR_CIRCLE_MEMBERS,
  ONBOARDING_DRIP_NOTIFICATION_TYPE,
} from "./onboarding-drip-config.js";
import { createNotificationAndPush } from "./push-notification-service.js";

/**
 * New-member re-engagement drip.
 *
 * An hourly sweep looks at memberships that started in the last ~8 days and
 * sends each member at most three nudges (day 1, 3 and 7), each pointing at
 * something concrete in their commons. A step is skipped when the member has
 * come back on their own, when there's nothing real to show, or when they've
 * turned off "Getting started tips". Thresholds and copy live in
 * `onboarding-drip-config.ts`.
 */

type Db = Context["db"];
const HOUR_MS = 60 * 60 * 1000;

export type DripSkipReason = "NOT_DUE" | "ALREADY_SENT" | "ACTIVE";

export interface DripCandidate {
  joinedAt: Date;
  lastActiveAt: Date | null;
  sentSteps: ReadonlySet<number>;
}

/**
 * Decides which step (if any) is due for one membership right now. Step
 * windows don't overlap, so at most one step can be in its window; a step
 * whose window has passed is never sent late.
 */
export function planDripStep(
  candidate: DripCandidate,
  now: Date,
): { step: DripStepConfig } | { skip: DripSkipReason } {
  const joined = candidate.joinedAt.getTime();
  const step = DRIP_STEPS.find((config) => {
    const due = joined + config.dueAfterHours * HOUR_MS;
    return now.getTime() >= due && now.getTime() < due + config.windowHours * HOUR_MS;
  });
  if (!step) return { skip: "NOT_DUE" };
  if (candidate.sentSteps.has(step.day)) return { skip: "ALREADY_SENT" };
  const quietSince = joined + step.quietSinceHours * HOUR_MS;
  if (candidate.lastActiveAt && candidate.lastActiveAt.getTime() >= quietSince) {
    return { skip: "ACTIVE" };
  }
  return { step };
}

export type DripTarget =
  | { type: "POST"; id: string; coopId: string; circleId: string | null }
  | { type: "EVENT"; id: string; coopId: string; postId: string }
  | { type: "CIRCLE"; id: string; coopId: string };

export interface DripContent {
  message: DripMessage;
  target: DripTarget;
}

interface DripMember {
  id: string;
  name: string | null;
  email: string;
}

/** Notification `data`; `notificationDestination` in the app turns it into a screen. */
export function dripNotificationData(target: DripTarget, day: DripStepDay): Record<string, string> {
  const base = { coopId: target.coopId, dripStep: String(day) };
  if (target.type === "POST") {
    return { ...base, postId: target.id, ...(target.circleId ? { circleId: target.circleId } : {}) };
  }
  if (target.type === "EVENT") return { ...base, eventId: target.id, postId: target.postId };
  return { ...base, circleId: target.id };
}

/** The same destination as a web link, for the email fallback. */
export function dripTargetUrl(target: DripTarget, baseUrl = dripLinkBaseUrl()): string {
  const coop = encodeURIComponent(target.coopId);
  if (target.type === "POST") return `${baseUrl}/${coop}/posts/${encodeURIComponent(target.id)}`;
  if (target.type === "EVENT") return `${baseUrl}/${coop}/events/${encodeURIComponent(target.id)}`;
  return `${baseUrl}/${coop}/posts?circleId=${encodeURIComponent(target.id)}`;
}

function displayName(user: { name: string | null; handle: string | null } | null | undefined) {
  return user?.name?.trim() || (user?.handle ? `@${user.handle}` : null);
}

async function memberCircleIds(db: Db, userId: string, coopId: string) {
  const rows = await db.groupMember.findMany({
    where: { userId, group: { coopId } },
    select: { groupId: true },
  });
  return rows.map((row: { groupId: string }) => row.groupId);
}

async function popularCircleNotJoined(db: Db, userId: string, coopId: string) {
  const [circle] = await db.group.findMany({
    where: {
      coopId,
      privacy: "public",
      kind: "STANDARD",
      members: { none: { userId } },
    },
    orderBy: [{ members: { _count: "desc" } }, { lastActivityAt: "desc" }],
    take: 1,
    select: { id: true, name: true, purpose: true, _count: { select: { members: true } } },
  });
  if (!circle || circle._count.members < MIN_POPULAR_CIRCLE_MEMBERS) return null;
  return circle;
}

/** Day 1: what happened in the member's circles (incl. their welcome lounge) today. */
async function day1Content(
  db: Db,
  member: DripMember,
  coopId: string,
  now: Date,
): Promise<DripContent | null> {
  const circleIds = await memberCircleIds(db, member.id, coopId);
  if (!circleIds.length) return null;
  const where = {
    coopId,
    circleId: { in: circleIds },
    authorId: { not: member.id },
    createdAt: { gte: new Date(now.getTime() - DAY1_POST_LOOKBACK_HOURS * HOUR_MS), lte: now },
  };
  const [newPostCount, posts] = await Promise.all([
    db.commonsPost.count({ where }),
    db.commonsPost.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        title: true,
        circleId: true,
        createdAt: true,
        author: { select: { name: true, handle: true, isBot: true } },
        _count: { select: { comments: true, supports: true } },
      },
    }),
  ]);
  if (!posts.length) return null;
  // Prefer a person over Sage, then the liveliest thread, then the newest.
  const [pick] = [...posts].sort(
    (a, b) =>
      Number(a.author.isBot) - Number(b.author.isBot) ||
      b._count.comments + b._count.supports - (a._count.comments + a._count.supports) ||
      b.createdAt.getTime() - a.createdAt.getTime(),
  );
  const circleCount = new Set(posts.map((post: { circleId: string | null }) => post.circleId)).size;
  const circle = pick!.circleId
    ? await db.group.findUnique({ where: { id: pick!.circleId }, select: { name: true } })
    : null;
  return {
    message: dripCopy.day1({
      newPostCount,
      circleName: circle?.name ?? "your circles",
      circleCount,
      postTitle: pick!.title,
      authorName: displayName(pick!.author) ?? "a member",
    }),
    target: { type: "POST", id: pick!.id, coopId, circleId: pick!.circleId },
  };
}

/** Day 3: an upcoming event in their commons or circles, else a popular circle they haven't joined. */
async function day3Content(
  db: Db,
  member: DripMember,
  coopId: string,
  commonsName: string,
  now: Date,
): Promise<DripContent | null> {
  const circleIds = await memberCircleIds(db, member.id, coopId);
  const [event] = await db.event.findMany({
    where: {
      coopId,
      startAt: { gt: now, lte: new Date(now.getTime() + DAY3_EVENT_HORIZON_DAYS * 24 * HOUR_MS) },
      OR: [
        { circleId: null },
        { circleId: `general:${coopId}` },
        ...(circleIds.length ? [{ circleId: { in: circleIds } }] : []),
      ],
    },
    orderBy: { startAt: "asc" },
    take: 1,
    select: {
      id: true,
      postId: true,
      circleId: true,
      startAt: true,
      post: { select: { title: true } },
      _count: { select: { rsvps: { where: { status: "GOING" } } } },
    },
  });
  if (event) {
    const circle =
      event.circleId && event.circleId !== `general:${coopId}`
        ? await db.group.findUnique({ where: { id: event.circleId }, select: { name: true } })
        : null;
    return {
      message: dripCopy.day3Event({
        eventTitle: event.post.title,
        startsLabel: eventStartsLabel(event.startAt, now),
        goingCount: event._count.rsvps,
        where: circle?.name ?? commonsName,
      }),
      target: { type: "EVENT", id: event.id, coopId, postId: event.postId },
    };
  }
  const circle = await popularCircleNotJoined(db, member.id, coopId);
  if (!circle) return null;
  return {
    message: dripCopy.day3Circle({
      circleName: circle.name,
      memberCount: circle._count.members,
      purpose: circle.purpose,
    }),
    target: { type: "CIRCLE", id: circle.id, coopId },
  };
}

/**
 * Day 7: a note signed by their welcome lounge guide, pointing back at the
 * lounge. Without a guide it's signed by the commons; without a lounge it
 * points at their most active circle, or a popular one to join.
 */
async function day7Content(
  db: Db,
  member: DripMember,
  coopId: string,
  commonsName: string,
): Promise<DripContent | null> {
  const lounge = await db.groupMember.findFirst({
    where: { userId: member.id, role: "NEWCOMER", group: { coopId, kind: "WELCOME_TABLE" } },
    orderBy: { joinedAt: "desc" },
    select: {
      group: {
        select: {
          id: true,
          name: true,
          members: {
            where: { role: "GUIDE", user: { deletedAt: null, isBot: false } },
            take: 1,
            select: { user: { select: { name: true, handle: true } } },
          },
        },
      },
    },
  });

  let target: { id: string; name: string } | null = lounge?.group ?? null;
  const guideName = lounge ? displayName(lounge.group.members[0]?.user) : null;
  if (!target) {
    target = await db.group.findFirst({
      where: { coopId, members: { some: { userId: member.id } } },
      orderBy: { lastActivityAt: "desc" },
      select: { id: true, name: true },
    });
  }
  if (!target) target = await popularCircleNotJoined(db, member.id, coopId);
  if (!target) return null;

  return {
    message: dripCopy.day7({
      memberFirstName: firstName(member.name),
      guideName,
      commonsName,
      targetName: target.name,
    }),
    target: { type: "CIRCLE", id: target.id, coopId },
  };
}

export async function resolveDripContent(
  db: Db,
  input: { day: DripStepDay; member: DripMember; coopId: string; commonsName: string; now: Date },
): Promise<DripContent | null> {
  if (input.day === 1) return day1Content(db, input.member, input.coopId, input.now);
  if (input.day === 3) return day3Content(db, input.member, input.coopId, input.commonsName, input.now);
  return day7Content(db, input.member, input.coopId, input.commonsName);
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

export type DripDeliveryResult =
  | { status: "SENT"; channel: "PUSH" | "EMAIL" | "INBOX"; notificationId: string }
  | { status: "OPTED_OUT" | "ALREADY_SENT" | "FAILED" };

/**
 * Claims the step (the unique row is the idempotency guard), then writes the
 * inbox alert and pushes it. When the member can't receive a push (push off
 * or no registered device) and has a real email address, it also emails.
 */
export async function deliverDripStep(
  db: Db,
  input: { day: DripStepDay; member: DripMember; coopId: string; commonsName: string; content: DripContent },
): Promise<DripDeliveryResult> {
  const { member, coopId, content, day } = input;
  const preferences: NotificationPreferences =
    (await db.notificationPreference.findUnique({ where: { userId: member.id } })) ??
    defaultNotificationPreferences;
  if (!preferences.onboarding) return { status: "OPTED_OUT" };

  let claimId: string;
  try {
    const claim = await db.onboardingDripSend.create({
      data: {
        userId: member.id,
        coopId,
        step: day,
        targetType: content.target.type,
        targetId: content.target.id,
      },
      select: { id: true },
    });
    claimId = claim.id;
  } catch (error) {
    if (isUniqueViolation(error)) return { status: "ALREADY_SENT" };
    throw error;
  }

  try {
    const pushable =
      preferences.pushEnabled &&
      (await db.pushDevice.count({ where: { userId: member.id, coopId, enabled: true } })) > 0;
    const notification = await createNotificationAndPush(db, {
      userId: member.id,
      coopId,
      type: ONBOARDING_DRIP_NOTIFICATION_TYPE,
      title: content.message.title,
      body: content.message.body,
      data: dripNotificationData(content.target, day),
    });

    let channel: "PUSH" | "EMAIL" | "INBOX" = pushable ? "PUSH" : "INBOX";
    if (!pushable && isDeliverableEmail(member.email) && isEmailConfigured()) {
      try {
        await sendOnboardingDripEmail({
          to: member.email,
          commonsName: input.commonsName,
          subject: content.message.emailSubject,
          heading: content.message.title,
          body: content.message.body,
          ctaLabel: content.message.ctaLabel,
          ctaUrl: dripTargetUrl(content.target),
        });
        channel = "EMAIL";
      } catch (error) {
        // The inbox alert already went out; don't fail (or retry) the step.
        console.warn("[onboarding-drip] Email fallback failed", {
          userId: member.id,
          day,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await db.onboardingDripSend.update({
      where: { id: claimId },
      data: { status: "SENT", channel, notificationId: notification.id, sentAt: new Date() },
    });
    return { status: "SENT", channel, notificationId: notification.id };
  } catch (error) {
    // Leave the claim in place as FAILED so a later sweep never double-sends.
    await db.onboardingDripSend
      .update({ where: { id: claimId }, data: { status: "FAILED" } })
      .catch(() => {});
    console.error("[onboarding-drip] Delivery failed", {
      userId: member.id,
      day,
      error: error instanceof Error ? error.message : String(error),
    });
    return { status: "FAILED" };
  }
}

export interface DripRunSummary {
  considered: number;
  sent: number;
  skipped: Record<DripSkipReason | "NOTHING_TO_SHOW" | "OPTED_OUT" | "ONE_PER_RUN", number>;
  failed: number;
}

/**
 * One sweep. `userIds` / `coopId` narrow it (used by the E2E fixture script);
 * the scheduled task passes neither.
 */
export async function runOnboardingDrip(
  db: Db,
  options: { now?: Date; userIds?: string[]; coopId?: string } = {},
): Promise<DripRunSummary> {
  const now = options.now ?? new Date();
  const lookbackStart = new Date(now.getTime() - DRIP_LOOKBACK_HOURS * HOUR_MS);
  const summary: DripRunSummary = {
    considered: 0,
    sent: 0,
    failed: 0,
    skipped: { NOT_DUE: 0, ALREADY_SENT: 0, ACTIVE: 0, NOTHING_TO_SHOW: 0, OPTED_OUT: 0, ONE_PER_RUN: 0 },
  };

  const commonsNames = new Map<string, string>();
  const commonsName = async (coopId: string) => {
    if (!commonsNames.has(coopId)) {
      const config = await db.coopConfig.findFirst({
        where: { coopId, isActive: true },
        orderBy: { version: "desc" },
        select: { name: true },
      });
      commonsNames.set(coopId, config?.name?.trim() || "your Commons");
    }
    return commonsNames.get(coopId)!;
  };
  // A member who joined several commons this week hears from at most one per sweep.
  const messagedThisRun = new Set<string>();

  let cursor: string | undefined;
  for (;;) {
    const page = await db.userCoopMembership.findMany({
      where: {
        status: "ACTIVE",
        ...(options.userIds ? { userId: { in: options.userIds } } : {}),
        ...(options.coopId ? { coopId: options.coopId } : {}),
        OR: [
          { joinedAt: { gte: lookbackStart, lte: now } },
          { joinedAt: null, createdAt: { gte: lookbackStart, lte: now } },
        ],
        user: { deletedAt: null, isBot: false, status: { notIn: ["SUSPENDED", "REJECTED"] } },
      },
      orderBy: { id: "asc" },
      take: DRIP_BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        userId: true,
        coopId: true,
        joinedAt: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true, lastActiveAt: true } },
      },
    });
    if (!page.length) break;
    cursor = page[page.length - 1]!.id;

    const sends = await db.onboardingDripSend.findMany({
      where: { userId: { in: [...new Set(page.map((m: { userId: string }) => m.userId))] } },
      select: { userId: true, coopId: true, step: true },
    });
    const sentByMembership = new Map<string, Set<number>>();
    for (const send of sends) {
      const key = `${send.userId}:${send.coopId}`;
      if (!sentByMembership.has(key)) sentByMembership.set(key, new Set());
      sentByMembership.get(key)!.add(send.step);
    }

    for (const membership of page) {
      summary.considered += 1;
      const plan = planDripStep(
        {
          joinedAt: membership.joinedAt ?? membership.createdAt,
          lastActiveAt: membership.user.lastActiveAt,
          sentSteps: sentByMembership.get(`${membership.userId}:${membership.coopId}`) ?? new Set(),
        },
        now,
      );
      if ("skip" in plan) {
        summary.skipped[plan.skip] += 1;
        continue;
      }
      if (messagedThisRun.has(membership.userId)) {
        summary.skipped.ONE_PER_RUN += 1;
        continue;
      }

      try {
        const name = await commonsName(membership.coopId);
        const content = await resolveDripContent(db, {
          day: plan.step.day,
          member: membership.user,
          coopId: membership.coopId,
          commonsName: name,
          now,
        });
        // Nothing concrete to point at: skip for now. The step stays unsent,
        // so a later sweep inside its window can still send it.
        if (!content) {
          summary.skipped.NOTHING_TO_SHOW += 1;
          continue;
        }
        const result = await deliverDripStep(db, {
          day: plan.step.day,
          member: membership.user,
          coopId: membership.coopId,
          commonsName: name,
          content,
        });
        if (result.status === "SENT") {
          summary.sent += 1;
          messagedThisRun.add(membership.userId);
        } else if (result.status === "FAILED") summary.failed += 1;
        else summary.skipped[result.status] += 1;
      } catch (error) {
        summary.failed += 1;
        console.error("[onboarding-drip] Could not process membership", {
          userId: membership.userId,
          coopId: membership.coopId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (page.length < DRIP_BATCH_SIZE) break;
  }
  return summary;
}
