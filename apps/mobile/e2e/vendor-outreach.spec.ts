import { expect, test } from "@playwright/test";

import { ADMIN_BASE_URL, signInAdmin } from "./support/admin";
import { apiFixture } from "./support/offers";

const RUN = `vo${Date.now()}`;
const AREA = `E2E Town ${RUN}`;
const BUSINESS = `E2E ${RUN} Corner Market`;
const fixture = (args: string[]) => apiFixture("scripts/e2e-vendor-outreach.ts", args);

test.afterAll(() => {
  fixture(["cleanup", RUN]);
});

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

test("an admin sets the mailing address outreach emails carry, and outreach never sends from a test copy", async ({ browser }) => {
  const run = `${RUN}m`;
  fixture(["postal-address-backup", run]);
  const adminContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const admin = await adminContext.newPage();
  try {
    await signInAdmin(admin);
    await admin.goto(`${ADMIN_BASE_URL}/portal/admin/outreach`);
    await expect(admin.getByRole("heading", { name: "Vendor outreach" })).toBeVisible({ timeout: 60_000 });
    const box = admin.getByRole("region", { name: "Mailing address" });
    const field = box.getByLabel("Street, city, state and ZIP");

    // Too little to be a real address is turned down with a plain reason.
    await field.fill("Main St");
    await box.getByRole("button", { name: "Save address" }).click();
    await expect(admin.getByText("Add the full mailing address: street, city, state and ZIP.")).toBeVisible();

    // Two typed lines are saved as one line for the email footer, and it's still there after a reload.
    await field.fill(`E2E ${run} 1 Main Street\nTestville, CA 94000`);
    await box.getByRole("button", { name: "Save address" }).click();
    await expect(admin.getByText("Mailing address saved. Every outreach email will show it.")).toBeVisible();
    await admin.reload();
    await expect(field).toHaveValue(`E2E ${run} 1 Main Street, Testville, CA 94000`, { timeout: 60_000 });

    // With the address set, a test copy still only saves previews, and says why.
    await expect(admin.getByText("Email isn't sending yet: emails are saved as previews (dry run). Outreach only sends from the live site, never from a test or local copy.")).toBeVisible();
  } finally {
    await adminContext.close();
    fixture(["postal-address-restore", run]);
  }
});
