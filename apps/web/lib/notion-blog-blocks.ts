import type { BlogColor, BlogListItem, BlogPostBlock } from "./blog";

export interface NotionRichText {
  plain_text?: string;
  href?: string | null;
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    strikethrough?: boolean;
    underline?: boolean;
    code?: boolean;
    color?: BlogColor;
  };
  text?: {
    link?: { url?: string } | null;
  };
}

interface RichTextBlock {
  rich_text?: NotionRichText[];
  color?: BlogColor;
}

interface NotionFileSource {
  type?: string;
  file?: { url?: string };
  external?: { url?: string };
  caption?: NotionRichText[];
}

export interface NotionBlock {
  id: string;
  type: string;
  has_children?: boolean;
  children?: NotionBlock[];
  paragraph?: RichTextBlock;
  heading_1?: RichTextBlock;
  heading_2?: RichTextBlock;
  heading_3?: RichTextBlock;
  quote?: RichTextBlock;
  bulleted_list_item?: RichTextBlock;
  numbered_list_item?: RichTextBlock;
  to_do?: RichTextBlock & { checked?: boolean };
  toggle?: RichTextBlock;
  callout?: RichTextBlock & {
    icon?: { type?: string; emoji?: string };
  };
  code?: RichTextBlock & {
    language?: string;
    caption?: NotionRichText[];
  };
  image?: {
    type?: string;
    file?: { url?: string };
    external?: { url?: string };
    caption?: NotionRichText[];
  };
  table?: {
    has_column_header?: boolean;
    has_row_header?: boolean;
  };
  table_row?: {
    cells?: NotionRichText[][];
  };
  equation?: { expression?: string };
  bookmark?: { url?: string; caption?: NotionRichText[] };
  link_preview?: { url?: string };
  embed?: { url?: string };
  audio?: NotionFileSource;
  video?: NotionFileSource;
  file?: NotionFileSource;
  pdf?: NotionFileSource;
}

export interface ResolvedImage {
  url: string;
  hosted: boolean;
}

export type ResolveNotionImage = (image: ResolvedImage) => Promise<string>;

export function plainText(richText?: NotionRichText[]): string {
  return (
    richText
      ?.map((text) => text.plain_text ?? "")
      .join("")
      .trim() ?? ""
  );
}

