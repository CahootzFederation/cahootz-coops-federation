import { expect, test } from "@playwright/test";

import { USER_A_EMAIL, USER_B_EMAIL, newSignedInPage } from "./support/auth";
import { withExclusiveAccountSetting } from "./support/exclusive";
import { OFFERS_COOP_ID, offersFixture, openOffersMarketplace, shown, visibleButton } from "./support/offers";

const RUN = `E2E deal ${Date.now()}`;

test.afterAll(() => {
  offersFixture(["cleanup", RUN]);
});

test("a member sees a member deal's regular price, member price and saving, and pays the member price with no markup", async ({ browser }) => {
  const title = `${RUN} rice`;
  offersFixture(["create", JSON.stringify({ title, offerType: "MEMBER_DEAL", status: "LIVE", quantityPerMember: 2 })]);
  const member = await newSignedInPage(browser, USER_A_EMAIL);
  try {
    await openOffersMarketplace(member.page);
    await expect(shown(member.page, "Deals for members", { exact: true })).toBeVisible();
    const card = member.page.getByRole("button", { name: `Member deal: ${title}` });
    await expect(card).toBeVisible();
    await expect(card.getByText("$24.00")).toBeVisible();
    await expect(card.getByText("$18.00")).toBeVisible();
    await expect(card.getByText("You save $6.00 (25%)")).toBeVisible();

    await card.click();
    await expect(member.page).toHaveURL(/offer-detail/);
    await expect(shown(member.page, title, { exact: true })).toBeVisible();
    await expect(shown(member.page, "Member price", { exact: true })).toBeVisible();
    await expect(shown(member.page, "$6.00 (25%)", { exact: true })).toBeVisible();
    await expect(shown(member.page, /No extra fees at checkout/)).toBeVisible();

    // The price shown on the button is exactly the member price times the quantity.
    await expect(visibleButton(member.page, "Pay $18.00")).toBeVisible();
    await member.page.getByLabel("One more").filter({ visible: true }).click();
    await expect(visibleButton(member.page, "Pay $36.00")).toBeVisible();

    // Reloading keeps the same deal and numbers.
    await member.page.reload();
    await expect(shown(member.page, "$6.00 (25%)", { exact: true })).toBeVisible();
  } finally {
    await member.context.close();
  }
});

test("a new deal stays hidden until a steward approves it, and the steward only sees totals", async ({ browser }) =>
  withExclusiveAccountSetting("e2e-offers-steward", async () => {
    const title = `${RUN} beans`;
    offersFixture(["steward", "on"]);
    offersFixture(["create", JSON.stringify({ title, offerType: "MEMBER_DEAL", status: "PENDING_STEWARD" })]);
    const member = await newSignedInPage(browser, USER_A_EMAIL);
    const steward = await newSignedInPage(browser, USER_B_EMAIL);
    try {
      await openOffersMarketplace(member.page);
      await expect(member.page.getByRole("button", { name: `Member deal: ${title}` })).toHaveCount(0);

      await steward.page.goto(`/commons-offers?coopId=${OFFERS_COOP_ID}`);
      const review = steward.page.getByLabel(`Review ${title}`);
      await expect(review).toBeVisible();
      await expect(review.getByText(/Stripe's fee is about \$0\.82, the vendor gets \$15\.00/)).toBeVisible();
      await expect(shown(steward.page, /never who joined or paid/)).toBeVisible();
      await review.getByRole("button", { name: "Approve" }).click();
      await expect(steward.page.getByLabel(`Results for ${title}`)).toBeVisible();
      await expect(steward.page.getByLabel(`Results for ${title}`).getByText(/households/)).toBeVisible();

      await member.page.reload();
      await expect(member.page.getByRole("button", { name: `Member deal: ${title}` })).toBeVisible();
    } finally {
      offersFixture(["steward", "off"]);
      await member.context.close();
      await steward.context.close();
    }
  }));
