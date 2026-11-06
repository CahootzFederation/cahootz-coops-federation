import { expect, test, type Page } from "@playwright/test";

import { newSignedInPage as signInOnly, USER_A_EMAIL, USER_B_EMAIL } from "./support/auth";
import { sessionTokenFor, trpc } from "./support/welcome-lounge";

// Commons Street: members can turn on a walkable street for the Commons tab in
// their account settings (it's off by default, so Commons opens on Circle
// View). The first journey flips that switch through the real settings UI.
// The rest turn the street on for their own browser as fixture setup, then
// use the street's list (the same one screen-reader users get) to reach
// places, since the map itself is a drawing.

const STREET_VIEW_KEY = "cahootz.streetView";

async function newSignedInPage(...args: Parameters<typeof signInOnly>) {
  const signedIn = await signInOnly(...args);
  await signedIn.context.addInitScript((key) => window.localStorage.setItem(key, "on"), STREET_VIEW_KEY);
  await signedIn.page.reload();
  return signedIn;
}

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

test("Commons opens on circles until a member turns on the street in settings, and it stays after a reload", async ({ browser }) => {
  const { context, page } = await signInOnly(browser, USER_A_EMAIL);
  const streetSwitch = page.getByRole("switch", { name: "Commons street" });
  const circles = page.getByText("Welcome In", { exact: true }).filter({ visible: true });
  const street = page.getByLabel(/^Map of the street/);
  try {
    await page.evaluate((key) => window.localStorage.removeItem(key), STREET_VIEW_KEY);
    await page.goto("/?coopId=cahootz");
    await expect(circles).toBeVisible();
    await expect(street).toHaveCount(0);

    await page.getByRole("tab", { name: "You" }).click();
    await expect(streetSwitch).toHaveAttribute("aria-checked", "false");
    await expect(page.getByText(/Right now Commons opens on your circles\./)).toBeVisible();
    await streetSwitch.click();
    await expect(streetSwitch).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText(/Commons opens on a street you can walk around\./)).toBeVisible();

    await page.getByRole("tab", { name: "Commons" }).click();
    await expect(street).toBeVisible();
    await page.reload();
    await expect(street).toBeVisible();

    // Turning it back off brings the circles back.
    await page.getByRole("tab", { name: "You" }).click();
    await expect(streetSwitch).toHaveAttribute("aria-checked", "true");
    await streetSwitch.click();
    await expect(streetSwitch).toHaveAttribute("aria-checked", "false");
    await page.getByRole("tab", { name: "Commons" }).click();
    await expect(circles).toBeVisible();
    await expect(street).toHaveCount(0);
  } finally {
    await page.evaluate((key) => window.localStorage.removeItem(key), STREET_VIEW_KEY).catch(() => undefined);
    await context.close();
  }
});

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

