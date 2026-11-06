import type { Locator } from "@playwright/test";
import { expect, test } from "@playwright/test";

const MARKETING_BASE_URL = process.env.E2E_MARKETING_BASE_URL;

async function expectProductVisual(card: Locator) {
  const visual = card.locator(".planet-product-card__image");
  await expect(visual).toBeVisible();
  const content = visual.locator("img, .planet-product-card__fallback");
  await expect(content).toHaveCount(1);
  await expect(content).toBeVisible();
}

test("homepage savings math recalculates the member, Commons, and Cahootz amounts", async ({
  page,
}) => {
  test.skip(
    !MARKETING_BASE_URL,
    "Set E2E_MARKETING_BASE_URL to the running apps/web origin.",
  );
  if (!MARKETING_BASE_URL) return;

  await page.goto(new URL("/", MARKETING_BASE_URL).toString());

  // The savings math is folded under the group deals row until someone asks for it.
  const dealMath = page.locator("#deal-math");
  await expect(dealMath).not.toHaveAttribute("open", "");
  await dealMath.getByText("See the savings math on real products").click();
  await expect(dealMath).toHaveAttribute("open", "");

  const calculator = page.getByRole("region", {
    name: "Commons shared-price calculator",
  });
  await expect(calculator).toBeVisible();

  const commonsTabs = calculator.getByRole("tablist", {
    name: "Choose a Commons catalog",
  });
  await expect(commonsTabs.getByRole("tab")).toHaveCount(4);
  await expect(commonsTabs.getByRole("tab")).toHaveText([
    "Planet Commons",
    "Traveler Commons",
    "Family Commons",
    "Blues of America",
  ]);
  await expect(
    commonsTabs.getByRole("tab", { name: "Planet Commons" }),
  ).toHaveAttribute("aria-selected", "true");

  const productCards = calculator.locator(".planet-product-card");
  await expect(productCards).toHaveCount(8);
  for (let index = 0; index < 8; index += 1) {
    const card = productCards.nth(index);
    await card.scrollIntoViewIfNeeded();
    await expectProductVisual(card);
  }

  await expect(
    calculator.getByText("Your savings", { exact: true }).locator(".."),
  ).toContainText("$12.60");

  const coffee = calculator.getByRole("radio", {
    name: /Organic Fair Trade coffee/,
  });
  await calculator
    .getByText("Organic Fair Trade coffee", { exact: true })
    .click();
  await expect(coffee).toBeChecked();
  // Same price rule as real offers: coffee comes in packs of two so the card fee doesn't eat the savings.
  await expect(calculator.getByText("You pay for 2 × 12 oz bag")).toBeVisible();
  await expect(calculator.getByText("$16.69", { exact: true })).toBeVisible();
  await expect(
    calculator.getByText("Your savings", { exact: true }).locator(".."),
  ).toContainText("$7.29");
  await expect(calculator.getByText("Card fee (about)")).toBeVisible();
  await expect(calculator.getByText("$1.01", { exact: true })).toBeVisible();
  await expect(calculator.getByText("$1.02", { exact: true }).first()).toBeVisible();
  await expect(calculator.getByText("18 households")).toBeVisible();
  await expect(calculator.getByText("What that builds")).toBeVisible();
  await expect(
    calculator.getByText("$18.18 goes into the Planet Commons"),
  ).toBeVisible();
  await expect(calculator.getByText("local cleanup supplies")).toBeVisible();

  await commonsTabs.getByRole("tab", { name: "Traveler Commons" }).click();
  await expect(
    commonsTabs.getByRole("tab", { name: "Traveler Commons" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    calculator.getByText("Useful trip essentials", { exact: false }),
  ).toBeVisible();
  await expect(productCards).toHaveCount(4);

  for (let index = 0; index < 4; index += 1) {
    const card = productCards.nth(index);
    await card.scrollIntoViewIfNeeded();
    await expectProductVisual(card);
  }

  await calculator
    .getByText("Rechargeable misting fan", { exact: true })
    .click();
  await expect(
    calculator.getByRole("radio", { name: /Rechargeable misting fan/ }),
  ).toBeChecked();
  await expect(calculator.getByText("$25.37", { exact: true })).toBeVisible();
  await expect(
    calculator.getByText("Your savings", { exact: true }).locator(".."),
  ).toContainText("$8.61");
  await expect(calculator.getByText("$1.20", { exact: true })).toBeVisible();
  await expect(calculator.getByText("Traveler Commons share")).toBeVisible();
  await expect(calculator.getByText("12 travelers")).toBeVisible();
  await expect(
    calculator.getByText("$14.40 goes into the Traveler Commons"),
  ).toBeVisible();

  await commonsTabs.getByRole("tab", { name: "Family Commons" }).click();
  await expect(
    commonsTabs.getByRole("tab", { name: "Family Commons" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(productCards).toHaveCount(4);

  for (let index = 0; index < 4; index += 1) {
    await expectProductVisual(productCards.nth(index));
  }

  const foodContainers = calculator.getByRole("radio", {
    name: /30-piece food container set/,
  });
  await calculator
    .getByText("30-piece food container set", { exact: true })
    .click();
  await expect(foodContainers).toBeChecked();

  await expect(calculator.getByText("$17.15", { exact: true })).toBeVisible();
  await expect(
    calculator.getByText("Your savings", { exact: true }).locator(".."),
  ).toContainText("$1.60");
  await expect(calculator.getByText("$0.30", { exact: true })).toHaveCount(2);
  await expect(calculator.getByText("Family Commons share")).toBeVisible();
  await expect(calculator.getByText("2 households")).toBeVisible();
  await expect(
    calculator.getByText("$0.60 goes into the Family Commons"),
  ).toBeVisible();

  await commonsTabs.getByRole("tab", { name: "Blues of America" }).click();
  await expect(
    commonsTabs.getByRole("tab", { name: "Blues of America" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(productCards).toHaveCount(4);
  await expect(
    calculator.getByText("fair labor, climate responsibility", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(calculator.getByText("Blues of America share")).toBeVisible();
  await expect(
    productCards.getByText("Union-printed reusable tote", { exact: true }),
  ).toBeVisible();
  await expect(
    productCards.getByText("Fair Trade chocolate bar", { exact: true }),
  ).toBeVisible();
  await expect(
    calculator.getByText("$6.65 goes into the Blues of America"),
  ).toBeVisible();
  for (let index = 0; index < 4; index += 1) {
    await expectProductVisual(productCards.nth(index));
  }

  const sharedPurchaseCalculator = page.getByRole("region", {
    name: "See what everyday spending can build.",
  });
  await expect(sharedPurchaseCalculator).toBeVisible();
  await expect(
    page
      .locator("#deal-math")
      .getByRole("region", { name: "See what everyday spending can build." }),
  ).toBeVisible();
  await expect(sharedPurchaseCalculator.locator("input")).toHaveCount(1);
  await expect(
    sharedPurchaseCalculator.getByText(
      "Assumes 24 people making one purchase each.",
      { exact: false },
    ),
  ).toBeVisible();
  // The planning rate is the average Commons share on the deals above, so read it off the page.
  const rateText = await sharedPurchaseCalculator
    .getByText(/Using a [\d.]+% planning rate/)
    .textContent();
  const rateBps = Math.round(
    Number(/Using a ([\d.]+)% planning rate/.exec(rateText ?? "")?.[1]) * 100,
  );
  expect(rateBps).toBeGreaterThan(0);
  const shareFor = (dollars: number) => Math.round((dollars * 100 * rateBps) / 10000);
  const money = (cents: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
  const goalLine = (shareCents: number, targetCents: number) =>
    `${Math.min(100, Math.max(1, Math.round((shareCents / targetCents) * 100)))}% · about ${Math.ceil(targetCents / shareCents)} purchases this size`;
  await expect(
    sharedPurchaseCalculator.locator(
      ".shared-purchase-calculator__result > strong",
    ),
  ).toHaveText(money(shareFor(100_000)));
  await expect(
    sharedPurchaseCalculator.getByText("$4,166.67", { exact: true }),
  ).toBeVisible();
  await expect(
    sharedPurchaseCalculator.getByText("Shared supplies", { exact: true }),
  ).toBeVisible();
  await expect(
    sharedPurchaseCalculator.getByText("Community gathering", { exact: true }),
  ).toBeVisible();
  await expect(
    sharedPurchaseCalculator.getByText("Member emergency reserve", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    sharedPurchaseCalculator.getByText("Commons-owned venture", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    sharedPurchaseCalculator.getByText("Covered by this estimate", {
      exact: true,
    }),
  ).toHaveCount(4);

  await sharedPurchaseCalculator
    .getByLabel("Total amount bought together")
    .fill("2000");

  await expect(
    sharedPurchaseCalculator.locator(
      ".shared-purchase-calculator__result > strong",
    ),
  ).toHaveText(money(shareFor(2000)));
  await expect(
    sharedPurchaseCalculator.getByText("$83.33", { exact: true }),
  ).toBeVisible();
  await expect(
    sharedPurchaseCalculator.getByText("Covered by this estimate", {
      exact: true,
    }),
  ).toBeVisible();
  for (const targetCents of [25_000, 100_000, 500_000]) {
    await expect(
      sharedPurchaseCalculator.getByText(goalLine(shareFor(2000), targetCents), {
        exact: true,
      }),
    ).toBeVisible();
  }

  await page.reload();
  await page.locator("#deal-math").getByText("See the savings math on real products").click();
  await expect(
    page.getByRole("region", { name: "Commons shared-price calculator" }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/group buy/i);

  for (const width of [320, 375, 414, 768]) {
    await page.setViewportSize({ width, height: 932 });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        ),
      )
      .toBe(0);
    for (const tab of await commonsTabs.getByRole("tab").all()) {
      await expect
        .poll(() =>
          tab.evaluate((node) => node.scrollWidth <= node.clientWidth),
        )
        .toBe(true);
    }
  }
});
