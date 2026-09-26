import { expect, test } from "@playwright/test";
import { newSignedInPage } from "./support/auth";

const USER_EMAIL =
  process.env.E2E_USER_A_EMAIL || "releaseclick1@test.cahootz.local";

test("a member reaches the commons info page from the drawer's info button and can switch its tabs", async ({
  browser,
}) => {
  const { context, page } = await newSignedInPage(browser, USER_EMAIL);

  try {
    await page.getByLabel("Open menu").click();
    await page
      .getByLabel(/Open .* page/)
      .first()
      .click();

    // Overview tab (default)
    await expect(
      page.getByText("What we're building toward"),
    ).toBeVisible();
    // Member-only AI spend card, backed by commons.getAISpending. It renders
    // in both the empty and populated states, so assert its fixed labels.
    // Checked first so the "This month" locator below always runs with the
    // card's "this month · N AI tasks" text on the page.
    await expect(page.getByText("AI spending", { exact: true })).toBeVisible();
    await expect(page.getByText("last month", { exact: true })).toBeVisible();
    await expect(page.getByText("This month", { exact: true })).toBeVisible();

    // Community tab
    await page.getByText("Community", { exact: true }).click();
    await expect(page.getByText("People", { exact: true })).toBeVisible();
    await expect(page.getByText("Circles", { exact: true })).toBeVisible();

    // Governance tab
    await page.getByText("Governance", { exact: true }).click();
    await expect(page.getByText("How decisions work")).toBeVisible();
    await expect(page.getByText("Funding thresholds")).toBeVisible();
    await expect(page.getByText("Recent proposals")).toBeVisible();

    // Back to Overview
    await page.getByText("Overview", { exact: true }).click();
    await expect(page.getByText("About", { exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});
