import { getBlogPost, getPublishedBlogPosts } from "./blog";
import { blogPosts as notionBlogPosts } from "./blog.generated";
import { manualBlogPosts } from "./blog.manual";

describe("blog posts", () => {
  it("lists hand-written posts alongside the Notion snapshot", () => {
    const slugs = getPublishedBlogPosts().map((post) => post.slug);

    for (const post of [...notionBlogPosts, ...manualBlogPosts]) {
      expect(slugs).toContain(post.slug);
    }
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("finds a hand-written post by slug", () => {
    const post = getBlogPost("your-next-customers-could-be-your-community");

    expect(post?.title).toMatch(/The Case for Demand Co-ops/);
  });

  it("sorts newest first", () => {
    const dates = getPublishedBlogPosts().map((post) =>
      new Date(post.publishedAt).getTime(),
    );

    expect(dates).toEqual([...dates].sort((a, b) => b - a));
  });
});
