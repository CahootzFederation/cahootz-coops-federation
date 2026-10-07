import { z } from "zod";

/** The "like" reaction. On posts it is a CommonsPostSupport row. */
export const LIKE_EMOJI = "❤️";

/** How many different emoji one member may leave on one post or comment. */
export const MAX_REACTIONS_PER_MEMBER = 20;

// One emoji: pictographs with optional variation selectors, skin tones and
// zero-width joins, keycaps (1️⃣), or a flag (🇺🇸 or a tag sequence 🏴). No
// letters, spaces or free text.
const SINGLE_EMOJI =
  /^(?:(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})[\u{FE0F}\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]*(?:\u{200D}(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})[\u{FE0F}\u{1F3FB}-\u{1F3FF}]*)*|[0-9#*]\u{FE0F}?\u{20E3}|\p{Regional_Indicator}{2})$/u;

export function isReactionEmoji(value: string): boolean {
  return value.length > 0 && value.length <= 32 && SINGLE_EMOJI.test(value);
}

export const reactionEmojiSchema = z
  .string()
  .trim()
  .refine(isReactionEmoji, { message: "Choose a single emoji." });

export interface ReactionSummary {
  emoji: string;
  count: number;
  viewerReacted: boolean;
}

/**
 * Collapses reaction rows into one chip per emoji, in the order each emoji
 * was first used (rows must arrive oldest first), the way Slack lists them.
 */
export function summarizeReactions(
  rows: ReadonlyArray<{ emoji: string; userId: string }>,
  viewerId: string | null | undefined,
): ReactionSummary[] {
  const byEmoji = new Map<string, ReactionSummary>();
  for (const row of rows) {
    const summary = byEmoji.get(row.emoji) ?? { emoji: row.emoji, count: 0, viewerReacted: false };
    summary.count += 1;
    if (viewerId && row.userId === viewerId) summary.viewerReacted = true;
    byEmoji.set(row.emoji, summary);
  }
  return [...byEmoji.values()];
}
