import { expect, test } from "@playwright/test";

import { ADMIN_BASE_URL, signInAdmin } from "./support/admin";
import { apiFixture } from "./support/offers";

const RUN = `di${Date.now()}`;
const AREA = `E2E Town ${RUN}`;
const ITEM = `E2E ${RUN} Laundry pods`;
const SELLER = `E2E ${RUN} Soap Shop`;
const fixture = (args: string[]) => apiFixture("scripts/e2e-vendor-outreach.ts", args);

test.afterAll(() => {
  fixture(["item-cleanup", RUN]);
});

test("an admin approves a bot-found item, Sage finds a seller, and the Group Buy form fills itself in", async ({ browser }) => {
  const { coopId } = fixture(["item-setup", RUN]);

  const adminContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const vendorContext = await browser.newContext({ viewport: { width: 430, height: 932 } });
  const admin = await adminContext.newPage();
  const vendor = await vendorContext.newPage();
  try {
    // 1. The bot's item waits for review, with its price evidence and what wasn't checked.
    await signInAdmin(admin);
    await admin.goto(`${ADMIN_BASE_URL}/portal/admin/outreach`);
    await expect(admin.getByRole("heading", { name: "Vendor outreach" })).toBeVisible({ timeout: 60_000 });
    await admin.getByRole("tab", { name: /product ideas/ }).click();
    const card = admin.getByLabel(`Product idea ${ITEM}`);
    await expect(card.getByTestId("item-status")).toHaveText("Needs review");
    await expect(card.getByText(/\$12\.17 each/)).toBeVisible();
    await expect(card.getByText(/when 12 people buy together/)).toBeVisible();
    // The suggested deal uses the same price rule as every offer.
    await expect(card.getByTestId("item-suggestion")).toContainText("Suggested deal: $16.29 for 64 pods (save 43%), 12 households to unlock.");
    await expect(card.getByTestId("item-suggestion")).toContainText("Vendor $12.17 · Stripe about $0.77 · Commons $1.67 · Cahootz $1.68");
    await expect(admin.getByRole("region", { name: "Group Buy pricing" })).toBeVisible();
    await expect(card.getByText(/Not checked: Shipping cost not checked/)).toBeVisible();

    // 2. Approving it, then starting a seller search near the Commons.
    await card.getByRole("button", { name: "Approve" }).click();
    await expect(admin.getByText(`${ITEM} approved for E2E ${RUN} Families.`)).toBeVisible();
    await expect(card.getByTestId("item-status")).toHaveText("Approved");
    await card.getByRole("button", { name: "Find a seller" }).click();
    await expect(admin.getByText("Add the city or area to search near.")).toBeVisible();
    await card.getByLabel("Search near (city or area)").fill(AREA);
    await card.getByLabel("Most emails to send").fill("2");
    await card.getByRole("button", { name: "Find a seller" }).click();
    await expect(admin.getByText(`Sage will look for a seller of ${ITEM} within the hour.`)).toBeVisible();
    await expect(card.getByText("Seller search active. See it under Campaigns.")).toBeVisible();
    await admin.reload();
    await admin.getByRole("tab", { name: /campaigns/ }).click();
    await expect(admin.getByText(`${ITEM} · ${coopId}`)).toBeVisible({ timeout: 60_000 });
    await expect(admin.getByText("You started this seller search from a product idea.")).toBeVisible();

    // 3. Sage emails the local shop members recommended; its reply page names the item.
    const { token, status } = fixture(["item-sweep", RUN]);
    expect(status).toBe("SENT");
    await vendor.goto(`${ADMIN_BASE_URL}/v/${token}`);
    await expect(vendor.getByRole("heading", { name: `Hi ${SELLER}` })).toBeVisible({ timeout: 60_000 });
    await expect(vendor.getByText(new RegExp(`want to buy ${ITEM} together`))).toBeVisible();
    await expect(vendor.getByText(/e2e-outreach/)).toHaveCount(0);
    await vendor.getByLabel("Your name").fill("Robin");
    await vendor.getByLabel("Best phone or email").fill("555-0142");
    await vendor.getByRole("button", { name: "Yes, I'm interested" }).click();
    await expect(vendor.getByRole("heading", { name: "Thank you!" })).toBeVisible();

    // 4. The admin starts the Group Buy from the yes, and the form is filled in from the item.
    await admin.reload();
    await admin.getByRole("tab", { name: /businesses/ }).click();
    const business = admin.getByLabel(`Business ${SELLER}`);
    await expect(business.getByText("Said yes", { exact: true })).toBeVisible({ timeout: 60_000 });
    await business.getByRole("link", { name: `Start the group buy for ${ITEM}` }).click();
    await expect(admin.getByTestId("offer-from-item")).toContainText(`Started from the product idea ${ITEM} (64 pods each)`, { timeout: 60_000 });
    await expect(admin.getByLabel("Title members see")).toHaveValue(ITEM);
    await expect(admin.getByLabel("Regular price ($)")).toHaveValue("28.89");
    await expect(admin.getByLabel("Member price ($)")).toHaveValue("16.29");
    await expect(admin.getByLabel("Vendor gets ($ per unit)")).toHaveValue("12.17");
    await expect(admin.getByLabel("Commons share of what's left (%)")).toHaveValue("50");
    await expect(admin.getByRole("form", { name: "New offer" }).getByRole("alert")).toHaveCount(0);
    await expect(admin.getByLabel("Units needed to unlock")).toHaveValue("12");
    await expect(admin.getByLabel("Where the regular price comes from")).toHaveValue(/^E2E Supplier price on \d{4}-\d{2}-\d{2}: https:\/\/e2e-supplier\.test\//);
  } finally {
    await adminContext.close();
    await vendorContext.close();
  }
});
