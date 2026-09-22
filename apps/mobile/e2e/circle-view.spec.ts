import { expect, test } from "@playwright/test";
import { newSignedInPage } from "./support/auth";

const USER_A_EMAIL =
  process.env.E2E_USER_A_EMAIL || "releaseclick1@test.cahootz.local";

// Circle View is the Commons tab's landing screen (and "/" for a signed-in
// session) - it replaced the old direct-to-feed landing. These journeys
// cover that navigation change plus the new welcome-lounge workflow, both
// added in this change; see AGENTS.md's e2e-coverage requirement.

test("Commons tab lands on Circle View, and the feed's back button returns to it", async ({
  browser,
}) => {
  const { context, page } = await newSignedInPage(browser, USER_A_EMAIL);

  try {
    await expect(page.getByText("Welcome In", { exact: true })).toBeVisible();
    await expect(page.getByText("General", { exact: true })).toBeVisible();

    await page.getByText("General", { exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "Share what's happening..." }),
    ).toBeVisible();

    await page.getByLabel("Back to Circle View").click();
    await expect(page.getByText("Welcome In", { exact: true })).toBeVisible();

    // Tapping Commons again from Circle View should not push a second copy
    // of the screen or duplicate the bottom tab bar.
    await page.getByLabel("Commons", { exact: true }).click();
    await expect(page.getByLabel("Commons", { exact: true })).toHaveCount(1);
  } finally {
    await context.close();
  }
});

test("a signed-in member can join a welcome lounge from Circle View", async ({
  browser,
}) => {
  const { context, page } = await newSignedInPage(browser, USER_A_EMAIL);

  try {
    await expect(page.getByText("Welcome In", { exact: true })).toBeVisible();

    const alreadyMember = page.getByText(/^Welcome Lounge \d+$/);
    if (await alreadyMember.isVisible().catch(() => false)) {
      await alreadyMember.click();
    } else {
      await page.getByText("Join a welcome lounge", { exact: true }).click();
    }

    await expect(
      page.getByRole("textbox", { name: "Share what's happening..." }),
    ).toBeVisible();
    await expect(page.getByText(/Welcome Lounge \d+/).first()).toBeVisible();

    await page.getByLabel("Back to Circle View").click();
    await expect(page.getByText(/^Welcome Lounge \d+$/)).toBeVisible();
  } finally {
    await context.close();
  }
});
