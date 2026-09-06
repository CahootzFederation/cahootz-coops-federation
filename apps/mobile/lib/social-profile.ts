import type { CommonsPost } from '@/lib/api';

export function personHandleFromName(name?: string | null) {
  const handle = (name || 'member').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return handle || 'member';
}

export function personDisplayHandle(name?: string | null) {
  return `@${personHandleFromName(name)}`;
}

export function personInitials(name?: string | null) {
  const parts = (name || 'Member')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const initials = parts.slice(0, 2).map((part) => part.slice(0, 1).toUpperCase()).join('');
  return initials || 'M';
}

export function postBelongsToHandle(post: CommonsPost, handle: string) {
  return (post.authorHandle || personHandleFromName(post.author)) === handle;
}
