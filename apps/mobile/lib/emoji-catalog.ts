import AsyncStorage from '@react-native-async-storage/async-storage';

import { EMOJI_CATEGORY_DATA, type EmojiEntry } from './emoji-catalog-data';

export type { EmojiEntry };

export const EMOJI_CATEGORIES = EMOJI_CATEGORY_DATA;

/** The one-tap reactions shown above the full picker, like Slack's. */
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '🙏', '👀', '🔥', '😮'] as const;

/** The like reaction; on posts and comments it keeps its own button. */
export const LIKE_EMOJI = '❤️';

const ALL_EMOJI: readonly EmojiEntry[] = EMOJI_CATEGORY_DATA.flatMap((category) => category.emojis);
const NAME_BY_EMOJI = new Map(ALL_EMOJI.map(([emoji, name]) => [emoji, name]));

export function emojiName(emoji: string): string {
  return NAME_BY_EMOJI.get(emoji) ?? emoji;
}

/**
 * Finds emoji whose name or keywords start with every word of the query
 * ("red heart", "party", "thumbs"). Exact name matches come first, then
 * names that start with the query, then names with a word that does,
 * then shorter names.
 */
export function searchEmoji(query: string, limit = 120): EmojiEntry[] {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const phrase = words.join(' ');
  const scored: Array<{ entry: EmojiEntry; score: number; index: number }> = [];
  ALL_EMOJI.forEach((entry, index) => {
    const [emoji, name, search] = entry;
    if (emoji === query.trim()) {
      scored.push({ entry, score: 0, index });
      return;
    }
    const terms = search.split(' ');
    if (!words.every((word) => terms.some((term) => term.startsWith(word)))) return;
    const score =
      name === phrase ? 1 : name.startsWith(phrase) ? 2 : ` ${name}`.includes(` ${phrase}`) ? 3 : 4;
    scored.push({ entry, score, index });
  });
  scored.sort(
    (a, b) => a.score - b.score || a.entry[1].length - b.entry[1].length || a.index - b.index,
  );
  return scored.slice(0, limit).map((item) => item.entry);
}

const RECENTS_KEY = 'cahootz.recentEmoji';
const MAX_RECENTS = 24;

/** The viewer's recently picked emoji on this device, newest first. */
export async function loadRecentEmoji(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(RECENTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export async function rememberEmoji(emoji: string): Promise<string[]> {
  const next = [emoji, ...(await loadRecentEmoji()).filter((item) => item !== emoji)].slice(0, MAX_RECENTS);
  try {
    await AsyncStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // Recents are a convenience; picking still works without storage.
  }
  return next;
}
