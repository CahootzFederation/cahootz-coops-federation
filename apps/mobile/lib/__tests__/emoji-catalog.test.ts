jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (key: string) => store.get(key) ?? null),
      setItem: jest.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
    },
  };
});

import {
  EMOJI_CATEGORIES,
  QUICK_REACTIONS,
  emojiName,
  loadRecentEmoji,
  rememberEmoji,
  searchEmoji,
} from '../emoji-catalog';

describe('emoji catalog', () => {
  it('offers the full set of emoji by category, not a handful', () => {
    const all = EMOJI_CATEGORIES.flatMap((category) => category.emojis);
    expect(all.length).toBeGreaterThan(1500);
    expect(EMOJI_CATEGORIES.map((category) => category.label)).toEqual([
      'Smileys',
      'People',
      'Nature',
      'Food',
      'Travel',
      'Activities',
      'Objects',
      'Symbols',
      'Flags',
    ]);
    expect(new Set(all.map(([emoji]) => emoji)).size).toBe(all.length);
    for (const emoji of QUICK_REACTIONS) expect(emojiName(emoji)).not.toBe(emoji);
  });

  it('finds emoji by name and keyword, best matches first', () => {
    expect(searchEmoji('party popper')[0]?.[0]).toBe('🎉');
    expect(searchEmoji('tada').map(([emoji]) => emoji)).toContain('🎉');
    expect(searchEmoji('red heart')[0]?.[0]).toBe('❤️');
    // A whole word beats a match inside a word (eggplant).
    expect(searchEmoji('plant')[0]?.[0]).toBe('🪴');
    expect(searchEmoji('thumbs').map(([emoji]) => emoji)).toContain('👍');
    expect(searchEmoji('🌻')[0]?.[0]).toBe('🌻');
    expect(searchEmoji('   ')).toEqual([]);
    expect(searchEmoji('zzzqqq')).toEqual([]);
  });

  it('remembers recently picked emoji, newest first without duplicates', async () => {
    expect(await loadRecentEmoji()).toEqual([]);
    await rememberEmoji('🎉');
    await rememberEmoji('🔥');
    expect(await rememberEmoji('🎉')).toEqual(['🎉', '🔥']);
    expect(await loadRecentEmoji()).toEqual(['🎉', '🔥']);
  });
});
