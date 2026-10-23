import type { BlogPost } from "./blog";

/** Combine independent stores. A collision fails visibly instead of replacing content. */
export function combineBlogPosts(
  notionPosts: readonly BlogPost[],
  pullRequestPosts: readonly BlogPost[],
): BlogPost[] {
  const slugs = new Set<string>();
  const posts = [
    ...notionPosts.map((post) => ({ ...post, source: "notion" as const })),
    ...pullRequestPosts.map((post) => ({ ...post, source: "pr" as const })),
  ].map((post) => {
    if (slugs.has(post.slug)) {
      throw new Error(
        `Duplicate blog slug "${post.slug}". Choose a unique slug; no article may replace another.`,
      );
    }
    slugs.add(post.slug);
    const submittedAt = post.submittedAt ?? post.publishedAt;
    if (!Number.isFinite(Date.parse(submittedAt))) {
      throw new Error(`Invalid submission date for blog post "${post.slug}".`);
    }
    return { ...post, submittedAt };
  });
  return posts.sort(
    (a, b) =>
      Date.parse(b.submittedAt) - Date.parse(a.submittedAt) ||
      a.slug.localeCompare(b.slug),
  );
}
