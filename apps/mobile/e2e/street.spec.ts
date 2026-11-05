import { expect, test, type Page } from "@playwright/test";

import { newSignedInPage, USER_A_EMAIL, USER_B_EMAIL } from "./support/auth";
import { sessionTokenFor, trpc } from "./support/welcome-lounge";

// Commons Street: the Commons tab is a walkable street for signed-in members.
// The map itself is a drawing, so these journeys use the street's list (the
// same one screen-reader users get) to reach places, then the real sheets.

async function openStreetPlace(page: Page, label: string) {
  await page.getByLabel("Open the list").click();
  await page.getByRole("button", { name: label, exact: true }).click();
}

async function myStreet(page: Page) {
  const token = await sessionTokenFor(page);
  const street = await trpc("GET", "street.get", token, { coopId: "cahootz" });
  const mine = street.lots.find((lot: any) => lot.isYou);
  return { token, street, mine };
}

test("a member lands on the street and paints their house, and it stays after a reload", { tag: "@smoke" }, async ({ browser }) => {
  const { context, page } = await newSignedInPage(browser, USER_A_EMAIL);
  const { token, mine } = await myStreet(page);
  const original = { wallColor: mine.wallColor, roofColor: mine.roofColor };
  const nextWall = original.wallColor === "rose" ? { key: "sky", label: "Sky" } : { key: "rose", label: "Rose" };
  try {
    await page.goto("/?coopId=cahootz");
    await expect(page.getByText(/^Welcome to /)).toBeVisible();
    await expect(page.getByLabel(/^Map of the street/)).toBeVisible();
    await expect(page.getByTestId("street-walker-sage")).toBeVisible();
    const sageLabel = page.getByTestId("street-walker-label-sage");
    await expect(sageLabel.getByText("Sage", { exact: true })).toBeVisible();
    // The map has the whole screen until you open something.
    await expect(page.getByLabel("Close", { exact: true })).toHaveCount(0);

    await openStreetPlace(page, "Visit your house");
    await expect(page.getByRole("heading", { name: "Your house" })).toBeVisible();
    await page.getByLabel(`Wall color ${nextWall.label}`).click();
    await expect(page.getByText("Saved. Your neighbors can see it now.")).toBeVisible();

    // The card goes away when you're done with it.
    await page.getByLabel("Close", { exact: true }).click();
    await expect(page.getByRole("heading", { name: "Your house" })).toHaveCount(0);

    await page.reload();
    await expect(page.getByText(/^Welcome to /)).toBeVisible();
    await openStreetPlace(page, "Visit your house");
    await expect(page.getByLabel(`Wall color ${nextWall.label}`)).toHaveAttribute("aria-selected", "true");
  } finally {
    await trpc("POST", "street.paint", token, { coopId: "cahootz", ...original }).catch(() => undefined);
    await context.close();
  }
});

test("a member changes how they look on the street, and it stays after a reload", async ({ browser }) => {
  const { context, page } = await newSignedInPage(browser, USER_A_EMAIL);
  const { token, mine } = await myStreet(page);
  const original = mine.user.look;
  const nextShirt = original.shirt === "teal" ? { key: "gold", label: "Gold" } : { key: "teal", label: "Teal" };
  const nextHair = original.hairStyle === "bun" ? { key: "curly", label: "Curly" } : { key: "bun", label: "Bun" };
  try {
    await page.goto("/?coopId=cahootz");
    await openStreetPlace(page, "Visit your house");
    await expect(page.getByRole("heading", { name: "Your look" })).toBeVisible();
    await page.getByLabel(`Shirt ${nextShirt.label}`).click();
    await expect(page.getByText("Saved. That’s how neighbors see you now.")).toBeVisible();
    await page.getByLabel(`Hair ${nextHair.label}`).click();

    await page.reload();
    await openStreetPlace(page, "Visit your house");
    await expect(page.getByLabel(`Shirt ${nextShirt.label}`)).toHaveAttribute("aria-selected", "true");
    await expect(page.getByLabel(`Hair ${nextHair.label}`)).toHaveAttribute("aria-selected", "true");
  } finally {
    await trpc("POST", "street.setLook", token, original).catch(() => undefined);
    await context.close();
  }
});

