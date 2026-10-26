import type { Context } from "../context.js";

type UnreadDb = Pick<Context["db"], "commonsPost" | "commonsComment" | "groupMember">;

export type CircleReadState = { groupId: string; joinedAt: Date; lastReadAt: Date | null };

/**
 * New posts and comments in each circle from other people since the viewer
 * last opened it. A member who has never opened the circle counts from when
 * they joined, so nothing from before they arrived shows as unread.
 */
export async function getCircleUnreadCounts(
  db: UnreadDb,
  userId: string,
  memberships: CircleReadState[],
): Promise<Map<string, number>> {
  const counts = await Promise.all(
    memberships.map(async ({ groupId, joinedAt, lastReadAt }) => {
      const since = lastReadAt ?? joinedAt;
      const [posts, comments] = await Promise.all([
        db.commonsPost.count({
          where: { circleId: groupId, authorId: { not: userId }, createdAt: { gt: since } },
        }),
        db.commonsComment.count({
          where: { post: { circleId: groupId }, authorId: { not: userId }, createdAt: { gt: since } },
        }),
      ]);
      return [groupId, posts + comments] as const;
    }),
  );
  return new Map(counts);
}

/** Opening a circle's feed reads everything in it up to now. */
export async function markCircleRead(db: UnreadDb, groupId: string, userId: string) {
  await db.groupMember.updateMany({
    where: { groupId, userId },
    data: { lastReadAt: new Date() },
  });
}
