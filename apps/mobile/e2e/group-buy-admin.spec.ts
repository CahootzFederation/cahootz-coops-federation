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
    await expect(shown(member.page, "Group buys", { exact: true })).toBeVisible();
    const card = member.page.getByRole("button", { name: `Group buy: ${title}` });
    await expect(card).toBeVisible();
    await expect(card.getByText("$24.00")).toBeVisible();
    await expect(card.getByText("$18.00")).toBeVisible();
    await expect(card.getByText("You save $6.00 (25%)")).toBeVisible();

    await card.click();
    await expect(member.page).toHaveURL(/offer-detail/);
    await expect(shown(member.page, title, { exact: true })).toBeVisible();
    await expect(shown(member.page, "Group price", { exact: true })).toBeVisible();
    await expect(shown(member.page, "$6.00 (25%)", { exact: true })).toBeVisible();
    await expect(shown(member.page, /No extra fees at checkout/)).toBeVisible();
    await expect(shown(member.page, /Ships to your address/)).toBeVisible();

    // What the member would be charged is exactly the group price times the quantity.
    await expect(shown(member.page, /we'll charge your card \$18\.00/)).toBeVisible();
    await member.page.getByLabel("One more").filter({ visible: true }).click();
    await expect(shown(member.page, /we'll charge your card \$36\.00/)).toBeVisible();

    // Reloading keeps the same numbers.
    await member.page.reload();
    await expect(shown(member.page, "$6.00 (25%)", { exact: true })).toBeVisible();
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
    await expect(member.page.getByRole("button", { name: `Group buy: ${title}` })).toHaveCount(0);

    // The platform admin publishes it. No steward step.
    await signInAdmin(admin);
    await admin.goto(`${ADMIN_BASE_URL}/portal/admin/commons/${OFFERS_COOP_ID}/offers/${offerId}`);
    await expect(admin.getByRole("heading", { name: title })).toBeVisible({ timeout: 60_000 });
    admin.once("dialog", (dialog) => dialog.accept());
    await admin.getByRole("button", { name: "Publish to members" }).click();
    await expect(admin.getByText("Published. Members can see it now.")).toBeVisible();
    await expect(admin.getByTestId("offer-status")).toHaveText("Live");

    await openOffersMarketplace(member.page);
    await expect(member.page.getByRole("button", { name: `Group buy: ${title}` })).toBeVisible();
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
      await expect(shown(member.page, "This week's group buys").first()).toBeVisible({ timeout: 30_000 });
      await expect(shown(member.page, new RegExp(`${title}: \\$18\\.00, save 25%\\. 0 of 3 joined`)).first()).toBeVisible();
    }
    await shown(memberA.page, "This week's group buys").first().click();
    await expect(shown(memberA.page, "Group buys", { exact: true })).toBeVisible({ timeout: 60_000 });
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
    await admin.getByLabel("Member price ($)").fill("18");
    await admin.getByLabel("Vendor gets ($ per unit)").fill("15");
    await expect(admin.getByTestId("worst-case-split")).toContainText("With a pricier card (Stripe up to $1.09): Commons $0.95, Cahootz $0.96");
    await expect(admin.getByRole("form", { name: "New group buy" }).getByRole("alert")).toHaveCount(0);

    // $18.00 - $16.75 leaves $1.25: fine at the usual card fee, not with a pricier card.
    await admin.getByLabel("Vendor gets ($ per unit)").fill("16.75");
    await expect(admin.getByRole("form", { name: "New group buy" }).getByRole("alert")).toContainText("This deal could lose money. The Commons and Cahootz each need at least $0.10 per unit");
  } finally {
    await adminContext.close();
  }
});
