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

/** Leaves the unchanged intro/profile/invite steps, chooses Explore commons,
 * then opens the existing fixture commons (or its public visitor view).
 * Membership creation is tested separately with fresh accounts.
 */
export async function skipOnboardingWizard(
  page: Page,
  mode: "always" | "if-shown",
) {
  const introContinue = page.getByRole("button", {
    name: "Continue",
    exact: true,
  });
  if (mode === "if-shown") {
    // Wait for the wizard's first step (or the feed, if onboarding is
    // already done) before checking what to skip. A signed-in person who
    // already saw the intro on this device starts at the profile form, so
    // the first step isn't always the intro.
    await expect(
      introContinue
        .or(page.getByRole("button", { name: "Do this later" }))
        .or(page.getByRole("button", { name: "Explore commons" }))
        .or(page.getByRole("button", { name: "Next", exact: true }))
        .or(page.getByRole("button", { name: "Skip for now", exact: true }))
        .or(page.getByLabel("Open menu"))
        .filter({ visible: true })
        .first(),
    ).toBeVisible();
  }
  if (await introContinue.isVisible().catch(() => false)) {
    await introContinue.click();
    await expect(page.getByRole("button", { name: "Do this later" })).toBeVisible();
  }

  const deferProfile = page.getByRole("button", { name: "Do this later" });
  if (mode === "always") {
    await expect(deferProfile).toBeVisible();
    await deferProfile.click();
    await expect(page.getByRole("button", { name: "Next", exact: true })).toBeVisible();
  } else if (await deferProfile.isVisible().catch(() => false)) {
    await deferProfile.click();
    await expect(page.getByRole("button", { name: "Next", exact: true })).toBeVisible();
  }

  // Then the "Invite people you know" step.
  const inviteNext = page.getByRole("button", { name: "Next", exact: true });
  if (mode === "always") {
    await expect(inviteNext).toBeVisible();
    await inviteNext.click();
  } else if (await inviteNext.isVisible().catch(() => false)) {
    await inviteNext.click();
  }

  const existingCommonsSkip = page.getByRole("button", { name: "Skip for now", exact: true });
  if (mode === "if-shown") {
    await expect(existingCommonsSkip.or(page.getByRole("button", { name: "Explore commons" })).or(page.getByLabel("Open menu")).filter({ visible: true }).first()).toBeVisible();
    if (await existingCommonsSkip.isVisible()) {
      await existingCommonsSkip.click();
      return;
    }
  }
  // Newcomers without memberships choose where to belong.

  const exploreCommons = page.getByRole("button", { name: "Explore commons" });
  if (mode === "always") {
    await expect(exploreCommons).toBeVisible();
    await exploreCommons.click();
    await expect(page.getByText("Browse commons", { exact: true })).toBeVisible();
    await page.goto("/?coopId=cahootz");
  } else if (await exploreCommons.isVisible().catch(() => false)) {
    await exploreCommons.click();
    await expect(page.getByText("Browse commons", { exact: true })).toBeVisible();
    await page.goto("/");
  }
}

export async function enterFeed(page: Page) {
  await page.goto("/?coopId=cahootz");

  await expect(page.getByLabel("Open menu")).toBeVisible();
}

export async function signIn(page: Page, email: string) {
  await page.goto("/?entry=sign-in");

  await page.getByPlaceholder("name@email.com").fill(email);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await page.getByPlaceholder("Enter 6-digit code").fill(TEST_CODE);
  await page.getByRole("button", { name: "Verify and continue" }).click();

  await skipOnboardingWizard(page, "if-shown");

  await expect(page.getByLabel("Open menu")).toBeVisible();
  // Handles are editable and need not match the email prefix. Verify the
  // signed-in identity through the real account screen instead.
  await page.getByRole("tab", { name: "You", exact: true }).click();
  await expect(page.getByText(email, { exact: true }).filter({ visible: true })).toBeVisible();
  await page.getByRole("tab", { name: "Commons", exact: true }).click();
  await expect(page.getByLabel("Open menu")).toBeVisible();
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
    await skipOnboardingWizard(page, "if-shown");
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
