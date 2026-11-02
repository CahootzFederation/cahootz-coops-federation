import { getPublishedBlogPosts } from "@/lib/blog";
import { buildBlogFeed } from "@/lib/blog-feed";

// Posts are synced from Notion at build time, so the feed can be static too.
export const dynamic = "force-static";

/**
 * RSS feed for the blog
 * @route GET /blog/feed.xml
 */
export function GET() {
  return new Response(buildBlogFeed(getPublishedBlogPosts()), {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