test("the community board in the middle of the street shows recent posts and opens the Board", async ({ browser }) => {
  const { context, page } = await newSignedInPage(browser, USER_A_EMAIL);
  try {
    await page.goto("/?coopId=cahootz");
    await openStreetPlace(page, "Visit Community Board");
    await expect(page.getByRole("heading", { name: "Community Board" })).toBeVisible();
    await expect(page.getByText(/notes? pinned up this week$/)).toBeVisible();
    await page.getByLabel("See the whole board").click();
    await expect(page.getByText(/^Community board · /)).toBeVisible();
  } finally {
    await context.close();
  }
});

test("Circle Hall on the street lists every circle, opens one, and leads inside", async ({ browser }) => {
  const { context, page } = await newSignedInPage(browser, USER_A_EMAIL);
  try {
    await page.goto("/?coopId=cahootz");
    await openStreetPlace(page, "Visit Circle Hall");
    await expect(page.getByRole("heading", { name: "Circle Hall" })).toBeVisible();
    await expect(page.getByText(/circles? meets? here · You're in \d+/)).toBeVisible();
    await expect(page.getByText("Your circles", { exact: true }).filter({ visible: true })).toBeVisible();

    // Search narrows the list, and a search with no match says so.
    await page.getByRole("textbox", { name: "Find a circle" }).fill("no-circle-matches-this");
    await expect(page.getByText("No circles match your search.")).toBeVisible();
    await page.getByRole("textbox", { name: "Find a circle" }).fill("Gen");
    await page.getByLabel("Open General", { exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Share what's happening..." })).toBeVisible();

    // The full circles screen is still one tap away.
    await page.goto("/?coopId=cahootz");
    await openStreetPlace(page, "Visit Circle Hall");
    await page.getByLabel("Go inside Circle Hall").click();
    await expect(page.getByText("Welcome In")).toBeVisible();
    await expect(page.getByText("General", { exact: true })).toBeVisible();

    await page.getByLabel("Back to the street").click();
    await expect(page.getByText(/^Welcome to /)).toBeVisible();
  } finally {
    await context.close();
  }
});

test("two neighbors see each other out on the street, and a knock reaches the other", async ({ browser }) => {
  const a = await newSignedInPage(browser, USER_A_EMAIL);
  const b = await newSignedInPage(browser, USER_B_EMAIL);
  try {
    const { mine: aLot } = await myStreet(a.page);
    const { mine: bLot } = await myStreet(b.page);

    // A opens the street, which checks A in as out on the street.
    await a.page.goto("/?coopId=cahootz");
    await expect(a.page.getByText(/^Welcome to /)).toBeVisible();

    // B sees A out now (the street refreshes every few seconds) and knocks.
    await b.page.goto("/?coopId=cahootz");
    await expect(b.page.getByText(/^Welcome to /)).toBeVisible();
    const aWalker = b.page.getByTestId(`street-walker-${aLot.user.id}`);
    await expect(aWalker).toBeVisible({ timeout: 20_000 });
    const aWalkerLabel = b.page.getByTestId(`street-walker-label-${aLot.user.id}`);
    await expect(aWalkerLabel.getByText(aLot.user.name, { exact: true })).toBeVisible();
    await b.page.getByLabel("Open the list").click();
    const aOut = b.page.getByRole("button", { name: `Visit ${aLot.user.name}, out now`, exact: true });
    await expect(aOut).toBeVisible({ timeout: 20_000 });
    await aOut.click();
    await expect(b.page.getByRole("heading", { name: `${aLot.user.name}'s house` })).toBeVisible();
    await expect(b.page.getByText("Out on the street now", { exact: false })).toBeVisible();
    await b.page.getByLabel(`Knock on ${aLot.user.name}'s door`).click();

    const knocked = b.page.getByText(`You knocked. ${aLot.user.name} will see that you stopped by.`);
    const tooSoon = b.page.getByText("You knocked a little while ago. Give them a bit, or send a message instead.");
    await expect(knocked.or(tooSoon)).toBeVisible();

    // Either way, A has a knock from B in Alerts: this one, or one from an
    // earlier run within the last 30 minutes (one knock per neighbor per 30
    // minutes is the rule, so a quick rerun is told to wait).
    await a.page.getByRole("tab", { name: "Alerts", exact: true }).click();
    await expect(a.page.getByText(`${bLot.user.name} stopped by your house.`).first()).toBeVisible();
  } finally {
    await a.context.close();
    await b.context.close().catch(() => undefined);
  }
});
