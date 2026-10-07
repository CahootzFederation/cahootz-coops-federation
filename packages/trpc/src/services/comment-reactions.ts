import type { Context } from "../context.js";
import { createNotificationAndPush } from "./push-notification-service.js";
import { LIKE_EMOJI } from "./emoji-reactions.js";
import { recordWelcomeIntroReaction } from "./welcome-intros.js";

type Db = Context["db"];

export const COMMONS_COMMENT_LIKE_NOTIFICATION = "COMMONS_COMMENT_LIKE";

export interface NewCommentReaction {
  comment: {
    id: string;
    authorId: string;
    author: { isBot: boolean };
    post: { id: string; coopId: string };
  };
  reactor: { id: string; name: string | null; email: string; isBot?: boolean };
  /** Defaults to the like (❤️). */
  emoji?: string;
}

/**
 * Alerts for a member's first reaction on a comment (callers skip a second
 * emoji from the same member, so a burst of reactions is one alert). Alerts
 * for a new comment like, mirroring post likes (toggleSupport): the
 * comment's author hears about it, never for their own like and never when
 * the author is a bot. A like on a welcome lounge intro that is that intro's
 * first response sends the one-time "reacted to your intro" alert instead,
 * not both. Returns which alert was sent.
 */
export async function notifyNewCommentReaction(
  db: Db,
  input: NewCommentReaction,
): Promise<"intro" | "like" | null> {
  const { comment, reactor } = input;
  const emoji = input.emoji ?? LIKE_EMOJI;
  if (reactor.isBot || comment.authorId === reactor.id || comment.author.isBot) return null;

  const introAnswered = await recordWelcomeIntroReaction(db, {
    commentId: comment.id,
    reactor,
  }).catch((error) => {
    console.error("Welcome intro reaction tracking failed", { commentId: comment.id, error });
    return false;
  });
  if (introAnswered) return "intro";

  void createNotificationAndPush(db, {
    userId: comment.authorId,
    coopId: comment.post.coopId,
    type: COMMONS_COMMENT_LIKE_NOTIFICATION,
    ...(emoji === LIKE_EMOJI
      ? { title: "Someone liked your comment", body: "A commons member liked what you said." }
      : {
          title: "Someone reacted to your comment",
          body: `A commons member reacted ${emoji} to what you said.`,
        }),
    data: { postId: comment.post.id, commentId: comment.id, coopId: comment.post.coopId },
  }).catch((error) =>
    console.error("[push] Comment like notification failed", { commentId: comment.id, error }),
  );
  return "like";
}

export interface NewPostReaction {
  post: { id: string; coopId: string; authorId: string | null };
  reactor: { id: string; isBot?: boolean };
  emoji: string;
}

/**
 * Alerts a post's author to a member's first emoji reaction on it (the like
 * has its own alert in toggleSupport). Never for your own post or a bot.
 */
export function notifyNewPostReaction(db: Db, input: NewPostReaction): boolean {
  const { post, reactor, emoji } = input;
  if (reactor.isBot || !post.authorId || post.authorId === reactor.id) return false;
  void createNotificationAndPush(db, {
    userId: post.authorId,
    coopId: post.coopId,
    type: "COMMONS_SUPPORT",
    title: "Someone reacted to your post",
    body: `A commons member reacted ${emoji} to what you shared.`,
    data: { postId: post.id, coopId: post.coopId },
  }).catch((error) =>
    console.error("[push] Post reaction notification failed", { postId: post.id, error }),
  );
  return true;
}
