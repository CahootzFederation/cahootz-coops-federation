import { expect, test } from "@playwright/test";

// Public marketing site, not Expo; opt in so normal mobile runs need no web server.
const blogBase = process.env.E2E_BLOG_BASE_URL;
test.skip(!blogBase, "Set E2E_BLOG_BASE_URL to the local marketing site");

test("read Sage and Notion articles together in submission order", async ({ page }) => {
  await page.goto(`${blogBase}/blog`);
  const cards = page.locator("main article");
  const sageCard = cards.filter({ has: page.getByRole("link", { name: "The Cahootz Handbook: A Place for Everyday Life", exact: true }) });
  const notionCard = cards.filter({ has: page.getByRole("link", { name: "AI can run an organization; its members must decide who the organization is for.", exact: true }) });
  await expect(sageCard).toContainText("Written by Sage");
  await expect(notionCard).toContainText("Written by Deon Robinson");
  const dates = await cards.locator("time").evaluateAll(nodes =>
    nodes.map(node => Date.parse(node.getAttribute("datetime") ?? "")),
  );
  expect(dates).toEqual([...dates].sort((a, b) => b - a));
  await sageCard.getByRole("link", { name: "Read post" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "The Cahootz Handbook: A Place for Everyday Life",
  );
  await expect(page.getByText("Written by Sage", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Keep the atmosphere friendly without making it a job" })).toBeVisible();
  await expect(page.getByRole("link", { name: "moderation guide", exact: true })).toHaveAttribute(
    "href", "https://meta.discourse.org/t/discourse-moderation-guide-part-1-getting-started/63116",
  );
  const hero = page.getByRole("img", { name: /Friends sharing coffee/ });
  await expect(hero).toBeVisible();
  await expect.poll(() => hero.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await page.reload();
  await expect(page.getByText("Written by Sage", { exact: true })).toBeVisible();
  await page.locator("main").getByRole("link", { name: "Blog", exact: true }).click();
  await notionCard.getByRole("link", { name: "Read post" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("AI can run an organization");
  await expect(page.getByText("Written by Deon Robinson", { exact: true })).toBeVisible();
});
