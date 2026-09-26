import fs from "node:fs";
import path from "node:path";
import type { Browser, Page } from "@playwright/test";
import { expect } from "@playwright/test";

const TEST_CODE = process.env.E2E_LOGIN_CODE || "000000";
const AUTH_DIR = path.join(__dirname, "..", ".auth");

export const USER_A_EMAIL =
  process.env.E2E_USER_A_EMAIL || "releaseclick1@test.cahootz.local";
export const USER_B_EMAIL =
  process.env.E2E_USER_B_EMAIL || "releaseclick2@test.cahootz.local";

/**
 * Clicks past the post-signup wizard's three steps (intro carousel, profile
 * form, "find your way in") by taking the skip/defer path on each. Shared by
 * every spec so a wizard change (like the third "circles" step added here)
 * only needs fixing in one place.
 *
 * `mode: "always"` asserts each step is present before skipping it - use
 * this right after `page.goto("/")` for a guaranteed-fresh anonymous
 * session, where a conditional `isVisible()` check can race the screen's
 * async load and silently no-op instead of waiting for it.
 *
 * `mode: "if-shown"` tolerates a step being absent (already completed by a
 * prior test run against the same seeded account) - use this right after a
 * login, where completion state isn't known up front.
 */
export async function skipOnboardingWizard(
  page: Page,
  mode: "always" | "if-shown",
) {
  const introContinue = page.getByRole("button", {
    name: "Continue",
    exact: true,
  });
  if (mode === "always") {
    await expect(introContinue).toBeVisible();
    await introContinue.click();
  } else if (await introContinue.isVisible().catch(() => false)) {
    await introContinue.click();
  }

  const deferProfile = page.getByRole("button", { name: "Do this later" });
  if (mode === "always") {
    await expect(deferProfile).toBeVisible();
    await deferProfile.click();
  } else if (await deferProfile.isVisible().catch(() => false)) {
    await deferProfile.click();
  }

  // "Do this later" only skips the profile form - it now lands on a third
  // "find your way in" step (welcome lounge / explore / skip) before the
  // feed, so skip that too to reach Circle View.
  const skipCircles = page.getByRole("button", { name: "Skip for now" });
  if (mode === "always") {
    await expect(skipCircles).toBeVisible();
    await skipCircles.click();
  } else if (await skipCircles.isVisible().catch(() => false)) {
    await skipCircles.click();
  }
}

export async function enterFeed(page: Page) {
  await page.goto("/");

  await expect(page).toHaveURL(/profile-onboarding/);
  await skipOnboardingWizard(page, "always");

  await expect(page.getByLabel("Open menu")).toBeVisible();
}

export async function signIn(page: Page, email: string) {
  await enterFeed(page);
  await page.getByLabel("Open menu").click();
  await page.getByText("Sign In", { exact: true }).click();

  await page.getByPlaceholder("name@email.com").fill(email);
  await page.getByRole("button", { name: "Log in with code" }).click();
  await page.getByPlaceholder("Enter 6-digit code").fill(TEST_CODE);
  await page.getByRole("button", { name: "Verify & Sign In" }).click();

  await expect(page).toHaveURL(/profile-onboarding/);
  await skipOnboardingWizard(page, "if-shown");

  await expect(page.getByLabel("Open menu")).toBeVisible();
  await page.getByLabel("Open menu").click();
  await expect(
    page.getByText(new RegExp(`Sign Out \\(@${email.split("@")[0]}\\)`)),
  ).toBeVisible();
  await page.getByLabel("Close menu").click();
}

/**
 * Where `auth.setup.ts` saves each account's signed-in browser storage.
 * Sessions live in localStorage on web, so restoring this file into a new
 * context is equivalent to having just signed in through the UI.
 */
export function storageStatePath(email: string) {
  return path.join(AUTH_DIR, `${email.split("@")[0]}.json`);
}

/**
 * Opens an isolated, signed-in browser context for `email`.
 *
 * Reuses the session saved by the `setup` project (which signs in through
 * the real UI once per run) instead of repeating the whole sign-in journey
 * in every test. Falls back to a UI sign-in when no saved session exists -
 * e.g. an account the setup project doesn't cover, or `--no-deps`.
 */
export async function newSignedInPage(browser: Browser, email: string) {
  const statePath = storageStatePath(email);
  const hasSavedSession = fs.existsSync(statePath);
  const context = await browser.newContext({
    viewport: { width: 430, height: 932 },
    storageState: hasSavedSession ? statePath : undefined,
  });
  const page = await context.newPage();
  if (hasSavedSession) {
    await page.goto("/");
    await expect(page.getByLabel("Open menu")).toBeVisible();
  } else {
    await signIn(page, email);
  }
  return { context, page };
}

// The Commons tab (and "/") land on Circle View, not the feed directly -
// open the General card to reach the actual post feed and composer.
export async function openGeneralFeed(page: Page) {
  await page.getByText("General", { exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Share what's happening..." }),
  ).toBeVisible();
}
