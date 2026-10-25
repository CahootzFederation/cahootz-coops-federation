import { expect, test } from "@playwright/test";

import { USER_A_EMAIL, USER_B_EMAIL, newSignedInPage } from "./support/auth";
import { offersFixture, openOffersMarketplace, shown, visibleButton } from "./support/offers";

const RUN = `E2E group ${Date.now()}`;

test.afterAll(() => {
  offersFixture(["cleanup", RUN]);
});

async function openOffer(page: import("@playwright/test").Page, title: string) {
  await openOffersMarketplace(page);
  await page.getByRole("button", { name: `Group buy: ${title}` }).click();
  await expect(shown(page, title, { exact: true })).toBeVisible();
}

async function commit(page: import("@playwright/test").Page, vendor = "E2E Second Commons Shop") {
  await page.getByRole("checkbox", { name: `Share my name and phone with ${vendor}` }).filter({ visible: true }).click();
  await visibleButton(page, "Commit").click();
}

test("two members commit without being charged, a reload doesn't double count, and one cancels", async ({ browser }) => {
  const title = `${RUN} flour`;
  offersFixture(["create", JSON.stringify({ title, offerType: "GROUP_BUY", status: "LIVE", minimumCommitments: 3 })]);
  const a = await newSignedInPage(browser, USER_A_EMAIL);
  const b = await newSignedInPage(browser, USER_B_EMAIL);
  try {
    await openOffer(a.page, title);
    await expect(shown(a.page, /You won't be charged now/)).toBeVisible();
    // Committing without agreeing to share contact details is refused with a clear reason.
    await visibleButton(a.page, "Commit").click();
    await expect(shown(a.page, /Tick the box to share your name and phone/)).toBeVisible();
    await commit(a.page);
    await expect(shown(a.page, /You're in. You haven't been charged/)).toBeVisible();
    await expect(shown(a.page, "1 of 3 committed", { exact: true })).toBeVisible();

    await openOffer(b.page, title);
    await commit(b.page);
    await expect(shown(b.page, "2 of 3 committed", { exact: true })).toBeVisible();

    // A reload shows one spot for A, not two.
    await a.page.reload();
    await expect(shown(a.page, "2 of 3 committed", { exact: true })).toBeVisible();
    await expect(shown(a.page, "You're in for 1.", { exact: true })).toBeVisible();
    await expect(visibleButton(a.page, "Commit")).toHaveCount(0);

    await visibleButton(a.page, "Cancel my spot").click();
    await expect(shown(a.page, /Your spot is cancelled. You weren't charged/)).toBeVisible();

    await b.page.reload();
    await expect(shown(b.page, "1 of 3 committed", { exact: true })).toBeVisible();
  } finally {
    await a.context.close();
    await b.context.close();
  }
});

test("members hear when the goal is hit, and can pay once the vendor confirms", async ({ browser }) => {
  const goal = `${RUN} oil`;
  const { offerId: goalId } = offersFixture(["create", JSON.stringify({ title: goal, offerType: "GROUP_BUY", status: "LIVE", minimumCommitments: 2 })]);
  const a = await newSignedInPage(browser, USER_A_EMAIL);
  const b = await newSignedInPage(browser, USER_B_EMAIL);
  try {
    await openOffer(a.page, goal);
    await commit(a.page);
    await openOffer(b.page, goal);
    await commit(b.page);
    await expect(shown(b.page, /that hit the goal/)).toBeVisible();

    await a.page.goto("/notifications");
    await expect(shown(a.page, "Your group buy is happening").first()).toBeVisible();

    // The vendor confirms capacity; members get a window to pay the group price.
    offersFixture(["open-payment", goalId]);
    await openOffer(a.page, goal);
    await expect(visibleButton(a.page, "Pay $18.00")).toBeVisible();
    await expect(shown(a.page, /Pay by .* to keep your spot/)).toBeVisible();
  } finally {
    await a.context.close();
    await b.context.close();
  }
});

test("a group buy that misses its goal by the deadline expires and charges nobody", async ({ browser }) => {
  const expiring = `${RUN} sugar`;
  const { offerId: expiringId } = offersFixture(["create", JSON.stringify({ title: expiring, offerType: "GROUP_BUY", status: "LIVE", minimumCommitments: 5 })]);
  const a = await newSignedInPage(browser, USER_A_EMAIL);
  try {
    await openOffer(a.page, expiring);
    await commit(a.page);
    offersFixture(["close-commitments", expiringId]);
    await a.page.reload();
    await expect(shown(a.page, "Didn't reach its goal. Nobody was charged", { exact: true })).toBeVisible();
    await expect(visibleButton(a.page, /^Pay /)).toHaveCount(0);
    await a.page.goto("/notifications");
    await expect(shown(a.page, `${expiring} didn't happen this time`).first()).toBeVisible();
  } finally {
    await a.context.close();
  }
});
