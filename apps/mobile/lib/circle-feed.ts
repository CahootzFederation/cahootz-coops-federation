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
  });
}
