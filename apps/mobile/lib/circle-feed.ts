import type { CommonsPost } from './api';

export function postsForCircle(
  posts: CommonsPost[],
  coopId: string,
  circleId?: string,
): CommonsPost[] {
  const generalId = `general:${coopId}`;
  return posts.filter((post) => {
    if (post.coopId !== coopId) return false;
    if (circleId && circleId !== generalId) return post.circleId === circleId;
    return !post.circleId || post.circleId === generalId;
  });
}

export function mergeFeedPosts(
  first: CommonsPost[],
  second: CommonsPost[],
): CommonsPost[] {
  const seen = new Set<string>();
  return [...first, ...second].filter((post) => {
    if (seen.has(post.id)) return false;
    seen.add(post.id);
    return true;
  }).sort((a, b) => {
    const aTime = a.createdAt ? Date.parse(a.createdAt) : NaN;
    const bTime = b.createdAt ? Date.parse(b.createdAt) : NaN;
    if (!Number.isFinite(aTime)) return Number.isFinite(bTime) ? 1 : 0;
    if (!Number.isFinite(bTime)) return -1;
    return bTime - aTime || b.id.localeCompare(a.id);
  });
}
