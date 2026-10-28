import { expect, test } from "@playwright/test";
import { newSignedInPage } from "./support/auth";

const USER_EMAIL =
  process.env.E2E_USER_A_EMAIL || "releaseclick1@test.cahootz.local";
const USER_B_EMAIL =
  process.env.E2E_USER_B_EMAIL || "releaseclick2@test.cahootz.local";

function handleFor(email: string) {
  return email.split("@")[0].replace(/[^a-z0-9]+/gi, "").toLowerCase();
}

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
    // Sage's autonomous-work limit: usage against both monthly caps and whether it is paused.
    const autonomy = page.getByTestId("sage-autonomy-usage");
    await expect(autonomy.getByText("Sage on its own", { exact: true })).toBeVisible();
    await expect(autonomy.getByText(/^(Active|Paused)$/)).toBeVisible();
    await expect(autonomy.getByText(/ of \$[\d.,]+ · \d+ of [\d,]+ tasks this month/)).toBeVisible();

    // Community tab
    await page.getByText("Community", { exact: true }).click();
    await expect(page.getByText("People", { exact: true })).toBeVisible();
    await expect(page.getByText("Circles", { exact: true }).first()).toBeVisible();

    // Governance tab
    await page.getByText("How we decide", { exact: true }).click();
    await expect(page.getByText("How decisions work")).toBeVisible();
    await expect(page.getByText("Who needs to OK what")).toBeVisible();
    await expect(page.getByText("Recent proposals")).toBeVisible();

    // Back to Overview
    await page.getByText("Overview", { exact: true }).click();
    await expect(page.getByText("About", { exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("a member opens the full member list from the Community tab, Sage isn't in it, and opens a member's page", async ({
  browser,
}) => {
  const { context, page } = await newSignedInPage(browser, USER_EMAIL);
  const otherHandle = handleFor(USER_B_EMAIL);

  try {
    await page.getByLabel("Open menu").click();
    await page
      .getByLabel(/Open .* page/)
      .first()
      .click();
    await page.getByText("Community", { exact: true }).click();
    await expect(page.getByText("People", { exact: true })).toBeVisible();

    await page.getByLabel("See all members").click();
    await expect(page.getByLabel("Search members")).toBeVisible();

    // Sage holds a membership in each Commons so it resolves in mentions, but
    // it isn't a person and is never listed (handle `sage` or `sage-<coopId>`).
    const search = page.getByLabel("Search members");
    await search.fill("sage");
    await expect(page.getByText(/^\d+ match(es)?$/)).toBeVisible();
    await expect(page.getByText(/^@sage(-.*)?$/)).toHaveCount(0);

    await search.fill(otherHandle);
    await expect(page.getByText(`@${otherHandle}`, { exact: true })).toBeVisible();
    await page.getByText(`@${otherHandle}`, { exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/people/${otherHandle}`));
  } finally {
    await context.close();
  }
});
