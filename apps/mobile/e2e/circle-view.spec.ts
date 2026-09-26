import { expect, test } from "@playwright/test";
import { enterFeed, newSignedInPage } from "./support/auth";

const API_BASE_URL = process.env.E2E_API_BASE_URL || "http://localhost:3001";
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

test("a circle's emoji icon on Circle View is not clipped by its line box", async ({
  browser,
}) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const circleName = `E2E Emoji Circle ${runId}`;
  const emoji = "🌻";
  const { context, page } = await newSignedInPage(browser, USER_A_EMAIL);
  let groupId: string | undefined;
  let sessionToken: string | null = null;

  try {
    sessionToken = await page.evaluate(() =>
      window.localStorage.getItem("cahootz.sessionToken"),
    );
    expect(sessionToken).toBeTruthy();

    const created = await fetch(`${API_BASE_URL}/trpc/groups.create`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-session-token": sessionToken!,
      },
      body: JSON.stringify({ name: circleName, privacy: "public", iconEmoji: emoji }),
    }).then((res) => res.json());
    groupId = created?.result?.data?.group?.id;
    expect(groupId).toBeTruthy();

    await page.reload();
    await expect(page.getByText(circleName, { exact: true })).toBeVisible();

    // The emoji renders at 40px; its box must be at least that tall or the
    // glyph's top and bottom get cut off (the regression this guards).
    const icon = page
      .getByRole("button")
      .filter({ hasText: circleName })
      .getByText(emoji, { exact: true });
    await expect(icon).toBeVisible();
    const box = await icon.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(40);
  } finally {
    if (groupId && sessionToken) {
      await fetch(`${API_BASE_URL}/trpc/groups.leave`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-session-token": sessionToken,
        },
        body: JSON.stringify({ groupId }),
      });
    }
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
      // The heading renders before the circle list loads - wait for the grid
      // (General is always its first card) or the lounge count below can
      // read 0 for an account that already has one and wait for a join card
      // that never appears.
      await expect(page.getByText("General", { exact: true })).toBeVisible();

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

test("signed-out visitors see a sign-in card in place of the welcome lounge", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
  const page = await context.newPage();
  try {
    await enterFeed(page);
    await expect(page.getByText("Welcome In", { exact: true })).toBeVisible();
    await expect(page.getByText("Join a welcome lounge", { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByPlaceholder("name@email.com")).toBeVisible();
  } finally {
    await context.close();
  }
});
