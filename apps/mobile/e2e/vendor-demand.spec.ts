import { expect, test } from "@playwright/test";

import { USER_A_EMAIL, newSignedInPage } from "./support/auth";
import { OFFERS_COOP_ID, apiFixture, openOffersMarketplace, shown, visibleButton } from "./support/offers";

const RUN = `vd${Date.now()}`;
const fixture = (args: string[]) => apiFixture("scripts/e2e-vendor-demand.ts", args);
let addedMember = "false";

test.afterAll(() => {
  fixture(["cleanup", RUN, addedMember]);
});

test("a member recommends a local business for a deal, and it's saved after a reload", async ({ browser }) => {
  const business = `E2E ${RUN} Corner Market`;
  const member = await newSignedInPage(browser, USER_A_EMAIL);
  try {
    await openOffersMarketplace(member.page);
    await member.page.getByRole("button", { name: "Recommend a business" }).click();
    await expect(member.page).toHaveURL(/recommend-business/);

    const send = visibleButton(member.page, "Send recommendation");
    await send.click();
    await expect(shown(member.page, "Add the business's name.")).toBeVisible();

    await member.page.getByLabel("Business name").filter({ visible: true }).fill(business);
    await member.page.getByRole("radio", { name: "groceries" }).filter({ visible: true }).click();
    await send.click();
    await expect(shown(member.page, "Add a website, email or phone so we can reach them.")).toBeVisible();

    await member.page.getByLabel("Website").filter({ visible: true }).fill(`${RUN}.example.com`);
    await send.click();
    await expect(shown(member.page, /Tick the box to confirm/)).toBeVisible();

    await member.page.getByRole("checkbox", { name: /public contact/ }).filter({ visible: true }).click();
    await send.click();
    await expect(shown(member.page, "Thanks! We'll take a look and reach out if they're a good fit.", { exact: true })).toBeVisible();

    await member.page.reload();
    await expect(shown(member.page, "Your recommendations", { exact: true })).toBeVisible();
    await expect(shown(member.page, business, { exact: true })).toBeVisible();
    await expect(shown(member.page, "groceries · Thanks! We'll take a look", { exact: true })).toBeVisible();
  } finally {
    await member.context.close();
  }
});

test("when members keep asking about groceries, Sage asks the whole Commons about a group deal once", async ({ browser }) => {
  const prepared = fixture(["prepare", RUN]);
  addedMember = String(prepared.addedMember);
  expect(prepared.result).toMatchObject({ asked: true, categoryKey: "groceries" });
  expect(fixture(["rerun"]).result.asked).toBe(false);

  const member = await newSignedInPage(browser, USER_A_EMAIL);
  try {
    await member.page.goto(`/${OFFERS_COOP_ID}/posts/${prepared.result.postId}`);
    await expect(shown(member.page, "A better price on groceries?").first()).toBeVisible();
    await expect(shown(member.page, /Nobody pays anything unless a deal comes together/).first()).toBeVisible();

    // Feed cards show the body, not the title. One question, even after the rerun and a reload.
    const question = /Would a group deal on groceries help your household\?/;
    await member.page.goto(`/${OFFERS_COOP_ID}/posts`);
    await expect(shown(member.page, question)).toHaveCount(1);
    await member.page.reload();
    await expect(shown(member.page, question)).toHaveCount(1);
  } finally {
    await member.context.close();
  }
});
