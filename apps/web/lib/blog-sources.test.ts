import type { BlogPost } from "./blog";
import { cahootzHandbook } from "../content/blog/cahootz-handbook";
import { getBlogPost, getPublishedBlogPosts } from "./blog";
import { combineBlogPosts } from "./blog-sources";

const post = (slug: string, submittedAt?: string): BlogPost => ({
  ...cahootzHandbook,
  slug,
  submittedAt,
});

test("interleaves both sources by submission time, not publication or update time", () => {
  const notion = [
    { ...post("old", "2026-10-01T00:00:00Z"), updatedAt: "2026-11-01" },
    post("new", "2026-10-23T11:00:00Z"),
  ];
  const editorial = [
    { ...post("pr", "2026-10-23T10:00:00Z"), publishedAt: "2025-01-01" },
  ];
  expect(
    combineBlogPosts(notion, editorial).map((p) => [p.slug, p.source]),
  ).toEqual([
    ["new", "notion"],
    ["pr", "pr"],
    ["old", "notion"],
  ]);
  expect(notion[0]?.slug).toBe("old");
});

test("replacing or emptying the Notion snapshot preserves editorial content", () => {
  for (const snapshot of [[post("first")], [post("replacement")], []]) {
    const result = combineBlogPosts(snapshot, [cahootzHandbook]);
    expect(result.find((p) => p.slug === cahootzHandbook.slug)).toEqual(
      cahootzHandbook,
    );
  }
});

test("slug collisions in either store fail instead of silently replacing an article", () => {
  expect(() => combineBlogPosts([post("same")], [post("same")])).toThrow(
    "Duplicate blog slug",
  );
  expect(() => combineBlogPosts([post("same"), post("same")], [])).toThrow(
    "Duplicate blog slug",
  );
  expect(() => combineBlogPosts([], [post("same"), post("same")])).toThrow(
    "Duplicate blog slug",
  );
});

test("legacy dates are stable, ties are deterministic, and invalid dates fail", () => {
  expect(
    combineBlogPosts([post("z"), post("a")], []).map((p) => p.slug),
  ).toEqual(["a", "z"]);
  expect(combineBlogPosts([post("legacy")], [])[0]?.submittedAt).toBe(
    "2026-10-23",
  );
  expect(() => combineBlogPosts([post("bad", "invalid")], [])).toThrow(
    "Invalid submission date",
  );
});

test("the public listing and permalink expose Sage alongside the current Notion articles", () => {
  expect(getBlogPost("cahootz-handbook")?.author).toBe("Sage");
  expect(getPublishedBlogPosts().some((p) => p.source === "notion")).toBe(true);
  expect(getPublishedBlogPosts().some((p) => p.source === "pr")).toBe(true);
  expect(getBlogPost("missing")).toBeUndefined();
});
