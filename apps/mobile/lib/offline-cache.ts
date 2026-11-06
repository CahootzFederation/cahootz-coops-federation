import AsyncStorage from '@react-native-async-storage/async-storage';
import { sha256, stringToBytes } from 'viem';

/**
 * Last good answer for some API reads, saved on the phone so screens can show
 * something when there's no connection (see the fetch wrapper in lib/api.ts).
 *
 * - Only reads on SAVED_READS are kept: community screens a member already
 *   sees in their Commons. Money, wallets, receipts, direct messages, Sage,
 *   alerts and account details are never saved, because AsyncStorage isn't
 *   encrypted.
 * - Keys are a SHA-256 of the account (session token and wallet), the Commons
 *   the request is for (`x-coop-id`), and the full URL, so one account or
 *   Commons never sees another's data and keys never contain a token.
 * - Entries older than MAX_AGE_MS aren't shown.
 * - Everything is wiped on sign-out (`clearOfflineCache`). Saves that were
 *   still on their way when sign-out started are dropped, not written after.
 * - Size is capped: the most recent MAX_ENTRIES reads, each under MAX_BODY_CHARS.
 */

const PREFIX = 'cahootz.offline.';
const INDEX_KEY = `${PREFIX}index`;
export const MAX_ENTRIES = 150;
export const MAX_BODY_CHARS = 200_000;
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** tRPC procedures whose answers may be saved for offline use. */
export const SAVED_READS: ReadonlySet<string> = new Set([
  // The Commons itself and the list of Commons.
  'coopConfig.getActive',
  'coopConfig.listAvailableCoops',
  'platformConfig.getConfig',
  'commons.listDirectory',
  // Circles, posts and the board.
  'groups.listVisible',
  'groups.listMine',
  'groups.getDetail',
  'groups.listComments',
  'commons.listFeed',
  'commons.getPost',
  'commons.listBoardItems',
  'commons.listCircleMedia',
  'communityPulse.list',
  'commonsActions.listResources',
  'events.get',
  // Proposals.
  'proposal.list',
  'proposal.getById',
  'proposalComment.listByProposal',
  'proposalReaction.getCounts',
  // Public store listings (not orders or payments).
  'store.getStores',
  'store.getStore',
  'store.getProducts',
  'store.getProduct',
  'store.getFeaturedProducts',
  'categories.getProductCategories',
  'categories.getStoreCategories',
]);

type SavedEntry = { savedAt: number; body: string };

// Most recently saved first.
let index: string[] | null = null;
let indexLoad: Promise<string[]> | null = null;
// Skips rewriting a body that hasn't changed (polls repeat the same answer).
const lastSaved = new Map<string, string>();
// Bumped by every sign-out. A save from an older generation is dropped.
let generation = 0;
// Saves and clears run one at a time, so the index is never overwritten by a
// save that read it before another save (or a clear) changed it.
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
}

/** Short, stable hash for spotting a body that hasn't changed. Not for keys. */
export function hashText(text: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** Current sign-out generation. Capture it when a read starts. */
export function offlineCacheGeneration() {
  return generation;
}

/** Resolves once every save, forget and clear started so far has finished. */
export function offlineCacheIdle() {
  return queue.then(() => undefined);
}

/** Whether a tRPC procedure's answer may be saved. */
export function isSavedRead(procedure: string) {
  return SAVED_READS.has(procedure);
}

/** Storage key for one read by one account in one Commons. */
export function offlineCacheKey(url: string, identity: string, coopId = '') {
  const digest = sha256(stringToBytes(`${identity}\n${coopId}\n${url}`)).slice(2);
  return `${PREFIX}${digest}`;
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

/**
 * Saves a read's answer. `fromGeneration` is the generation when the read
 * started; if the member signed out since, nothing is written.
 */
export function saveOfflineResponse(key: string, body: string, fromGeneration = generation) {
  if (body.length > MAX_BODY_CHARS) return Promise.resolve();
  const fingerprint = `${body.length}:${hashText(body)}`;
  return enqueue(async () => {
    if (fromGeneration !== generation) return;
    if (lastSaved.get(key) === fingerprint) return;
    try {
      const keys = await loadIndex();
      const next = [key, ...keys.filter((existing) => existing !== key)];
      const dropped = next.splice(MAX_ENTRIES);
      const entry: SavedEntry = { savedAt: Date.now(), body };
      await AsyncStorage.setItem(key, JSON.stringify(entry));
      await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(next));
      index = next;
      if (dropped.length) await AsyncStorage.multiRemove(dropped);
      dropped.forEach((oldKey) => lastSaved.delete(oldKey));
      lastSaved.set(key, fingerprint);
    } catch {
      // Saving is best effort; a full disk just means less to show offline.
    }
  });
}

/** The saved answer for `key`, or null when there's none or it's too old. */
export async function readOfflineResponse(key: string, now = Date.now()) {
  const startedIn = generation;
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw || startedIn !== generation) return null;
    const entry = JSON.parse(raw) as Partial<SavedEntry>;
    if (typeof entry.body !== 'string' || typeof entry.savedAt !== 'number') return null;
    if (now - entry.savedAt > MAX_AGE_MS) return null;
    return entry.body;
  } catch {
    return null;
  }
}

/** Forgets one saved read, e.g. when the server says it's no longer yours to see. */
export function forgetOfflineResponse(key: string) {
  return enqueue(async () => {
    lastSaved.delete(key);
    try {
      const keys = await loadIndex();
      if (keys.includes(key)) {
        index = keys.filter((existing) => existing !== key);
        await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(index));
      }
      await AsyncStorage.removeItem(key);
    } catch {
      // The entry expires on its own.
    }
  });
}

/** Removes every saved read. Called on sign-out. */
export function clearOfflineCache() {
  // Bump first, so saves already waiting in the queue skip themselves.
  generation += 1;
  return enqueue(async () => {
    lastSaved.clear();
    try {
      const known = await loadIndex();
      // Also catch entries a lost or damaged index no longer lists.
      const all = await AsyncStorage.getAllKeys();
      const ours = all.filter((key) => key.startsWith(PREFIX));
      await AsyncStorage.multiRemove([...new Set([...known, ...ours, INDEX_KEY])]);
    } catch {
      // Nothing else to do; entries can't be read without a matching session.
    } finally {
      index = [];
      indexLoad = null;
    }
  });
}
