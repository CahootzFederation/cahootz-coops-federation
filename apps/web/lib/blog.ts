import { blogPosts } from "./blog.generated";

export interface BlogListItem {
  text: string;
  children?: BlogPostBlock[];
  color?: BlogColor;
}

export type BlogColor =
  | "default"
  | "gray"
  | "brown"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "purple"
  | "pink"
  | "red"
  | "gray_background"
  | "brown_background"
  | "orange_background"
  | "yellow_background"
  | "green_background"
  | "blue_background"
  | "purple_background"
  | "pink_background"
  | "red_background";

export type BlogPostBlock =
  | {
      type: "paragraph";
      text: string;
      color?: BlogColor;
    }
  | {
      type: "heading";
      text: string;
      level?: 1 | 2 | 3;
      color?: BlogColor;
    }
  | {
      type: "list";
      ordered?: boolean;
      items: (string | BlogListItem)[];
      color?: BlogColor;
    }
  | {
      type: "quote";
      text: string;
      color?: BlogColor;
    }
  | {
      type: "image";
      url: string;
      alt: string;
      caption?: string;
    }
  | {
      type: "callout";
      text: string;
      icon?: string;
      children?: BlogPostBlock[];
      color?: BlogColor;
    }
  | {
      type: "code";
      text: string;
      language?: string;
      caption?: string;
    }
  | {
      type: "divider";
    }
  | {
      type: "todo";
      text: string;
      checked: boolean;
      color?: BlogColor;
    }
  | {
      type: "toggle";
      text: string;
      children: BlogPostBlock[];
      color?: BlogColor;
    }
  | {
      type: "table";
      rows: string[][];
      hasColumnHeader: boolean;
      hasRowHeader: boolean;
    }
  | {
      type: "columns";
      columns: BlogPostBlock[][];
    }
  | {
      type: "equation";
      expression: string;
    }
  | {
      type: "bookmark";
      url: string;
      caption?: string;
    }
  | {
      type: "media";
      mediaType: "audio" | "video" | "file" | "pdf";
      url: string;
      caption?: string;
      external?: boolean;
    };

export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  excerpt: string;
  publishedAt: string;
  updatedAt?: string;
  author: string;
  category: string;
  readingTime: string;
  image: string;
  imageAlt: string;
  featured?: boolean;
  tags: string[];
  blocks: BlogPostBlock[];
}

export function blocksFromNotionPaste(markdown: string): BlogPostBlock[] {
  const blocks: BlogPostBlock[] = [];
  const lines = markdown.trim().split(/\r?\n/);

  let paragraph: string[] = [];
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: "paragraph", text: paragraph.join(" ") });
      paragraph = [];
    }
  };

  const flushList = () => {
    if (listItems.length > 0) {
      blocks.push({ type: "list", items: listItems });
      listItems = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    if (line.startsWith("#")) {
      flushParagraph();
      flushList();
      const depth = /^#+/.exec(line)?.[0].length ?? 2;
      const level = Math.min(3, depth) as 1 | 2 | 3;
      blocks.push({
        type: "heading",
        level,
        text: line.replace(/^#+\s*/, ""),
      });
      continue;
    }

    if (line.startsWith(">")) {
      flushParagraph();
      flushList();
      blocks.push({ type: "quote", text: line.replace(/^>\s*/, "") });
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      flushParagraph();
      listItems.push(line.replace(/^[-*]\s+/, ""));
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();

  return blocks;
}

export function getPublishedBlogPosts() {
  return [...blogPosts].sort(
    (a, b) =>
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );
}

export function getFeaturedBlogPosts(limit = 3) {
  const posts = getPublishedBlogPosts();
  const featured = posts.filter((post) => post.featured);
  const rest = posts.filter((post) => !post.featured);

  return [...featured, ...rest].slice(0, limit);
}

export function getBlogPost(slug: string) {
  return blogPosts.find((post) => post.slug === slug);
}

export function formatPostDate(date: string) {
  return new Intl.DateTimeFormat("en", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(date));
}
