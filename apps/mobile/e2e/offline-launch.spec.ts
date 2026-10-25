import { expect, test, type Page } from "@playwright/test";

import { newSignedInPage, USER_A_EMAIL } from "./support/auth";

// Opening the app with no connection used to drop the saved session (the
// onboarding refresh failed before the session was restored), so a signed-in
// member saw a "Sign in" card. On iOS the same launch also crashed: the
// sign-in redirect ran before the navigator was ready. This journey cuts the
// API off, reopens the app, and checks the member is still signed in and
// gets a plain "can't reach us" message, then reconnects and recovers.

function shown(page: Page, text: string | RegExp, options?: { exact?: boolean }) {
  return page.getByText(text, options).filter({ visible: true });
}

const CONNECTION_MESSAGE =
  "We couldn't reach Cahootz. Check your internet connection and try again.";

/** Every API call, the way a phone with no signal sees it. */
function apiCall(url: URL) {
  return url.pathname.startsWith("/trpc/") || url.pathname.startsWith("/api/");
}

test("a signed-in member who opens the app offline stays signed in and recovers once back online", async ({
  browser,
}) => {
  const { context, page } = await newSignedInPage(browser, USER_A_EMAIL);

  try {
    await page.route(apiCall, (route) => route.abort("internetdisconnected"));
    await page.reload();

    await expect(shown(page, CONNECTION_MESSAGE).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" }).first()).toBeVisible();
    // Still signed in: no sign-in prompt, and no app error screen.
    await expect(shown(page, "Log in to join your commons")).toHaveCount(0);
    await expect(shown(page, "Something went wrong")).toHaveCount(0);

    // Back online, the saved session still works.
    await page.unroute(apiCall);
    await page.goto("/");
    await expect(page.getByLabel("Open menu")).toBeVisible();
    await expect(shown(page, "General", { exact: true })).toBeVisible();
    await expect(shown(page, "Log in to join your commons")).toHaveCount(0);
    await expect(shown(page, CONNECTION_MESSAGE)).toHaveCount(0);
  } finally {
    await context.close();
  }
});
