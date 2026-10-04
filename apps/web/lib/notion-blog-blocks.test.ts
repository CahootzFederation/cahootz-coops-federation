import type { NotionBlock, ResolvedImage } from "./notion-blog-blocks";
import { notionBlocksToBlogBlocks, richTextToHtml } from "./notion-blog-blocks";

const resolveImage = ({ url }: ResolvedImage) => Promise.resolve(url);
const richText = (plainText: string) => [{ plain_text: plainText }];

describe("Notion blog block conversion", () => {
  it("preserves inline formatting, colors, safe links, and soft line breaks", () => {
    expect(
      richTextToHtml([
        {
          plain_text: "First\nSecond",
          annotations: { bold: true, color: "yellow_background" },
          text: { link: { url: "https://cahootz.coop/read" } },
        },
      ]),
    ).toBe(
      '<a href="https://cahootz.coop/read" target="_blank" rel="noopener noreferrer"><span style="background-color:rgba(250,204,21,.2)"><strong>First<br />Second</strong></span></a>',
    );

    expect(
      richTextToHtml([
        {
          plain_text: "Unsafe",
          text: { link: { url: "javascript:alert(1)" } },
        },
      ]),
    ).toBe("Unsafe");
  });

  it("keeps heading levels and separates ordered, unordered, and nested lists", async () => {
    const blocks: NotionBlock[] = [
      {
        id: "heading",
        type: "heading_1",
        heading_1: { rich_text: richText("Primary section"), color: "blue" },
      },
      {
        id: "bullet-one",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: richText("First bullet") },
        children: [
          {
            id: "nested-number",
            type: "numbered_list_item",
            numbered_list_item: { rich_text: richText("Nested step") },
          },
        ],
      },
      {
        id: "bullet-two",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: richText("Second bullet") },
      },
      {
        id: "number-one",
        type: "numbered_list_item",
        numbered_list_item: { rich_text: richText("First step") },
      },
    ];

    await expect(
      notionBlocksToBlogBlocks(blocks, resolveImage),
    ).resolves.toEqual([
      {
        type: "heading",
        level: 1,
        text: "Primary section",
        color: "blue",
      },
      {
        type: "list",
        ordered: false,
        items: [
          {
            text: "First bullet",
            children: [
              {
                type: "list",
                ordered: true,
                items: [{ text: "Nested step" }],
              },
            ],
          },
          { text: "Second bullet" },
        ],
      },
      {
        type: "list",
        ordered: true,
        items: [{ text: "First step" }],
      },
    ]);
  });

  it("converts common structural blocks without discarding their content", async () => {
    const blocks: NotionBlock[] = [
      {
        id: "callout",
        type: "callout",
        callout: {
          rich_text: richText("Remember this"),
          icon: { type: "emoji", emoji: "💡" },
          color: "yellow_background",
        },
      },
      {
        id: "code",
        type: "code",
        code: {
          rich_text: richText("  const total = 2;\n"),
          language: "typescript",
          caption: richText("Example"),
        },
      },
      { id: "divider", type: "divider" },
      {
        id: "todo",
        type: "to_do",
        to_do: { rich_text: richText("Ship it"), checked: true },
      },
      {
        id: "toggle",
        type: "toggle",
        toggle: { rich_text: richText("More details") },
        children: [
          {
            id: "toggle-child",
            type: "paragraph",
            paragraph: { rich_text: richText("Hidden detail") },
          },
        ],
      },
      {
        id: "table",
        type: "table",
        table: { has_column_header: true, has_row_header: false },
        children: [
          {
            id: "row-one",
            type: "table_row",
            table_row: { cells: [richText("Name"), richText("Value")] },
          },
          {
            id: "row-two",
            type: "table_row",
            table_row: { cells: [richText("Members"), richText("42")] },
          },
        ],
      },
      {
        id: "unsupported-container",
        type: "synced_block",
        children: [
          {
            id: "preserved-child",
            type: "paragraph",
            paragraph: { rich_text: richText("Still visible") },
          },
        ],
      },
    ];

    const converted = await notionBlocksToBlogBlocks(blocks, resolveImage);

    expect(converted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "callout",
          text: "Remember this",
          icon: "💡",
          color: "yellow_background",
        }),
        {
          type: "code",
          text: "  const total = 2;\n",
          language: "typescript",
          caption: "Example",
        },
        { type: "divider" },
        { type: "todo", text: "Ship it", checked: true },
        {
          type: "toggle",
          text: "More details",
          children: [{ type: "paragraph", text: "Hidden detail" }],
        },
        {
          type: "table",
          rows: [
            ["Name", "Value"],
            ["Members", "42"],
          ],
          hasColumnHeader: true,
          hasRowHeader: false,
        },
        { type: "paragraph", text: "Still visible" },
      ]),
    );
  });
});
