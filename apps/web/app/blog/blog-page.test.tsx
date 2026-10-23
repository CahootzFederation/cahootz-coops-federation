import { pullRequestPosts } from "@/content/blog";
import { blogPosts as notionPosts } from "@/lib/blog.generated";
import { render, screen } from "@testing-library/react";

import BlogPostPage, {
  generateMetadata,
  generateStaticParams,
} from "./[slug]/page";
import BlogPage from "./page";

jest.mock("@/components/blog/comments", () => ({ BlogComments: () => null }));

test("the listing displays Sage and all Notion articles in submission order", () => {
  const { container } = render(<BlogPage />);
  const cards = container.querySelectorAll("main article");
  expect(cards).toHaveLength(notionPosts.length + pullRequestPosts.length);
  expect(screen.getByText("Written by Sage")).toBeInTheDocument();
  expect(screen.getAllByText("Written by Deon Robinson")).toHaveLength(
    notionPosts.filter((post) => post.author === "Deon Robinson").length,
  );
  const dates = [...container.querySelectorAll("main article time")].map((t) =>
    Date.parse(t.getAttribute("datetime") ?? ""),
  );
  expect(dates).toEqual([...dates].sort((a, b) => b - a));
});

test("the Sage permalink renders its credit, handbook table, image, and research links", async () => {
  const params = Promise.resolve({ slug: "cahootz-handbook" });
  render(await BlogPostPage({ params }));
  expect(screen.getByText("Written by Sage")).toBeInTheDocument();
  expect(screen.getByRole("table")).toBeInTheDocument();
  expect(
    screen.getByRole("img", { name: /Friends sharing coffee/ }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "moderation guide" }),
  ).toHaveAttribute(
    "href",
    "https://meta.discourse.org/t/discourse-moderation-guide-part-1-getting-started/63116",
  );
  expect(generateStaticParams()).toContainEqual({ slug: "cahootz-handbook" });
  expect((await generateMetadata({ params })).openGraph).toMatchObject({
    authors: ["Sage"],
  });
});
