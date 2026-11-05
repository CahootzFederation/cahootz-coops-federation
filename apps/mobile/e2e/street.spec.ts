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

test("new messages in your circles show on the Circle Hall", async ({ browser }) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const a = await newSignedInPage(browser, USER_A_EMAIL);
  const b = await newSignedInPage(browser, USER_B_EMAIL);
  const tokenA = await sessionTokenFor(a.page);
  const tokenB = await sessionTokenFor(b.page);
  let groupId: string | undefined;
  let postId: string | undefined;
  try {
    // Fixture: A makes a private circle, B joins, A posts something new in it.
    const { group } = await trpc("POST", "groups.create", tokenA, { name: `E2E Street Unread ${runId}`, privacy: "private" });
    groupId = group.id;
    await trpc("POST", "groups.joinByCode", tokenB, { inviteCode: group.inviteCode });
    const posted = await trpc("POST", "commons.createPost", tokenA, { coopId: "cahootz", circleId: groupId, content: `E2E street unread ${runId}` });
    postId = posted.post.id;

    await b.page.goto("/?coopId=cahootz");
    await b.page.getByLabel("Open the list").click();
    const hall = b.page.getByRole("button", { name: "Visit Circle Hall", exact: true });
    await expect(hall).toBeVisible();
    await expect(b.page.getByText(/circles · \d+ new$/)).toBeVisible({ timeout: 40_000 });
  } finally {
    if (postId) await trpc("POST", "commons.deletePost", tokenA, { postId }).catch(() => undefined);
    if (groupId) await trpc("POST", "groups.leave", tokenB, { groupId }).catch(() => undefined);
    if (groupId) await trpc("POST", "groups.leave", tokenA, { groupId }).catch(() => undefined);
    await a.context.close();
    await b.context.close();
  }
});

const NO_CONNECTION = "We couldn't reach Cahootz. Check your internet connection and try again.";

test("with no internet the street says so and loads once you're back", async ({ browser }) => {
  const { context, page } = await newSignedInPage(browser, USER_A_EMAIL);
  const streetRequests = "**/trpc/street.get**";
  try {
    // The app itself is already loaded; only the street's data can't get through.
    await page.route(streetRequests, (route) => route.abort("internetdisconnected"));
    await page.goto("/?coopId=cahootz");
    await expect(page.getByText(NO_CONNECTION)).toBeVisible();
    await expect(page.getByLabel(/^Map of the street/)).toHaveCount(0);

    await page.unroute(streetRequests);
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByLabel(/^Map of the street/)).toBeVisible();
    await expect(page.getByText(/^Welcome to /)).toBeVisible();
    await expect(page.getByText(NO_CONNECTION)).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("losing internet mid-visit undoes a paint change, and it saves once you're back", async ({ browser }) => {
  const { context, page } = await newSignedInPage(browser, USER_A_EMAIL);
  const { token, mine } = await myStreet(page);
  const original = { wallColor: mine.wallColor, roofColor: mine.roofColor };
  const next = original.wallColor === "sage" ? { key: "sky", label: "Sky" } : { key: "sage", label: "Sage" };
  const current = { cream: "Cream", sky: "Sky", sage: "Sage", rose: "Rose", white: "White" }[original.wallColor as string]!;
  try {
    await page.goto("/?coopId=cahootz");
    await openStreetPlace(page, "Visit your house");
    await expect(page.getByRole("heading", { name: "Your house" })).toBeVisible();

    await context.setOffline(true);
    await page.getByLabel(`Wall color ${next.label}`).click();
    await expect(page.getByText(NO_CONNECTION)).toBeVisible();
    // The change is undone rather than left looking saved.
    await expect(page.getByLabel(`Wall color ${current}`)).toHaveAttribute("aria-selected", "true");
    // The map stays up while offline, and the next refresh says you're offline.
    await expect(page.getByLabel(/^Map of the street/)).toBeVisible();
    const offlineNote = page.getByText("You're offline. We'll catch up when you're back.");
    await expect(offlineNote).toBeVisible({ timeout: 15_000 });

    await context.setOffline(false);
    // While offline the street retries every 15 seconds; the note clears on the next one that works.
    await expect(offlineNote).toHaveCount(0, { timeout: 25_000 });
    await page.getByLabel(`Wall color ${next.label}`).click();
    await expect(page.getByText("Saved. Your neighbors can see it now.")).toBeVisible();
    await expect(page.getByLabel(`Wall color ${next.label}`)).toHaveAttribute("aria-selected", "true");
  } finally {
    await context.setOffline(false).catch(() => undefined);
    await trpc("POST", "street.paint", token, { coopId: "cahootz", ...original }).catch(() => undefined);
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
