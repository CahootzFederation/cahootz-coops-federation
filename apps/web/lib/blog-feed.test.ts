import type { BlogPost } from "./blog";
import { getPublishedBlogPosts } from "./blog";
import { blocksToHtml, buildBlogFeed, escapeXml } from "./blog-feed";

const post = (overrides: Partial<BlogPost> = {}): BlogPost => ({
  slug: "turn-spending-into-ownership",
  title: "Spending & Ownership <Part 1>",
  description: "What \"ownership\" means for a co-op.",
  excerpt: "",
  publishedAt: "2026-06-05T00:00:00.000Z",
  author: "Deon Robinson",
  category: "Business",
  readingTime: "3 min read",
  image: "/blog/cover.webp",
  imageAlt: "A cover",
  tags: ["co-ops"],
  blocks: [
    { type: "heading", level: 2, text: "Why it matters" },
    { type: "paragraph", text: "Pool <strong>resources</strong>." },
    { type: "list", items: ["One", { text: "Two", children: [{ type: "paragraph", text: "Nested" }] }] },
    { type: "code", text: "if (a < b) {}" },
    { type: "image", url: "/blog/body.png", alt: "Body", caption: "A & B" },
  ],
  ...overrides,
});

const parse = (xml: string) =>
  new DOMParser().parseFromString(xml, "application/xml");

describe("blog RSS feed", () => {
  it("builds a well-formed RSS 2.0 feed with one item per post", () => {
    const xml = buildBlogFeed([
      post(),
      post({ slug: "second", title: "Second", publishedAt: "2026-05-19T00:00:00.000Z" }),
    ]);
    const doc = parse(xml);

    expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
    expect(doc.documentElement.getAttribute("version")).toBe("2.0");
    expect(doc.querySelector("channel > title")?.textContent).toBe("Cahootz Blog");

    const items = doc.getElementsByTagName("item");
    expect(items).toHaveLength(2);
    const first = items[0];
    expect(first?.getElementsByTagName("title")[0]?.textContent).toBe(
      "Spending & Ownership <Part 1>",
    );
    expect(first?.getElementsByTagName("link")[0]?.textContent).toBe(
      "https://cahootzcommons.com/blog/turn-spending-into-ownership",
    );
    expect(first?.getElementsByTagName("pubDate")[0]?.textContent).toBe(
      "Fri, 05 Jun 2026 00:00:00 GMT",
    );
    expect(xml).toContain("<lastBuildDate>Fri, 05 Jun 2026 00:00:00 GMT</lastBuildDate>");
  });

  it("puts the full post in content:encoded with absolute images and a link back", () => {
    const doc = parse(buildBlogFeed([post()]));
    const content = doc.getElementsByTagName("content:encoded")[0]?.textContent ?? "";

    expect(content).toContain('<img src="https://cahootzcommons.com/blog/cover.webp" alt="A cover" />');
    expect(content).toContain("<h3>Why it matters</h3>");
    expect(content).toContain("<p>Pool <strong>resources</strong>.</p>");
    expect(content).toContain("<li>Two<p>Nested</p></li>");
    expect(content).toContain("<code>if (a &lt; b) {}</code>");
    expect(content).toContain('src="https://cahootzcommons.com/blog/body.png"');
    expect(content).toContain(
      'first appeared on the <a href="https://cahootzcommons.com/blog/turn-spending-into-ownership">Cahootz blog</a>',
    );
  });

  it("keeps a CDATA terminator inside post HTML from breaking the feed", () => {
    const xml = buildBlogFeed([
      post({ blocks: [{ type: "paragraph", text: "Tricky ]]> text" }] }),
    ]);
    const doc = parse(xml);

    expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
    expect(doc.getElementsByTagName("content:encoded")[0]?.textContent).toContain(
      "<p>Tricky ]]> text</p>",
    );
  });

  it("escapes XML special characters", () => {
    expect(escapeXml(`a & b < c > "d" 'e'`)).toBe(
      "a &amp; b &lt; c &gt; &quot;d&quot; &apos;e&apos;",
    );
    expect(blocksToHtml([{ type: "divider" }])).toBe("<hr />");
  });

  it("renders every published post into a valid feed", () => {
    const posts = getPublishedBlogPosts();
    const doc = parse(buildBlogFeed(posts));

    expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
    expect(doc.getElementsByTagName("item")).toHaveLength(posts.length);
  });
});
