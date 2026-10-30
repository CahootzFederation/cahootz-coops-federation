import { expect, test } from "@playwright/test";

import { ADMIN_BASE_URL, signInAdmin } from "./support/admin";
import { USER_A_EMAIL, USER_B_EMAIL, newSignedInPage } from "./support/auth";
import { OFFERS_COOP_ID, offersFixture, openOffersMarketplace, shown, visibleButton } from "./support/offers";

const RUN = `E2E deal ${Date.now()}`;

test.afterAll(() => {
  offersFixture(["cleanup", RUN]);
});

test("a member sees a group buy's regular price, group price and saving in the marketplace", async ({ browser }) => {
  const title = `${RUN} rice`;
  offersFixture(["create", JSON.stringify({ title, offerType: "GROUP_BUY", status: "LIVE", minimumCommitments: 3, quantityPerMember: 2 })]);
  const member = await newSignedInPage(browser, USER_A_EMAIL);
  try {
    await openOffersMarketplace(member.page);
    await expect(shown(member.page, "Group deals", { exact: true })).toBeVisible();
    const card = member.page.getByRole("button", { name: `Group deal: ${title}` });
    await expect(card).toBeVisible();
    await expect(card.getByText("$24.00")).toBeVisible();
    await expect(card.getByText("$18.00")).toBeVisible();
    await expect(card.getByText("Save $6.00", { exact: true })).toBeVisible();
    // The regular price is crossed out, so the saving reads at a glance.
    await expect(card.getByLabel("Regular price $24.00")).toHaveCSS("text-decoration-line", "line-through");
    await expect(card).not.toContainText("%");
    await expect(card).not.toContainText("Your Commons gets");

    await card.click();
    await expect(member.page).toHaveURL(/offer-detail/);
    await expect(shown(member.page, title, { exact: true })).toBeVisible();
    await expect(shown(member.page, "Group price", { exact: true })).toBeVisible();
    await expect(shown(member.page, "$6.00", { exact: true })).toBeVisible();
    await expect(shown(member.page, /No extra fees at checkout/)).toBeVisible();
    await expect(shown(member.page, /Ships to your address/)).toBeVisible();
    // The detail page, not the list, says what the Commons gets.
    await expect(shown(member.page, "Your Commons gets about $1.09 from each one", { exact: true })).toBeVisible();

    // What the member would be charged is exactly the group price times the quantity.
    await expect(shown(member.page, /we'll charge your card \$18\.00/)).toBeVisible();
    await member.page.getByLabel("One more").filter({ visible: true }).click();
    await expect(shown(member.page, /we'll charge your card \$36\.00/)).toBeVisible();

    // Reloading keeps the same numbers.
    await member.page.reload();
    await expect(shown(member.page, "$6.00", { exact: true })).toBeVisible();
  } finally {
    await member.context.close();
  }
});

test("a draft group buy stays hidden until a platform admin publishes it", async ({ browser }) => {
  const title = `${RUN} beans`;
  const { offerId } = offersFixture(["create", JSON.stringify({ title, offerType: "GROUP_BUY", status: "DRAFT" })]);
  const member = await newSignedInPage(browser, USER_A_EMAIL);
  const adminContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const admin = await adminContext.newPage();
  try {
    // A draft isn't shown to members.
    await openOffersMarketplace(member.page);
    await expect(member.page.getByRole("button", { name: `Group deal: ${title}` })).toHaveCount(0);

    // The platform admin publishes it. No steward step.
    await signInAdmin(admin);
    await admin.goto(`${ADMIN_BASE_URL}/portal/admin/commons/${OFFERS_COOP_ID}/offers/${offerId}`);
    await expect(admin.getByRole("heading", { name: title })).toBeVisible({ timeout: 60_000 });
    await admin.getByRole("button", { name: "Publish to members" }).click();
    // A real dialog, not the browser's confirm box.
    const confirm = admin.getByRole("alertdialog", { name: "Publish this group buy?" });
    await expect(confirm).toContainText("Members of this Commons will see it right away");
    await confirm.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(admin.getByText("Published. Members can see it now.")).toBeVisible();
    await expect(admin.getByTestId("offer-status")).toHaveText("Live");

    await openOffersMarketplace(member.page);
    await expect(member.page.getByRole("button", { name: `Group deal: ${title}` })).toBeVisible();
  } finally {
    await member.context.close();
    await adminContext.close();
  }
});

test("every member of the Commons gets the weekly group buys notice, and it opens the marketplace", async ({ browser }) => {
  const title = `${RUN} lentils`;
  offersFixture(["create", JSON.stringify({ title, offerType: "GROUP_BUY", status: "LIVE", minimumCommitments: 3 })]);
  offersFixture(["digest"]);
  const memberA = await newSignedInPage(browser, USER_A_EMAIL);
  const memberB = await newSignedInPage(browser, USER_B_EMAIL);
  try {
    for (const member of [memberA, memberB]) {
      await member.page.goto("/notifications");
      await expect(shown(member.page, "This week's group deals").first()).toBeVisible({ timeout: 30_000 });
      await expect(shown(member.page, new RegExp(`${title}: was \\$24\\.00, now \\$18\\.00\\. Save \\$6\\.00\\. 0 of 3 joined`)).first()).toBeVisible();
    }
    await shown(memberA.page, "This week's group deals").first().click();
    await expect(shown(memberA.page, "Group deals", { exact: true })).toBeVisible({ timeout: 60_000 });
  } finally {
    await memberA.context.close();
    await memberB.context.close();
  }
});

test("the admin group buy form warns when a deal could lose the Commons or Cahootz money", async ({ browser }) => {
  const adminContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const admin = await adminContext.newPage();
  try {
    await signInAdmin(admin);
    await admin.goto(`${ADMIN_BASE_URL}/portal/admin/commons/${OFFERS_COOP_ID}/offers`);
    await admin.getByRole("button", { name: "New group buy" }).click();
    await admin.getByLabel("Regular price ($)").fill("24");
    const vendor = admin.getByLabel("Vendor gets ($ per unit)");
    await expect(vendor).toHaveAccessibleDescription(/What we pay the vendor for each one/);
    // Leaving the member price fills an empty vendor amount by the price rule ($18 - Stripe's ~$0.82 - 20% of the savings).
    await admin.getByLabel("Member price ($)").fill("18");
    await admin.getByLabel("Member price ($)").press("Tab");
    await expect(vendor).toHaveValue("15.47");
    await expect(vendor).toHaveAccessibleDescription(/Filled in from the member price, keeping 20% of the savings/);
    await vendor.fill("15");
    // A deal that covers Stripe's fee says nothing about it.
    const form = admin.getByRole("form", { name: "New group buy" });
    await expect(form.getByRole("alert")).toHaveCount(0);
    await expect(form.getByText(/Stripe/)).toHaveCount(0);
    await expect(form.getByRole("button", { name: "Save draft" })).toBeEnabled();

    // $18.00 - $16.75 leaves $1.25: fine at the usual card fee, not with a pricier card ($1.09).
    await admin.getByLabel("Vendor gets ($ per unit)").fill("16.75");
    await expect(form.getByRole("alert")).toContainText("There isn't enough left to cover Stripe's card fee (up to $1.09 on some cards)");
    await expect(form.getByRole("button", { name: "Save draft" })).toBeDisabled();
  } finally {
    await adminContext.close();
  }
});

test("the admin can publish a new group buy straight from the form, after a dialog", async ({ browser }) => {
  const title = `${RUN} oats`;
  const adminContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const admin = await adminContext.newPage();
  try {
    await signInAdmin(admin);
    await admin.goto(`${ADMIN_BASE_URL}/portal/admin/commons/${OFFERS_COOP_ID}/offers`);
    await admin.getByRole("button", { name: "New group buy" }).click();
    const form = admin.getByRole("form", { name: "New group buy" });
    // A photo can be uploaded (stored in the app's Blob bucket) or pasted as a web address.
    await expect(form.getByRole("button", { name: "Upload a photo" })).toBeVisible();
    await expect(form.getByLabel("Or paste a photo web address")).toBeVisible();
    await form.getByLabel("Vendor", { exact: true }).fill("E2E Corner Market");
    await form.getByLabel("Title members see").fill(title);
    await form.getByLabel("Regular price ($)").fill("24");
    await form.getByLabel("Where the regular price comes from").fill("Posted shelf price");
    await form.getByLabel("Member price ($)").fill("18");
    await form.getByLabel("Member price ($)").press("Tab");
    await expect(form.getByLabel("Vendor gets ($ per unit)")).toHaveValue("15.47");
    await form.getByLabel("Units needed to unlock").fill("10");
    await form.getByLabel("Units that must be paid for").fill("8");
    await form.getByLabel("Last day to commit").fill("2030-01-15T23:59");

    await form.getByRole("button", { name: "Publish", exact: true }).click();
    const confirm = admin.getByRole("alertdialog", { name: "Publish this group buy?" });
    // Going back publishes nothing.
    await confirm.getByRole("button", { name: "Go back" }).click();
    await expect(confirm).toHaveCount(0);
    await form.getByRole("button", { name: "Publish", exact: true }).click();
    await admin.getByRole("alertdialog", { name: "Publish this group buy?" }).getByRole("button", { name: "Publish", exact: true }).click();
    await expect(admin.getByRole("status")).toHaveText(`Published ${title}. Members can see it now.`);
    await expect(admin.getByRole("link", { name: new RegExp(title) })).toContainText("Live");
  } finally {
    await adminContext.close();
  }
});
