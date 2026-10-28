import { expect, type Page } from "@playwright/test";

import { apiFixture } from "./offers";

/**
 * The platform admin portal (and the public vendor reply page) live on the web
 * app at E2E_ADMIN_BASE_URL. The admin email must be on PLATFORM_ADMIN_EMAILS
 * for both the web app and the API, as in admin-commons-ai.spec.ts.
 */
export const ADMIN_BASE_URL = process.env.E2E_ADMIN_BASE_URL || "http://localhost:3000";
export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || "e2e-admin@test.cahootz.local";

/** Signs in to the platform admin portal through the real login-code form. */
export async function signInAdmin(page: Page) {
  await page.goto(`${ADMIN_BASE_URL}/portal/admin/login`);
  await page.getByLabel("Email address").fill(ADMIN_EMAIL);
  await page.getByRole("button", { name: "Email me a login code" }).click();
  await expect(page.getByLabel("Login code")).toBeVisible();
  const { code } = apiFixture("scripts/e2e-admin.ts", ["login-code", ADMIN_EMAIL]);
  await page.getByLabel("Login code").fill(code);
  await page.getByRole("button", { name: "Verify & Sign In" }).click();
  await expect(page).toHaveURL(/\/portal\/admin(?!\/login)/);
}
