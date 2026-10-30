import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Last good answer for each API read, saved on the phone so screens can show
 * something when there's no connection (see the fetch wrapper in lib/api.ts).
 *
 * - Only reads (GET) are saved. Anything that sends or changes data is never
 *   saved or replayed.
 * - Entries are keyed by account, so one account never sees another's data,
 *   and everything is wiped on sign-out (`clearOfflineCache`).
 * - Size is capped: the most recent MAX_ENTRIES reads, each under MAX_BODY_CHARS.
 */

const PREFIX = 'cahootz.offline.';
const INDEX_KEY = `${PREFIX}index`;
export const MAX_ENTRIES = 150;
export const MAX_BODY_CHARS = 200_000;

// Most recently saved first.
let index: string[] | null = null;
let indexLoad: Promise<string[]> | null = null;
// Skips rewriting a body that hasn't changed (polls repeat the same answer).
const lastSaved = new Map<string, string>();

/** Short, stable hash so keys never contain a session token. */
export function hashText(text: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** Storage key for one read by one account. */
export function offlineCacheKey(url: string, identity: string) {
  return `${PREFIX}${hashText(identity)}.${hashText(url)}.${url.length}`;
}

async function loadIndex() {
  if (index) return index;
  indexLoad ??= AsyncStorage.getItem(INDEX_KEY)
    .then((raw) => {
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      index = Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string') : [];
      return index;
    })
    .catch(() => {
      index = [];
      return index;
    });
  return indexLoad;
}

export async function saveOfflineResponse(key: string, body: string) {
  if (body.length > MAX_BODY_CHARS) return;
  const fingerprint = `${body.length}:${hashText(body)}`;
  if (lastSaved.get(key) === fingerprint) return;
  try {
    const keys = await loadIndex();
    const next = [key, ...keys.filter((existing) => existing !== key)];
    const dropped = next.splice(MAX_ENTRIES);
    index = next;
    await AsyncStorage.setItem(key, body);
    await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(next));
    if (dropped.length) await AsyncStorage.multiRemove(dropped);
    dropped.forEach((oldKey) => lastSaved.delete(oldKey));
    lastSaved.set(key, fingerprint);
  } catch {
    // Saving is best effort; a full disk just means less to show offline.
  }
}

export async function readOfflineResponse(key: string) {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Removes every saved read. Called on sign-out. */
export async function clearOfflineCache() {
  const keys = await loadIndex();
  index = [];
  indexLoad = null;
  lastSaved.clear();
  try {
    await AsyncStorage.multiRemove([...keys, INDEX_KEY]);
  } catch {
    // Nothing else to do; the entries are unreachable without the index.
  }
}
