import type { CircleNotificationLevel } from "@repo/validators/notification";
import { parseCircleNotificationLevel } from "@repo/validators/notification";

import { createNotificationAndPush } from "./push-notification-service.js";

const CHATTING_WINDOW_MS = 90_000;

type CircleActivity = {
  coopId: string;
  circleId: string;
  postId: string;
  actorId: string;
  actorName: string;
  kind: "post" | "comment";
  /** Non-bot users mentioned in the content who are allowed to read the circle. */
  mentionedUserIds: string[];
  /** Comments only: the post author (if they can still read the circle), who gets a "replied to your post" alert. */
  postAuthorId?: string | null;
};

/**
 * Fans out notifications for new activity in a circle, honouring each member's
 * per-circle level:
 *  - ALL:      every new post/reply, plus mentions and replies to their posts
 *  - MENTIONS: only mentions and replies to their posts (default)
 *  - NONE:     inbox only - nothing is pushed to their phone
 */
export async function notifyCircleActivity(db: any, activity: CircleActivity) {
  const circle: { name: string } | null = await db.group.findUnique({
    where: { id: activity.circleId },
    select: { name: true },
  });
  const circleName = circle?.name || "your circle";
  const members: Array<{
    userId: string;
    notificationLevel: string;
    user: { isBot: boolean };
  }> = await db.groupMember.findMany({
    where: { groupId: activity.circleId },
    select: {
      userId: true,
      notificationLevel: true,
      user: { select: { isBot: true } },
    },
  });
  const levels = new Map<string, CircleNotificationLevel>(
    members.map((member) => [
      member.userId,
      parseCircleNotificationLevel(member.notificationLevel),
    ]),
  );
  const levelFor = (userId: string) =>
    levels.get(userId) ?? parseCircleNotificationLevel(undefined);

  // People with the chat open are already seeing new messages live.
  const chatting: Array<{ userId: string }> =
    await db.circleChatPresence.findMany({
      where: {
        groupId: activity.circleId,
        exitedAt: null,
        lastActivityAt: { gt: new Date(Date.now() - CHATTING_WINDOW_MS) },
      },
      select: { userId: true },
    });
  const chattingIds = new Set(chatting.map((row) => row.userId));

  const notified = new Set<string>([activity.actorId]);
  const send = (
    userId: string,
    type: string,
    title: string,
    body: string,
    push: boolean,
  ) => {
    notified.add(userId);
    void createNotificationAndPush(db, {
      userId,
      coopId: activity.coopId,
      type,
      title,
      body,
      push,
      data: {
        postId: activity.postId,
        coopId: activity.coopId,
        circleId: activity.circleId,
      },
    }).catch(() => {
      console.error("[push] circle notification preparation failed", {
        postId: activity.postId,
        type,
      });
    });
  };

  const where = activity.kind === "post" ? "a post" : "a comment";
  for (const userId of activity.mentionedUserIds) {
    if (notified.has(userId)) continue;
    send(
      userId,
      "MENTION",
      "You were mentioned",
      `${activity.actorName} mentioned you in ${where}.`,
      levelFor(userId) !== "NONE",
    );
  }

  if (
    activity.kind === "comment" &&
    activity.postAuthorId &&
    !notified.has(activity.postAuthorId)
  ) {
    send(
      activity.postAuthorId,
      "COMMONS_COMMENT",
      "New comment",
      `${activity.actorName} replied to your post.`,
      levelFor(activity.postAuthorId) !== "NONE",
    );
  }

  for (const member of members) {
    if (member.user.isBot || notified.has(member.userId)) continue;
    if (levelFor(member.userId) !== "ALL") continue;
    if (chattingIds.has(member.userId)) continue;
    send(
      member.userId,
      activity.kind === "post" ? "CIRCLE_POST" : "CIRCLE_COMMENT",
      activity.kind === "post" ? "New circle post" : "New circle reply",
      activity.kind === "post"
        ? `${activity.actorName} posted in ${circleName}.`
        : `${activity.actorName} replied in ${circleName}.`,
      true,
    );
  }

  return { recipients: notified.size - 1 };
}
