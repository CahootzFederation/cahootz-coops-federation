import { expect, test } from "@playwright/test";

import { USER_A_EMAIL, USER_B_EMAIL, newSignedInPage } from "./support/auth";
import { withExclusiveAccountSetting } from "./support/exclusive";
import { offersFixture, openOffersMarketplace, shown, visibleButton } from "./support/offers";

const RUN = `E2E group ${Date.now()}`;
const VENDOR = "E2E Corner Market";
// Saved cards and addresses belong to the account, so journeys that change them take turns.
const CARD_LOCK = "saved-card-and-address";

test.afterAll(() => {
  offersFixture(["cleanup", RUN]);
});

type Page = import("@playwright/test").Page;

async function openOffer(page: Page, title: string) {
  await openOffersMarketplace(page);
  await page.getByRole("button", { name: `Group buy: ${title}` }).click();
  await expect(shown(page, title, { exact: true })).toBeVisible();
}

async function fillAddress(page: Page, name: string) {
  const change = page.getByRole("button", { name: "Change address" }).filter({ visible: true });
  if (await change.count()) await change.click();
  await page.getByLabel("Name for the delivery").filter({ visible: true }).fill(name);
  await page.getByLabel("Street address").filter({ visible: true }).fill("12 E2E Lane");
  await page.getByLabel("City").filter({ visible: true }).fill("Atlanta");
  await page.getByLabel("State").filter({ visible: true }).fill("GA");
  await page.getByLabel("ZIP code").filter({ visible: true }).fill("30310");
}

async function commit(page: Page) {
  await page.getByRole("checkbox", { name: `Share my name, phone and address with ${VENDOR}` }).filter({ visible: true }).click();
  await visibleButton(page, "Commit").click();
}

