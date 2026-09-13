import { secureStorage } from './secure-storage';

// Deliberately not one of secureStorage.keys — those all get wiped by
// secureStorage.clear() on logout, but this id must survive independently
// until it's actually migrated onto a real account at login time (see
// verifyLoginCode in packages/trpc/src/routers/auth.ts).
const ANONYMOUS_ID_KEY = 'cahootz.anonymousId';
const ANONYMOUS_PROFILE_SEEN_KEY = 'cahootz.hasSeenAnonymousProfileIntro';

function generateAnonymousId(): string {
  const randomChunk = () => Math.random().toString(36).slice(2);
  return `anon_${Date.now().toString(36)}_${randomChunk()}${randomChunk()}`;
}

export async function getOrCreateAnonymousId(): Promise<string> {
  const existing = await secureStorage.getItem(ANONYMOUS_ID_KEY);
  if (existing) return existing;

  const id = generateAnonymousId();
  await secureStorage.setItem(ANONYMOUS_ID_KEY, id);
  return id;
}

export async function getAnonymousId(): Promise<string | null> {
  return secureStorage.getItem(ANONYMOUS_ID_KEY);
}

// Called once the id has been sent through a successful login, so it's never
// reused for a different future signer on the same device.
export async function clearAnonymousId(): Promise<void> {
  await secureStorage.removeItem(ANONYMOUS_ID_KEY);
}

export async function hasSeenAnonymousProfileIntro(): Promise<boolean> {
  const value = await secureStorage.getItem(ANONYMOUS_PROFILE_SEEN_KEY);
  return value === 'true';
}

export async function markAnonymousProfileIntroSeen(): Promise<void> {
  await secureStorage.setItem(ANONYMOUS_PROFILE_SEEN_KEY, 'true');
}

// Dev/QA helper: lets the goals screen be previewed again on this device.
export async function clearAnonymousProfileIntroSeen(): Promise<void> {
  await secureStorage.removeItem(ANONYMOUS_PROFILE_SEEN_KEY);
}
