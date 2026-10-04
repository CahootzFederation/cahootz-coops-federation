import { render, screen, within } from "@testing-library/react";

import { BlogBlock } from "./page";

jest.mock("@/components/blog/comments", () => ({
  BlogComments: () => null,
}));

describe("BlogBlock", () => {
  it("renders heading hierarchy and nested ordered and unordered lists", () => {
    const { container } = render(
      <>
        <BlogBlock block={{ type: "heading", level: 1, text: "Section" }} />
        <BlogBlock
          block={{
            type: "list",
            ordered: false,
            items: [
              {
                text: "Bullet",
                children: [
                  {
                    type: "list",
                    ordered: true,
                    items: [{ text: "Nested step" }],
                  },
                ],
              },
            ],
          }}
        />
      </>,
    );

    expect(
      screen.getByRole("heading", { level: 2, name: "Section" }),
    ).toBeInTheDocument();
    expect(container.querySelectorAll("ul")).toHaveLength(1);
    expect(container.querySelectorAll("ol")).toHaveLength(1);
    expect(screen.getByText("Nested step")).toBeInTheDocument();
  });

  it("renders tables, code, toggles, checklists, callouts, and dividers", () => {
    const { container } = render(
      <>
        <BlogBlock
          block={{
            type: "table",
            rows: [
              ["Name", "Value"],
              ["Members", "42"],
            ],
            hasColumnHeader: true,
            hasRowHeader: false,
          }}
        />
        <BlogBlock
          block={{
            type: "code",
            language: "typescript",
            text: "const total = 2;",
          }}
        />
        <BlogBlock
          block={{
            type: "toggle",
            text: "More details",
            children: [{ type: "paragraph", text: "Hidden content" }],
          }}
        />
        <BlogBlock block={{ type: "todo", text: "Complete", checked: true }} />
        <BlogBlock
          block={{
            type: "callout",
            text: "Important",
            icon: "💡",
            color: "yellow_background",
          }}
        />
        <BlogBlock block={{ type: "divider" }} />
      </>,
    );

    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader")).toHaveLength(2);
    expect(screen.getByText("const total = 2;")).toBeInTheDocument();
    expect(container.querySelector("details")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Completed" })).toBeChecked();
    expect(screen.getByText("Important")).toBeInTheDocument();
    expect(container.querySelector("hr")).toBeInTheDocument();
  });
});
