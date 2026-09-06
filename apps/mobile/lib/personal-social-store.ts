import AsyncStorage from '@react-native-async-storage/async-storage';

export type PersonalSpace = {
  id: string;
  name: string;
  purpose: string;
  privacy: 'private' | 'invite-only';
  createdAt: string;
};

export type FollowTarget = {
  id: string;
  label: string;
  type: 'person' | 'commons' | 'business' | 'project' | 'topic';
  createdAt: string;
};

function userKey(email?: string | null) {
  return (email || 'anonymous').trim().toLowerCase();
}

function storageKey(email: string | null | undefined, segment: string) {
  return `cahootz.${userKey(email)}.${segment}`;
}

async function readList<T>(key: string): Promise<T[]> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeList<T>(key: string, value: T[]) {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function listPersonalSpaces(email?: string | null) {
  return readList<PersonalSpace>(storageKey(email, 'spaces'));
}

export async function addPersonalSpace(email: string | null | undefined, name: string, purpose: string) {
  const key = storageKey(email, 'spaces');
  const current = await readList<PersonalSpace>(key);
  const space: PersonalSpace = {
    id: createId('space'),
    name,
    purpose,
    privacy: 'invite-only',
    createdAt: new Date().toISOString(),
  };
  const next = [space, ...current];
  await writeList(key, next);
  return next;
}

export async function listFollowTargets(email?: string | null) {
  return readList<FollowTarget>(storageKey(email, 'follows'));
}

export async function toggleFollowTarget(
  email: string | null | undefined,
  target: Omit<FollowTarget, 'createdAt'>,
  viewerPersonId?: string | null
) {
  if (target.type === 'person' && viewerPersonId && target.id === viewerPersonId) {
    return listFollowTargets(email);
  }

  const key = storageKey(email, 'follows');
  const current = await readList<FollowTarget>(key);
  const exists = current.some((item) => item.id === target.id && item.type === target.type);
  const next = exists
    ? current.filter((item) => item.id !== target.id || item.type !== target.type)
    : [{ ...target, createdAt: new Date().toISOString() }, ...current];
  await writeList(key, next);
  return next;
}
