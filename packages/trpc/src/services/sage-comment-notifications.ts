import { db } from "@repo/db";

import { createNotificationAndPush } from "./push-notification-service.js";

type NotifyClient = Pick<typeof db, "commonsPost" | "commonsComment" | "groupMember" | "userCoopMembership">;

/**
 * Tells the people in a discussion that Sage commented in it: the post's author and everyone else who
 * has commented, never bots (Sage included). For a circle post, only people still in the circle are
 * told; for a Commons post, only active members of that Commons. Best-effort: a failed alert never
 * undoes the comment.
 */
export async function notifySageComment(
  input: { postId: string; commentId: string },
  client: NotifyClient = db,
): Promise<string[]> {
  try {
    const [post, comment] = await Promise.all([
      client.commonsPost.findUnique({
        where: { id: input.postId },
        select: { id: true, coopId: true, circleId: true, title: true, authorId: true, author: { select: { isBot: true } } },
      }),
      client.commonsComment.findUnique({ where: { id: input.commentId }, select: { content: true } }),
    ]);
    if (!post || !comment) return [];

    const commenters = await client.commonsComment.findMany({
      where: { postId: post.id, id: { not: input.commentId }, author: { isBot: false } },
      select: { authorId: true }, distinct: ["authorId"],
    });
    const candidates = [...new Set([...(post.author.isBot ? [] : [post.authorId]), ...commenters.map((row) => row.authorId)])];
    if (!candidates.length) return [];

    const isCirclePost = !!post.circleId && post.circleId !== `general:${post.coopId}`;
    const allowed = isCirclePost
      ? await client.groupMember.findMany({ where: { groupId: post.circleId!, userId: { in: candidates } }, select: { userId: true } })
      : await client.userCoopMembership.findMany({ where: { coopId: post.coopId, userId: { in: candidates }, status: "ACTIVE" }, select: { userId: true } });
    const recipients = candidates.filter((userId) => allowed.some((row) => row.userId === userId));

    const body = comment.content.replace(/\[@([^\]]+)\]/g, "@$1").replace(/\s+/g, " ").trim().slice(0, 140);
    await Promise.all(recipients.map((userId) => createNotificationAndPush(db, {
      userId, coopId: post.coopId, type: "SAGE_COMMENT",
      title: userId === post.authorId ? "Sage commented on your post" : "Sage commented on a post you commented on",
      body,
      data: { postId: post.id, coopId: post.coopId, commentId: input.commentId },
    }).catch((error) => console.error("Could not notify about Sage comment", { userId, error }))));
    return recipients;
  } catch (error) {
    console.error("Could not notify about Sage comment", error);
    return [];
  }
}