function rawText(richText?: NotionRichText[]): string {
  return richText?.map((text) => text.plain_text ?? "").join("") ?? "";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const RICH_TEXT_COLOR_STYLES: Partial<Record<BlogColor, string>> = {
  gray: "color:#94a3b8",
  brown: "color:#d6a77a",
  orange: "color:#fb923c",
  yellow: "color:#facc15",
  green: "color:#4ade80",
  blue: "color:#60a5fa",
  purple: "color:#c084fc",
  pink: "color:#f472b6",
  red: "color:#f87171",
  gray_background: "background-color:rgba(148,163,184,.2)",
  brown_background: "background-color:rgba(180,120,70,.24)",
  orange_background: "background-color:rgba(251,146,60,.2)",
  yellow_background: "background-color:rgba(250,204,21,.2)",
  green_background: "background-color:rgba(74,222,128,.2)",
  blue_background: "background-color:rgba(96,165,250,.2)",
  purple_background: "background-color:rgba(192,132,252,.2)",
  pink_background: "background-color:rgba(244,114,182,.2)",
  red_background: "background-color:rgba(248,113,113,.2)",
};

export function safeUrl(value?: string | null): string | undefined {
  if (!value) return undefined;

  try {
    const url = new URL(value);
    if (!["http:", "https:", "mailto:"].includes(url.protocol))
      return undefined;
    return value;
  } catch {
    return undefined;
  }
}

export function richTextToHtml(richText?: NotionRichText[]): string {
  if (!richText || richText.length === 0) return "";

  return richText
    .map((segment) => {
      let content = escapeHtml(segment.plain_text ?? "").replace(
        /\n/g,
        "<br />",
      );
      const annotations = segment.annotations;

      if (annotations?.code)
        content = `<code class="notion-code">${content}</code>`;
      if (annotations?.bold) content = `<strong>${content}</strong>`;
      if (annotations?.italic) content = `<em>${content}</em>`;
      if (annotations?.strikethrough) content = `<s>${content}</s>`;
      if (annotations?.underline) content = `<u>${content}</u>`;
      const colorStyle = annotations?.color
        ? RICH_TEXT_COLOR_STYLES[annotations.color]
        : undefined;
      if (colorStyle) content = `<span style="${colorStyle}">${content}</span>`;

      const link = safeUrl(segment.text?.link?.url ?? segment.href);
      return link
        ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${content}</a>`
        : content;
    })
    .join("");
}

async function listItem(
  block: NotionBlock,
  resolveImage: ResolveNotionImage,
): Promise<BlogListItem> {
  const source =
    block.type === "numbered_list_item"
      ? block.numbered_list_item
      : block.bulleted_list_item;
  const children = await notionBlocksToBlogBlocks(
    block.children ?? [],
    resolveImage,
  );

  return {
    text: richTextToHtml(source?.rich_text),
    ...(children.length > 0 ? { children } : {}),
    ...(source?.color ? { color: source.color } : {}),
  };
}

export async function notionBlocksToBlogBlocks(
  blocks: NotionBlock[],
  resolveImage: ResolveNotionImage,
): Promise<BlogPostBlock[]> {
  const output: BlogPostBlock[] = [];

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!block) continue;

    if (
      block.type === "bulleted_list_item" ||
      block.type === "numbered_list_item"
    ) {
      const ordered = block.type === "numbered_list_item";
      const items: BlogListItem[] = [];

      while (index < blocks.length) {
        const candidate = blocks[index];
        if (!candidate) break;
        const candidateOrdered = candidate.type === "numbered_list_item";
        if (
          candidate.type !== "bulleted_list_item" &&
          candidate.type !== "numbered_list_item"
        ) {
          break;
        }
        if (candidateOrdered !== ordered) break;
        items.push(await listItem(candidate, resolveImage));
        index += 1;
      }

      output.push({ type: "list", ordered, items });
      index -= 1;
      continue;
    }

    switch (block.type) {
      case "paragraph": {
        const text = richTextToHtml(block.paragraph?.rich_text);
        if (text)
          output.push({
            type: "paragraph",
            text,
            ...(block.paragraph?.color ? { color: block.paragraph.color } : {}),
          });
        break;
      }
      case "heading_1":
      case "heading_2":
      case "heading_3": {
        const level = Number(block.type.at(-1)) as 1 | 2 | 3;
        const heading =
          level === 1
            ? block.heading_1
            : level === 2
              ? block.heading_2
              : block.heading_3;
        output.push({
          type: "heading",
          level,
          text: richTextToHtml(heading?.rich_text),
          ...(heading?.color ? { color: heading.color } : {}),
        });
        break;
      }
      case "quote": {
        const text = richTextToHtml(block.quote?.rich_text);
        if (text)
          output.push({
            type: "quote",
            text,
            ...(block.quote?.color ? { color: block.quote.color } : {}),
          });
        break;
      }
      case "image": {
        const rawUrl =
          block.image?.external?.url ?? block.image?.file?.url ?? "";
        if (!rawUrl) break;
        const url = await resolveImage({
          url: rawUrl,
          hosted:
            block.image?.type !== "external" && Boolean(block.image?.file?.url),
        });
        const caption = plainText(block.image?.caption);
        output.push({
          type: "image",
          url,
          alt: caption || "Blog post image.",
          ...(caption ? { caption } : {}),
        });
        break;
      }
      case "callout": {
        const text = richTextToHtml(block.callout?.rich_text);
        const children = await notionBlocksToBlogBlocks(
          block.children ?? [],
          resolveImage,
        );
        if (text || children.length > 0) {
          output.push({
            type: "callout",
            text,
            ...(block.callout?.icon?.type === "emoji" &&
            block.callout.icon.emoji
              ? { icon: block.callout.icon.emoji }
              : {}),
            ...(children.length > 0 ? { children } : {}),
            ...(block.callout?.color ? { color: block.callout.color } : {}),
          });
        }
        break;
      }
      case "code":
        output.push({
          type: "code",
          text: rawText(block.code?.rich_text),
          ...(block.code?.language ? { language: block.code.language } : {}),
          ...(plainText(block.code?.caption)
            ? { caption: plainText(block.code?.caption) }
            : {}),
        });
        break;
      case "divider":
        output.push({ type: "divider" });
        break;
      case "to_do":
        output.push({
          type: "todo",
          text: richTextToHtml(block.to_do?.rich_text),
          checked: block.to_do?.checked ?? false,
          ...(block.to_do?.color ? { color: block.to_do.color } : {}),
        });
        break;
      case "toggle":
        output.push({
          type: "toggle",
          text: richTextToHtml(block.toggle?.rich_text),
          children: await notionBlocksToBlogBlocks(
            block.children ?? [],
            resolveImage,
          ),
          ...(block.toggle?.color ? { color: block.toggle.color } : {}),
        });
        break;
      case "table": {
        const rows = (block.children ?? [])
          .filter((child) => child.type === "table_row")
          .map((child) =>
            (child.table_row?.cells ?? []).map((cell) => richTextToHtml(cell)),
          );
        if (rows.length > 0) {
          output.push({
            type: "table",
            rows,
            hasColumnHeader: block.table?.has_column_header ?? false,
            hasRowHeader: block.table?.has_row_header ?? false,
          });
        }
        break;
      }
      case "column_list": {
        const columns = await Promise.all(
          (block.children ?? [])
            .filter((child) => child.type === "column")
            .map((column) =>
              notionBlocksToBlogBlocks(column.children ?? [], resolveImage),
            ),
        );
        if (columns.length > 0) output.push({ type: "columns", columns });
        break;
      }
      case "equation":
        if (block.equation?.expression) {
          output.push({
            type: "equation",
            expression: block.equation.expression,
          });
        }
        break;
      case "bookmark":
      case "link_preview":
      case "embed": {
        const url =
          block.type === "bookmark"
            ? block.bookmark?.url
            : block.type === "link_preview"
              ? block.link_preview?.url
              : block.embed?.url;
        const safeBookmarkUrl = safeUrl(url);
        if (safeBookmarkUrl) {
          output.push({
            type: "bookmark",
            url: safeBookmarkUrl,
            ...(block.type === "bookmark" && plainText(block.bookmark?.caption)
              ? { caption: plainText(block.bookmark?.caption) }
              : {}),
          });
        }
        break;
      }
      case "audio":
      case "video":
      case "file":
      case "pdf": {
        const source = block[block.type];
        const rawUrl = source?.external?.url ?? source?.file?.url;
        const safeMediaUrl = safeUrl(rawUrl);
        if (safeMediaUrl) {
          const url = await resolveImage({
            url: safeMediaUrl,
            hosted: source?.type !== "external" && Boolean(source?.file?.url),
          });
          output.push({
            type: "media",
            mediaType: block.type,
            url,
            external: source?.type === "external",
            ...(plainText(source?.caption)
              ? { caption: plainText(source?.caption) }
              : {}),
          });
        }
        break;
      }
      default:
        break;
    }

    if (
      block.children?.length &&
      !["callout", "toggle", "table", "column_list", "column"].includes(
        block.type,
      )
    ) {
      output.push(
        ...(await notionBlocksToBlogBlocks(block.children, resolveImage)),
      );
    }
  }

  return output;
}
