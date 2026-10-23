import type { BlogListItem, BlogPost, BlogPostBlock } from "./blog";

export const SITE_URL = "https://cahootzcommons.com";
export const BLOG_FEED_PATH = "/blog/feed.xml";
export const BLOG_FEED_TITLE = "Cahootz Blog";
export const BLOG_FEED_DESCRIPTION =
  "Notes on building community-owned economies: commons governance, local commerce, and AI that works for its members.";

// Lets <head> point feed readers, Medium, and Substack at the feed.
export const blogFeedAlternates = {
  "application/rss+xml": [
    { url: `${SITE_URL}${BLOG_FEED_PATH}`, title: BLOG_FEED_TITLE },
  ],
};

export function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// "]]>" would end the CDATA section early, so split it across two sections.
function cdata(value: string) {
  return `<![CDATA[${value.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
}

function absoluteUrl(url: string) {
  return url.startsWith("http") ? url : `${SITE_URL}${url}`;
}

function listItemHtml(item: string | BlogListItem) {
  if (typeof item === "string") return `<li>${item}</li>`;
  return `<li>${item.text}${blocksToHtml(item.children ?? [])}</li>`;
}

// Block text is already sanitized HTML from the Notion sync; code and
// equations are plain text and get escaped.
function blockToHtml(block: BlogPostBlock): string {
  switch (block.type) {
    case "paragraph":
      return `<p>${block.text}</p>`;
    case "heading": {
      const tag = block.level === 3 ? "h4" : block.level === 1 ? "h2" : "h3";
      return `<${tag}>${block.text}</${tag}>`;
    }
    case "list": {
      const tag = block.ordered ? "ol" : "ul";
      return `<${tag}>${block.items.map(listItemHtml).join("")}</${tag}>`;
    }
    case "quote":
      return `<blockquote>${block.text}</blockquote>`;
    case "image": {
      const caption = block.caption
        ? `<figcaption>${escapeXml(block.caption)}</figcaption>`
        : "";
      return `<figure><img src="${escapeXml(absoluteUrl(block.url))}" alt="${escapeXml(block.alt)}" />${caption}</figure>`;
    }
    case "callout":
      return `<p>${block.icon ? `${block.icon} ` : ""}${block.text}</p>${blocksToHtml(block.children ?? [])}`;
    case "code":
      return `<pre><code>${escapeXml(block.text)}</code></pre>`;
    case "divider":
      return "<hr />";
    case "todo":
      return `<p>${block.checked ? "☑" : "☐"} ${block.text}</p>`;
    case "toggle":
      return `<p><strong>${block.text}</strong></p>${blocksToHtml(block.children)}`;
    case "table":
      return `<table>${block.rows
        .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`)
        .join("")}</table>`;
    case "columns":
      return block.columns.map(blocksToHtml).join("");
    case "equation":
      return `<pre><code>${escapeXml(block.expression)}</code></pre>`;
    case "bookmark":
    case "media": {
      const href = escapeXml(absoluteUrl(block.url));
      return `<p><a href="${href}">${block.caption ? escapeXml(block.caption) : href}</a></p>`;
    }
  }
}

export function blocksToHtml(blocks: BlogPostBlock[]) {
  return blocks.map(blockToHtml).join("");
}

export function postUrl(post: Pick<BlogPost, "slug">) {
  return `${SITE_URL}/blog/${post.slug}`;
}

function itemXml(post: BlogPost) {
  const link = postUrl(post);
  // Importers like Medium and Substack copy this body, so it ends with a
  // link back to the original post.
  const cover = `<figure><img src="${escapeXml(absoluteUrl(post.image))}" alt="${escapeXml(post.imageAlt)}" /></figure>`;
  const body = `${cover}${blocksToHtml(post.blocks)}<hr /><p>This post first appeared on the <a href="${link}">Cahootz blog</a>.</p>`;
  const categories = [post.category, ...post.tags]
    .filter(Boolean)
    .map((category) => `      <category>${escapeXml(category)}</category>`);

  return [
    "    <item>",
    `      <title>${escapeXml(post.title)}</title>`,
    `      <link>${escapeXml(link)}</link>`,
    `      <guid isPermaLink="true">${escapeXml(link)}</guid>`,
    `      <pubDate>${new Date(post.publishedAt).toUTCString()}</pubDate>`,
    `      <dc:creator>${escapeXml(post.author)}</dc:creator>`,
    ...categories,
    `      <description>${escapeXml(post.description)}</description>`,
    `      <content:encoded>${cdata(body)}</content:encoded>`,
    "    </item>",
  ].join("\n");
}

export function buildBlogFeed(posts: BlogPost[]) {
  const feedUrl = `${SITE_URL}${BLOG_FEED_PATH}`;
  const lastBuildDate = posts.length
    ? new Date(
        Math.max(
          ...posts.map((post) =>
            new Date(post.updatedAt ?? post.publishedAt).getTime(),
          ),
        ),
      ).toUTCString()
    : new Date(0).toUTCString();

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    "  <channel>",
    `    <title>${escapeXml(BLOG_FEED_TITLE)}</title>`,
    `    <link>${SITE_URL}/blog</link>`,
    `    <description>${escapeXml(BLOG_FEED_DESCRIPTION)}</description>`,
    "    <language>en-us</language>",
    `    <lastBuildDate>${lastBuildDate}</lastBuildDate>`,
    `    <atom:link href="${feedUrl}" rel="self" type="application/rss+xml" />`,
    ...posts.map(itemXml),
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}
