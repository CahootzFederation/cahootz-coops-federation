import { parseCircleNotificationLevel } from "@repo/validators/notification";

import { COMMONS_COOP_ID } from "../lib/commons.js";
import { stewardIdsFor } from "./commons-membership.js";
import { createNotificationAndPush } from "./push-notification-service.js";

export const COMMONS_MEMBER_JOINED = "COMMONS_MEMBER_JOINED";
export const CIRCLE_MEMBER_JOINED = "CIRCLE_MEMBER_JOINED";

type Db = any;

function joinerName(user: { name: string | null; handle?: string | null; email?: string | null } | null) {
  return (
    user?.name?.trim() ||
    (user?.handle ? `@${user.handle}` : null) ||
    user?.email?.split("@")[0] ||
    "A new member"
  );
}

async function commonsName(db: Db, coopId: string) {
  const config: { name: string | null } | null = await db.coopConfig.findFirst({
    where: { coopId, isActive: true },
    select: { name: true },
    orderBy: { version: "desc" },
  });
  return config?.name || "your commons";
}

/**
 * Tells a commons' stewards that someone just became a member. Never sent for
 * the platform-wide Cahootz commons, which everyone joins on sign-up.
 * `exceptUserIds` skips people already told by a more specific alert (the
 * inviter, the steward who approved the request).
 */
export async function notifyCommonsMemberJoined(
  db: Db,
  params: { coopId: string; userId: string; exceptUserIds?: string[] },
) {
  if (params.coopId === COMMONS_COOP_ID) return;
  const skip = new Set([params.userId, ...(params.exceptUserIds ?? [])]);
  const stewardIds = (await stewardIdsFor(db, params.coopId)).filter((id) => !skip.has(id));
  if (!stewardIds.length) return;
  const [user, name] = await Promise.all([
    db.user.findUnique({
      where: { id: params.userId },
      select: { name: true, handle: true, email: true },
    }),
    commonsName(db, params.coopId),
  ]);
  await Promise.all(
    stewardIds.map((stewardId) =>
      createNotificationAndPush(db, {
        userId: stewardId,
        coopId: params.coopId,
        type: COMMONS_MEMBER_JOINED,
        title: `${joinerName(user)} joined ${name}`,
        body: "Say hello and help them find their way around.",
        data: { coopId: params.coopId, memberId: params.userId, memberHandle: user?.handle ?? null },
      }).catch((error) => console.error("Failed to notify steward of new member:", error)),
    ),
  );
}

/**
 * Tells a circle's leader (and whoever invited the person, if different) that
 * someone joined. Welcome lounges and direct-message circles have their own
 * alerts, so they're skipped. A leader who muted the circle still gets the
 * inbox row but no phone push.
 */
export async function notifyCircleMemberJoined(
  db: Db,
  params: { groupId: string; userId: string; inviterId?: string | null },
) {
  const group: { coopId: string; name: string; leaderId: string; kind: string } | null =
    await db.group.findUnique({
      where: { id: params.groupId },
      select: { coopId: true, name: true, leaderId: true, kind: true },
    });
  if (!group || group.kind !== "STANDARD") return;
  const recipients = [...new Set([group.leaderId, params.inviterId].filter(Boolean) as string[])].filter(
    (id) => id !== params.userId,
  );
  if (!recipients.length) return;
  const [user, members] = await Promise.all([
    db.user.findUnique({
      where: { id: params.userId },
      select: { name: true, handle: true, email: true },
    }),
    db.groupMember.findMany({
      where: { groupId: params.groupId, userId: { in: recipients } },
      select: { userId: true, notificationLevel: true },
    }),
  ]);
  const levels = new Map<string, string>(
    members.map((member: { userId: string; notificationLevel: string }) => [member.userId, member.notificationLevel]),
  );
  await Promise.all(
    recipients
      // Someone who has since left the circle doesn't need to hear about it.
      .filter((recipientId) => levels.has(recipientId))
      .map((recipientId) =>
        createNotificationAndPush(db, {
          userId: recipientId,
          coopId: group.coopId,
          type: CIRCLE_MEMBER_JOINED,
          title: `${joinerName(user)} joined ${group.name}`,
          body: "They can now see and post in the circle.",
          push: parseCircleNotificationLevel(levels.get(recipientId)) !== "NONE",
          data: { coopId: group.coopId, circleId: params.groupId, memberId: params.userId, memberHandle: user?.handle ?? null },
        }).catch((error) => console.error("Failed to notify circle of new member:", error)),
      ),
  );
}
