import { expect, test, type Page } from "@playwright/test";

import { newSignedInPage, USER_A_EMAIL } from "./support/auth";

// Opening the app with no connection used to drop the saved session (the
// onboarding refresh failed before the session was restored), so a signed-in
// member saw a "Sign in" card. On iOS the same launch also crashed: the
// sign-in redirect ran before the navigator was ready.
//
// Now reads are saved on the phone (lib/offline-cache.ts), so an offline
// launch shows the member's last-loaded screens under an offline banner, and
// the app catches up on its own once the connection is back. These journeys
// cut the API off, reopen the app, and check both cases: with saved data,
// and with nothing saved yet.

function shown(page: Page, text: string | RegExp, options?: { exact?: boolean }) {
  return page.getByText(text, options).filter({ visible: true });
}

const CONNECTION_MESSAGE =
  "We couldn't reach Cahootz. Check your internet connection and try again.";
const OFFLINE_WITH_SAVED = /You're offline\. You're seeing what was saved on this phone/;
const OFFLINE_NOTHING_SAVED = /You're offline\. We'll catch up when you're back online/;

/** Every API call, the way a phone with no signal sees it. */
function apiCall(url: URL) {
  return url.pathname.startsWith("/trpc/") || url.pathname.startsWith("/api/") || url.pathname === "/health";
}

async function goOffline(page: Page) {
  await page.route(apiCall, (route) => route.abort("internetdisconnected"));
}

test("a member who opens the app offline sees their saved circles, then catches up once back online", async ({
  browser,
}) => {
  const { context, page } = await newSignedInPage(browser, USER_A_EMAIL);

  try {
    // newSignedInPage loaded Circle View online, which saved it on the phone.
    await expect(shown(page, "General", { exact: true })).toBeVisible();

    await goOffline(page);
    await page.reload();

    await expect(shown(page, OFFLINE_WITH_SAVED)).toBeVisible();
    await expect(shown(page, "General", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Open menu")).toBeVisible();
    // Still signed in, and no app error screen.
    await expect(shown(page, "Log in to join your commons")).toHaveCount(0);
    await expect(shown(page, "Something went wrong")).toHaveCount(0);

    // Back online: the health check notices and the banner clears by itself.
    await page.unroute(apiCall);
    await expect(shown(page, OFFLINE_WITH_SAVED)).toHaveCount(0, { timeout: 30_000 });
    await expect(shown(page, "General", { exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("a member who opens the app offline with nothing saved stays signed in and recovers", async ({
  browser,
}) => {
  const { context, page } = await newSignedInPage(browser, USER_A_EMAIL);

  try {
    // Forget the saved reads, but keep the signed-in session.
    await page.evaluate(() => {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith("cahootz.offline.")) localStorage.removeItem(key);
      }
    });
    await goOffline(page);
    await page.reload();

    await expect(shown(page, OFFLINE_NOTHING_SAVED)).toBeVisible();
    await expect(shown(page, CONNECTION_MESSAGE).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" }).first()).toBeVisible();
    await expect(shown(page, "Log in to join your commons")).toHaveCount(0);
    await expect(shown(page, "Something went wrong")).toHaveCount(0);

    // Back online, the saved session still works.
    await page.unroute(apiCall);
    await page.goto("/");
    await expect(page.getByLabel("Open menu")).toBeVisible();
    await expect(shown(page, "General", { exact: true })).toBeVisible();
    await expect(shown(page, "Log in to join your commons")).toHaveCount(0);
    await expect(shown(page, OFFLINE_NOTHING_SAVED)).toHaveCount(0);
  } finally {
    await context.close();
  }
});
