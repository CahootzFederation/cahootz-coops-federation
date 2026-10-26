import { expect, test, type Page } from "@playwright/test";

import { apiFixture } from "./support/offers";

// The platform admin portal and the public vendor reply page are on the web app
// (E2E_ADMIN_BASE_URL). The admin email must be on PLATFORM_ADMIN_EMAILS for both
// the web app and the API, as in admin-commons-ai.spec.ts.
const ADMIN_BASE_URL = process.env.E2E_ADMIN_BASE_URL || "http://localhost:3000";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || "e2e-admin@test.cahootz.local";
const RUN = `vo${Date.now()}`;
const AREA = `E2E Town ${RUN}`;
const BUSINESS = `E2E ${RUN} Corner Market`;
const fixture = (args: string[]) => apiFixture("scripts/e2e-vendor-outreach.ts", args);

test.afterAll(() => {
  fixture(["cleanup", RUN]);
});

async function signInAdmin(page: Page) {
  await page.goto(`${ADMIN_BASE_URL}/portal/admin/login`);
  await page.getByLabel("Email address").fill(ADMIN_EMAIL);
  await page.getByRole("button", { name: "Email me a login code" }).click();
  await expect(page.getByLabel("Login code")).toBeVisible();
  const { code } = apiFixture("scripts/e2e-admin.ts", ["login-code", ADMIN_EMAIL]);
  await page.getByLabel("Login code").fill(code);
  await page.getByRole("button", { name: "Verify & Sign In" }).click();
  await expect(page).toHaveURL(/\/portal\/admin(?!\/login)/);
}

test("an admin approves Sage's campaign, a vendor says yes, and the admin takes it from there", async ({ browser }) => {
  const { campaignId } = fixture(["setup", RUN]);

  const adminContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const vendorContext = await browser.newContext({ viewport: { width: 430, height: 932 } });
  const admin = await adminContext.newPage();
  const vendor = await vendorContext.newPage();
  try {
    // 1. Sage's proposal waits for a platform admin, with the public evidence.
    await signInAdmin(admin);
    await admin.goto(`${ADMIN_BASE_URL}/portal/admin/outreach`);
    await expect(admin.getByRole("heading", { name: "Vendor outreach" })).toBeVisible({ timeout: 60_000 });
    const proposed = admin.getByTestId(`campaign-${campaignId}`);
    await expect(proposed.getByText(/6 members answered Sage's question/)).toBeVisible();
    await expect(proposed.getByTestId("campaign-status")).toHaveText("proposed");

    // An area is required before anything can be sent.
    await proposed.getByRole("button", { name: "Approve campaign" }).click();
    await expect(admin.getByText("Add the city or area to search near.")).toBeVisible();
    await proposed.getByLabel("Search near (city or area)").fill(AREA);
    await proposed.getByLabel("Most emails to send").fill("2");
    await proposed.getByRole("button", { name: "Approve campaign" }).click();
    await expect(admin.getByText(/Campaign approved/)).toBeVisible();
    await admin.reload();
    const active = admin.getByTestId(`campaign-${campaignId}`);
    await expect(active.getByTestId("campaign-status")).toHaveText("active", { timeout: 60_000 });

    // 2. Sage finds the recommended business and emails it (saved as a preview in tests).
    const { token, status } = fixture(["sweep", RUN]);
    expect(status).toBe("SENT");
    await admin.reload();
    await expect(admin.getByText(/Email isn't sending yet/)).toBeVisible({ timeout: 60_000 });
    await expect(active.getByText(BUSINESS)).toBeVisible();

    // 3. The vendor answers on the reply page, which never names the community.
    await vendor.goto(`${ADMIN_BASE_URL}/v/${token}`);
    await expect(vendor.getByRole("heading", { name: `Hi ${BUSINESS}` })).toBeVisible({ timeout: 60_000 });
    await expect(vendor.getByText(/That amount is yours, with no fees taken out of it/)).toBeVisible();
    await expect(vendor.getByText(/e2e-outreach/)).toHaveCount(0);
    await vendor.getByLabel("Your name").fill("Dana");
    await vendor.getByLabel("Best phone or email").fill("555-0100");
    await vendor.getByRole("button", { name: "Yes, I'm interested" }).click();
    await expect(vendor.getByRole("heading", { name: "Thank you!" })).toBeVisible();
    await vendor.reload();
    await expect(vendor.getByRole("heading", { name: "Thank you!" })).toBeVisible({ timeout: 60_000 });

    // 4. The yes lands with the admin, who takes it from here.
    await admin.reload();
    await admin.getByRole("tab", { name: /businesses/ }).click();
    const business = admin.getByLabel(`Business ${BUSINESS}`);
    await expect(business.getByText("Said yes", { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(business.getByText(/Dana · 555-0100/)).toBeVisible();
    await business.getByRole("button", { name: "Mark in talks" }).click();
    await expect(business.getByText("In talks", { exact: true })).toBeVisible();

    // 5. The email's unsubscribe link works in one click.
    await vendor.goto(`${ADMIN_BASE_URL}/v/${token}?unsubscribe=1`);
    await vendor.getByRole("button", { name: "Unsubscribe" }).click();
    await expect(vendor.getByRole("heading", { name: "You're unsubscribed." })).toBeVisible();
  } finally {
    await adminContext.close();
    await vendorContext.close();
  }
});