test("committing asks for each missing piece in plain words, then keeps the address for next time", async ({ browser }) => {
  await withExclusiveAccountSetting(CARD_LOCK, async () => {
    const title = `${RUN} flour`;
    const { offerId } = offersFixture(["create", JSON.stringify({ title, offerType: "GROUP_BUY", status: "LIVE", minimumCommitments: 3 })]);
    offersFixture(["card-reset", USER_A_EMAIL]);
    const a = await newSignedInPage(browser, USER_A_EMAIL);
    try {
      await openOffer(a.page, title);
      await expect(shown(a.page, /You won't be charged now/)).toBeVisible();
      await expect(shown(a.page, /Ships to your address/)).toBeVisible();

      // Each missing piece gets a plain reason: the address, then a card, then the consent.
      await visibleButton(a.page, "Commit").click();
      await expect(shown(a.page, "Add the name for the delivery.", { exact: true })).toBeVisible();
      await fillAddress(a.page, "E2E Member A");
      await a.page.getByLabel("ZIP code").filter({ visible: true }).fill("303");
      await visibleButton(a.page, "Commit").click();
      await expect(shown(a.page, "Use a 5-digit ZIP code.", { exact: true })).toBeVisible();
      await a.page.getByLabel("ZIP code").filter({ visible: true }).fill("30310");
      await expect(visibleButton(a.page, "Add a card")).toBeVisible();
      await visibleButton(a.page, "Commit").click();
      await expect(shown(a.page, /Add a card first. We'll only charge it if the group buy happens/)).toBeVisible();

      // Stand-in for saving a card with Stripe; the card form itself is Stripe's.
      offersFixture(["save-card", USER_A_EMAIL]);
      await a.page.reload();
      await expect(shown(a.page, "Visa ending in 4242", { exact: true })).toBeVisible();
      await fillAddress(a.page, "E2E Member A");
      await visibleButton(a.page, "Commit").click();
      await expect(shown(a.page, /Tick the box to share your name, phone and address/)).toBeVisible();
      await commit(a.page);
      await expect(shown(a.page, /You're in. You haven't been charged/)).toBeVisible();

      // The order carries the address, and the account keeps it for next time.
      const orders = offersFixture(["orders", offerId]) as Array<{ email: string; status: string; shippingAddress: { name: string; postalCode: string } }>;
      expect(orders.find((o) => o.email === USER_A_EMAIL)).toMatchObject({ status: "COMMITTED", shippingAddress: { name: "E2E Member A", postalCode: "30310" } });
      const next = `${RUN} beans`;
      offersFixture(["create", JSON.stringify({ title: next, offerType: "GROUP_BUY", status: "LIVE", minimumCommitments: 3 })]);
      await openOffer(a.page, next);
      await expect(shown(a.page, "E2E Member A, 12 E2E Lane, Atlanta, GA 30310", { exact: true })).toBeVisible();
    } finally {
      await a.context.close();
    }
  });
});

test("two members commit without being charged, a reload doesn't double count, and one cancels", async ({ browser }) => {
  await withExclusiveAccountSetting(CARD_LOCK, async () => {
    const title = `${RUN} rice`;
    offersFixture(["create", JSON.stringify({ title, offerType: "GROUP_BUY", status: "LIVE", minimumCommitments: 3 })]);
    offersFixture(["save-card", USER_A_EMAIL]);
    offersFixture(["save-card", USER_B_EMAIL]);
    const a = await newSignedInPage(browser, USER_A_EMAIL);
    const b = await newSignedInPage(browser, USER_B_EMAIL);
    try {
      await openOffer(a.page, title);
      await fillAddress(a.page, "E2E Member A");
      await commit(a.page);
      await expect(shown(a.page, "1 of 3 committed", { exact: true })).toBeVisible();

      await openOffer(b.page, title);
      await fillAddress(b.page, "E2E Member B");
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
});

test("when the goal is hit, saved cards are charged, and a declined card gets a plain notice and a way to pay", async ({ browser }) => {
  await withExclusiveAccountSetting(CARD_LOCK, async () => {
    const goal = `${RUN} oil`;
    const { offerId: goalId } = offersFixture(["create", JSON.stringify({ title: goal, offerType: "GROUP_BUY", status: "LIVE", minimumCommitments: 2 })]);
    offersFixture(["save-card", USER_A_EMAIL]);
    offersFixture(["save-card", USER_B_EMAIL]);
    const a = await newSignedInPage(browser, USER_A_EMAIL);
    const b = await newSignedInPage(browser, USER_B_EMAIL);
    try {
      await openOffer(a.page, goal);
      await fillAddress(a.page, "E2E Member A");
      await commit(a.page);
      await openOffer(b.page, goal);
      await fillAddress(b.page, "E2E Member B");
      await commit(b.page);
      await expect(shown(b.page, /that hit the goal/)).toBeVisible();

      await a.page.goto("/notifications");
      await expect(shown(a.page, "Your group buy is happening").first()).toBeVisible();

      // An admin closes it early, which charges every saved card. The fixture's stand-in
      // cards can't be charged, so this is the declined-card path.
      offersFixture(["close-early", goalId]);
      await openOffer(a.page, goal);
      // The reason depends on whether the account has a Stripe customer; either way it's plain and says what to do.
      await expect(shown(a.page, /(We didn't have a card saved for you|Your card didn't go through)\. Pay by .* to keep your spot/)).toBeVisible();
      await expect(visibleButton(a.page, "Pay $18.00")).toBeVisible();
      await a.page.goto("/notifications");
      await expect(shown(a.page, `Your payment for ${goal} didn't go through`).first()).toBeVisible();
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });
});

test("a group buy that misses its goal by the deadline expires and charges nobody", async ({ browser }) => {
  await withExclusiveAccountSetting(CARD_LOCK, async () => {
    const expiring = `${RUN} sugar`;
    const { offerId: expiringId } = offersFixture(["create", JSON.stringify({ title: expiring, offerType: "GROUP_BUY", status: "LIVE", minimumCommitments: 5 })]);
    offersFixture(["save-card", USER_A_EMAIL]);
    const a = await newSignedInPage(browser, USER_A_EMAIL);
    try {
      await openOffer(a.page, expiring);
      await fillAddress(a.page, "E2E Member A");
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
});