test("with the street on, going into a circle and back home always returns to the street, and turning it off returns to circles", async ({ browser }) => {
  const { context, page } = await newSignedInPage(browser, USER_A_EMAIL);
  const street = page.getByLabel(/^Map of the street/);
  const composer = page.getByRole("textbox", { name: "Share what's happening..." });
  const circles = page.getByText("Welcome In", { exact: true }).filter({ visible: true });
  try {
    await page.goto("/?coopId=cahootz");
    await expect(street).toBeVisible();
    const switcherLabel = await page.getByLabel(/^Switch commons\. Currently /).first().getAttribute("aria-label");
    const commonsName = switcherLabel!.replace("Switch commons. Currently ", "");

    // Street -> Circle Hall -> General. Tapping the selected Commons tab keeps
    // the circle open, and so does a reload.
    await openStreetPlace(page, "Visit Circle Hall");
    await page.getByLabel("Open General", { exact: true }).click();
    await expect(composer).toBeVisible();
    const circleUrl = page.url();
    await page.getByLabel("Commons", { exact: true }).click();
    await expect(page).toHaveURL(circleUrl);
    await expect(composer).toBeVisible();
    await page.reload();
    await expect(composer).toBeVisible();

    // The circle's drawer Home goes back to the street, not the circles screen.
    await page.getByLabel("Open menu").filter({ visible: true }).click();
    await page.getByLabel(`Go home to ${commonsName} circles`).filter({ visible: true }).click();
    await expect(street).toBeVisible();
    await expect(composer).toHaveCount(0);

    // Board and back to Commons lands on the street.
    await page.getByRole("tab", { name: "Board" }).click();
    await expect(page.getByRole("tab", { name: "Board" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("Find your way around", { exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Commons" }).click();
    await expect(street).toBeVisible();

    // Inside the Circle Hall, open a circle, then the drawer's Commons row
    // goes to the street too. Only one tab bar is ever on screen.
    await openStreetPlace(page, "Visit Circle Hall");
    await page.getByLabel("Go inside Circle Hall").click();
    await expect(circles).toBeVisible();
    await page.getByText("General", { exact: true }).filter({ visible: true }).click();
    await expect(composer).toBeVisible();
    await page.getByLabel("Open menu").filter({ visible: true }).click();
    await page.getByLabel(`View ${commonsName} circles`).click();
    await expect(street).toBeVisible();
    await expect(page.getByLabel("Commons", { exact: true })).toHaveCount(1);

    // Turning the street off from inside a circle: the next trip home shows circles.
    await openStreetPlace(page, "Visit Circle Hall");
    await page.getByLabel("Open General", { exact: true }).click();
    await expect(composer).toBeVisible();
    await page.getByRole("tab", { name: "You" }).click();
    const streetSwitch = page.getByRole("switch", { name: "Commons street" });
    await expect(streetSwitch).toHaveAttribute("aria-checked", "true");
    await streetSwitch.click();
    await expect(streetSwitch).toHaveAttribute("aria-checked", "false");
    await page.getByRole("tab", { name: "Commons" }).click();
    await expect(street).toHaveCount(0);
    if (await composer.isVisible().catch(() => false)) {
      await page.getByLabel("Open menu").filter({ visible: true }).click();
      await page.getByLabel(`Go home to ${commonsName} circles`).filter({ visible: true }).click();
    }
    await expect(circles).toBeVisible();
    await expect(street).toHaveCount(0);
    await expect(page.getByLabel("Back to the street")).toHaveCount(0);
  } finally {
    await page.evaluate((key) => window.localStorage.removeItem(key), STREET_VIEW_KEY).catch(() => undefined);
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

const HINT = "Tap a house, building or person to visit.";

async function mapScale(page: Page) {
  const transform = await page.getByTestId("street-map-layer").getAttribute("transform");
  const match = /scale\(([\d.]+)/.exec(transform ?? "");
  return match ? Number(match[1]) : NaN;
}

test("the map zooms in and out with its buttons, stays on screen when dragged, and Show me brings you back", async ({ browser }) => {
  const { context, page } = await newSignedInPage(browser, USER_A_EMAIL);
  try {
    await page.goto("/?coopId=cahootz");
    await expect(page.getByLabel(/^Map of the street/)).toBeVisible();
    const sign = page.getByText("Town Hall", { exact: true });
    await expect(sign).toBeVisible();
    const before = (await sign.boundingBox())!;
    await expect.poll(() => mapScale(page)).toBe(1);

    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await expect.poll(() => mapScale(page)).toBeGreaterThan(1.4);
    await expect.poll(async () => (await sign.boundingBox())!.width).toBeGreaterThan(before.width * 1.3);

    // Zoom stops at its limits.
    for (let n = 0; n < 8; n++) await page.getByRole("button", { name: "Zoom out", exact: true }).click();
    await expect.poll(() => mapScale(page)).toBe(0.6);

    // Drag the map far away: part of it stays on screen, and the drag doesn't open anything.
    const map = page.getByLabel(/^Map of the street/);
    const box = (await map.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 3000, cy + 3000, { steps: 12 });
    await page.mouse.up();
    await expect(page.getByLabel("Close", { exact: true })).toHaveCount(0);
    // The middle of the drawn street (not just an empty corner of it) still reaches into the screen.
    await expect
      .poll(async () => {
        const m = await page.getByTestId("street-map-layer").boundingBox();
        if (!m) return false;
        const inner = { x0: m.x + m.width / 4, x1: m.x + (3 * m.width) / 4, y0: m.y + m.height / 4, y1: m.y + (3 * m.height) / 4 };
        return inner.x0 < box.x + box.width - 40 && inner.x1 > box.x + 40 && inner.y0 < box.y + box.height - 40 && inner.y1 > box.y + 40;
      })
      .toBe(true);

    const { mine } = await myStreet(page);
    const you = page.getByTestId(`street-walker-${mine.user.id}`);
    await page.getByRole("button", { name: "Show me on the street", exact: true }).click();
    await expect
      .poll(async () => {
        const b = await you.boundingBox();
        return b ? Math.abs(b.x + b.width / 2 - cx) : Infinity;
      })
      .toBeLessThan(60);
  } finally {
    await context.close();
  }
});

test("a first-visit hint shows on the map until you open a place, and stays gone", async ({ browser }) => {
  const { context, page } = await newSignedInPage(browser, USER_A_EMAIL);
  try {
    await page.goto("/?coopId=cahootz");
    // Fixture: start as a first-time visitor on this device.
    await page.evaluate(() => window.localStorage.removeItem("cahootz.streetHintSeen"));
    await page.reload();
    await expect(page.getByText(HINT)).toBeVisible();

    await openStreetPlace(page, "Visit Town Hall");
    await expect(page.getByRole("heading", { name: "Town Hall" })).toBeVisible();
    await page.getByLabel("Close", { exact: true }).click();
    await expect(page.getByLabel(/^Map of the street/)).toBeVisible();
    await expect(page.getByText(HINT)).toHaveCount(0);

    await page.reload();
    await expect(page.getByText(/^Welcome to /)).toBeVisible();
    await expect(page.getByText(HINT)).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("people out on the street open their own card, Sage too", async ({ browser }) => {
  const a = await newSignedInPage(browser, USER_A_EMAIL);
  const b = await newSignedInPage(browser, USER_B_EMAIL);
  try {
    const { mine: aLot } = await myStreet(a.page);
    await a.page.goto("/?coopId=cahootz");
    await expect(a.page.getByText(/^Welcome to /)).toBeVisible();

    await b.page.goto("/?coopId=cahootz");
    await b.page.getByLabel("Open the list").click();
    // Sage strolls the street too, and its card leads to a chat.
    await b.page.getByRole("button", { name: "Say hi to Sage", exact: true }).click();
    await expect(b.page.getByRole("heading", { name: "Sage", exact: true })).toBeVisible();
    await expect(b.page.getByRole("button", { name: "Chat with Sage" })).toBeVisible();

    await b.page.getByLabel("Open the list").click();
    const sayHi = b.page.getByRole("button", { name: `Say hi to ${aLot.user.name}`, exact: true });
    await expect(sayHi).toBeVisible({ timeout: 20_000 });
    await sayHi.click();
    await expect(b.page.getByRole("heading", { name: aLot.user.name, exact: true })).toBeVisible();
    await expect(b.page.getByText("Out on the street now", { exact: true })).toBeVisible();
    await expect(b.page.getByLabel(`Knock on ${aLot.user.name}'s door`)).toBeVisible();
    await expect(b.page.getByRole("button", { name: "Send a message" })).toBeVisible();
    await b.page.getByRole("button", { name: "View profile" }).click();
    await expect(b.page).toHaveURL(new RegExp(`/people/`));
  } finally {
    await a.context.close();
    await b.context.close();
  }
});
