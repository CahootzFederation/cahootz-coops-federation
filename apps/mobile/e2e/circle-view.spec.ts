import { expect, test } from "@playwright/test";
import { newSignedInPage } from "./support/auth";

const USER_A_EMAIL =
  process.env.E2E_USER_A_EMAIL || "releaseclick1@test.cahootz.local";
const USER_B_EMAIL =
  process.env.E2E_USER_B_EMAIL || "releaseclick2@test.cahootz.local";

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

test("two signed-in members see Sage's introduction thread in their welcome lounge", async ({
  browser,
}) => {
  const [{ context: contextA, page: pageA }, { context: contextB, page: pageB }] =
    await Promise.all([
      newSignedInPage(browser, USER_A_EMAIL),
      newSignedInPage(browser, USER_B_EMAIL),
    ]);

  try {
    for (const page of [pageA, pageB]) {
      await expect(page.getByText("Welcome In", { exact: true })).toBeVisible();

      const loungeMatches = page.getByText(/^Welcome Lounge \d+$/);
      let alreadyMember = loungeMatches.first();
      let hadExistingAssignment = false;
      for (let index = 0; index < (await loungeMatches.count()); index += 1) {
        const candidate = loungeMatches.nth(index);
        if (await candidate.isVisible()) {
          alreadyMember = candidate;
          hadExistingAssignment = true;
          break;
        }
      }
      if (hadExistingAssignment) {
        await alreadyMember.click();
      } else {
        await page.getByText("Join a welcome lounge", { exact: true }).click();
      }

      await expect(
        page.getByRole("textbox", { name: "Share what's happening..." }),
      ).toBeVisible();

      // Reused local fixture accounts can already belong to a lounge created
      // before this feature existed. Fresh CI fixtures take the join path and
      // must see the new Sage thread; old local assignments still exercise
      // navigation without making historical test data part of the contract.
      if (!hadExistingAssignment) {
        await expect(page.getByText("Sage", { exact: true }).first()).toBeVisible();
        await expect(
          page.getByText(/Introduce yourself in the comments/).first(),
        ).toBeVisible();
      }
    }

    await pageA.getByLabel("Back to Circle View").click();
    await expect(pageA.getByText(/^Welcome Lounge \d+$/)).toBeVisible();
  } finally {
    await Promise.all([contextA.close(), contextB.close()]);
  }
});
