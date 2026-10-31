import { expect, test } from "@playwright/test";

import { ADMIN_BASE_URL, signInAdmin } from "./support/admin";
import { apiFixture } from "./support/offers";

const RUN = `di${Date.now()}`;
const fixture = (args: string[]) => apiFixture("scripts/e2e-vendor-outreach.ts", args);

test.afterAll(() => {
  fixture(["item-cleanup", `${RUN}a`]);
  fixture(["item-cleanup", `${RUN}b`]);
  fixture(["item-cleanup", `${RUN}c`]);
  fixture(["item-cleanup", `${RUN}d`]);
});

test("an admin reviews a bot-found item, approves it and starts a seller search", async ({ browser }) => {
  const run = `${RUN}a`;
  const item = `E2E ${run} Laundry pods`;
  const { coopId } = fixture(["item-setup", run]);
  const adminContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const admin = await adminContext.newPage();
  try {
    // The bot's item waits for review, with its price evidence and what wasn't checked.
    await signInAdmin(admin);
    await admin.goto(`${ADMIN_BASE_URL}/portal/admin/outreach`);
    await expect(admin.getByRole("heading", { name: "Vendor outreach" })).toBeVisible({ timeout: 60_000 });
    await admin.getByRole("tab", { name: /product ideas/ }).click();
    const card = admin.getByLabel(`Product idea ${item}`);
    await expect(card.getByTestId("item-status")).toHaveText("Needs review");
    // When the bot found it, and a link to the vendor's own page for the deal.
    const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    await expect(card.getByTestId("item-found")).toContainText(`Found ${today}`);
    await expect(card.getByRole("link", { name: "See it on E2E Supplier" })).toHaveAttribute("href", `https://e2e-supplier.test/${run}/laundry-pods`);
    await expect(card.getByTestId("item-goal-fit")).toHaveText("Fits the goals: Helps the goal of cheaper household basics.");
    await expect(card.getByText(/\$12\.17 each/)).toBeVisible();
    await expect(card.getByText(/when 12 people buy together/)).toBeVisible();
    // The suggested deal uses the same price rule as every offer.
    await expect(card.getByTestId("item-suggestion")).toContainText("Suggested deal: $16.29 for 64 pods (save 43%), 12 households to unlock.");
    await expect(card.getByTestId("item-suggestion")).toContainText("Vendor $12.17 · Commons $1.67 · Cahootz $1.68");
    await expect(admin.getByRole("region", { name: "Group Buy pricing" })).toBeVisible();
    await expect(card.getByText(/Not checked: Shipping cost not checked/)).toBeVisible();

    // Approving it, then starting a seller search near the Commons.
    await card.getByRole("button", { name: "Approve" }).click();
    await expect(admin.getByText(`${item} approved for E2E ${run} Families.`)).toBeVisible();
    await expect(card.getByTestId("item-status")).toHaveText("Approved");
    await card.getByRole("button", { name: "Find a seller" }).click();
    await expect(admin.getByText("Add the city or area to search near.")).toBeVisible();
    await card.getByLabel("Search near (city or area)").fill(`E2E Town ${run}`);
    await card.getByLabel("Most emails to send").fill("2");
    await card.getByRole("button", { name: "Find a seller" }).click();
    await expect(admin.getByText(`Sage will look for a seller of ${item} within the hour.`)).toBeVisible();
    await expect(card.getByText("Seller search active. See it under Campaigns.")).toBeVisible();
    await admin.reload();
    await admin.getByRole("tab", { name: /campaigns/ }).click();
    await expect(admin.getByText(`${item} · ${coopId}`)).toBeVisible({ timeout: 60_000 });
    await expect(admin.getByLabel(`Campaign ${item} for ${coopId}`).getByText("You started this seller search from a product idea.")).toBeVisible();
  } finally {
    await adminContext.close();
  }
});

// A separate test, so each stays within the 90-second limit. The fixture approves the
// item and starts its seller search through the same services as the buttons above.
test("a seller says yes to Sage's email, and the Group Buy form fills itself in from the item and the seller", async ({ browser }) => {
  const run = `${RUN}b`;
  const item = `E2E ${run} Laundry pods`;
  const seller = `E2E ${run} Soap Shop`;
  fixture(["item-setup", run]);
  fixture(["item-search", run]);
  const adminContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const vendorContext = await browser.newContext({ viewport: { width: 430, height: 932 } });
  const admin = await adminContext.newPage();
  const vendor = await vendorContext.newPage();
  try {
    // Sage emails the local shop members recommended; its reply page names the item.
    const { token, status } = fixture(["item-sweep", run]);
    expect(status).toBe("SENT");
    await vendor.goto(`${ADMIN_BASE_URL}/v/${token}`);
    await expect(vendor.getByRole("heading", { name: `Hi ${seller}` })).toBeVisible({ timeout: 60_000 });
    await expect(vendor.getByText(new RegExp(`want to buy ${item} together`))).toBeVisible();
    await expect(vendor.getByText(/no app to download and nothing to sign up for/)).toBeVisible();
    await expect(vendor.getByText(/e2e-outreach/)).toHaveCount(0);
    await vendor.getByLabel("Your name").fill("Robin");
    await vendor.getByLabel("Best phone or email").fill("555-0142");
    await vendor.getByRole("button", { name: "Yes, I'm interested" }).click();
    await expect(vendor.getByRole("heading", { name: "Thank you!" })).toBeVisible();

    // The admin starts the Group Buy from the yes, and the form is filled in from the item and the seller.
    await signInAdmin(admin);
    await admin.goto(`${ADMIN_BASE_URL}/portal/admin/outreach`);
    await expect(admin.getByRole("heading", { name: "Vendor outreach" })).toBeVisible({ timeout: 60_000 });
    await admin.getByRole("tab", { name: /businesses/ }).click();
    const business = admin.getByLabel(`Business ${seller}`);
    await expect(business.getByText("Said yes", { exact: true })).toBeVisible({ timeout: 60_000 });
    await business.getByRole("link", { name: `Start the group buy for ${item}` }).click();
    await expect(admin.getByTestId("offer-from-item")).toContainText(`Started from the product idea ${item} (64 pods each), with Robin from ${seller}`, { timeout: 60_000 });
    await expect(admin.getByLabel("Vendor", { exact: true })).toHaveValue(seller);
    await expect(admin.getByLabel("Vendor phone")).toHaveValue("555-0142");
    await expect(admin.getByLabel("Title members see")).toHaveValue(item);
    await expect(admin.getByLabel("Regular price ($)")).toHaveValue("28.89");
    await expect(admin.getByLabel("Member price ($)")).toHaveValue("16.29");
    await expect(admin.getByLabel("Vendor gets ($ per unit)")).toHaveValue("12.17");
    await expect(admin.getByLabel("Commons share of what's left (%)")).toHaveValue("50");
    await expect(admin.getByRole("form", { name: "New group buy" }).getByRole("alert")).toHaveCount(0);
    await expect(admin.getByLabel("Units needed to unlock")).toHaveValue("12");
    await expect(admin.getByLabel("Where the regular price comes from")).toHaveValue(/^E2E Supplier price on \d{4}-\d{2}-\d{2}: https:\/\/e2e-supplier\.test\//);
  } finally {
    await adminContext.close();
    await vendorContext.close();
  }
});

test("a seller search that finds nobody says so and why, and the product idea offers to try again", async ({ browser }) => {
  const run = `${RUN}c`;
  const item = `E2E ${run} Laundry pods`;
  const { coopId } = fixture(["item-setup", run]);
  fixture(["item-search-nowhere", run]);
  // The real sweep: no shop, member recommendation or web result near E2E Nowhere.
  expect(fixture(["item-sweep-empty", run])).toMatchObject({ status: "COMPLETED", endReason: "NOTHING_FOUND_NO_WEB_SEARCH" });
  const adminContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const admin = await adminContext.newPage();
  try {
    await signInAdmin(admin);
    await admin.goto(`${ADMIN_BASE_URL}/portal/admin/outreach`);
    await expect(admin.getByRole("heading", { name: "Vendor outreach" })).toBeVisible({ timeout: 60_000 });
    const campaign = admin.getByLabel(`Campaign ${item} for ${coopId}`);
    await expect(campaign.getByTestId("campaign-status")).toHaveText("found no sellers");
    await expect(campaign.getByTestId("no-sellers")).toContainText(`No shops on Cahootz or member recommendations matched near E2E Nowhere ${run}, and web search didn't run`);

    await admin.getByRole("tab", { name: /product ideas/ }).click();
    const card = admin.getByLabel(`Product idea ${item}`);
    await expect(card.getByTestId("item-no-sellers")).toHaveText("The last seller search found no sellers: nothing turned up, and web search didn't run. Try again below, maybe with a bigger area.");
    await expect(card.getByRole("button", { name: "Find a seller" })).toBeVisible();
  } finally {
    await adminContext.close();
  }
});

test("an admin starts an extra product search from Product ideas, outside the monthly limit, and hears why when it can't run", async ({ browser }) => {
  const run = `${RUN}d`;
  const profile = `E2E ${run} Families`;
  fixture(["item-setup", run]);
  fixture(["item-off-goal", run]);
  const adminContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const admin = await adminContext.newPage();
  try {
    await signInAdmin(admin);
    await admin.goto(`${ADMIN_BASE_URL}/portal/admin/outreach`);
    await expect(admin.getByRole("heading", { name: "Vendor outreach" })).toBeVisible({ timeout: 60_000 });
    await admin.getByRole("tab", { name: /product ideas/ }).click();
    // A find that doesn't fit the Commons' goals is kept, folded away with the reason, until an admin approves it.
    const offGoal = `Product idea E2E ${run} Party cups`;
    const folded = admin.getByRole("group", { name: "Didn't fit the goals" });
    await expect(admin.getByLabel(offGoal)).toBeHidden();
    await folded.getByText(/Didn't fit the goals \(\d+\)/).click();
    const cups = folded.getByLabel(offGoal);
    await expect(cups.getByTestId("item-goal-fit")).toHaveText("Doesn't fit the goals: Single-use plastic works against the goal to waste less.");
    await cups.getByRole("button", { name: "Approve" }).click();
    await expect(admin.getByText(`E2E ${run} Party cups approved for ${profile}.`)).toBeVisible();
    await expect(folded.getByLabel(offGoal)).toHaveCount(0);
    await expect(admin.getByLabel(offGoal).getByTestId("item-status")).toHaveText("Approved");

    const finder = admin.getByRole("region", { name: "Find products" });
    await finder.getByLabel("Profile").selectOption({ label: profile });
    await expect(finder.getByText("0 of 5 scheduled searches used this month. Never searched yet.")).toBeVisible();

    // Changing what the bot looks for on the profile sticks for later searches.
    const brief = finder.getByRole("group", { name: "Edit what it looks for" });
    await brief.getByText("Edit what it looks for").click();
    // Too short a brief is turned down with a plain reason.
    await brief.getByLabel("What to find").fill("Soap");
    await brief.getByRole("button", { name: "Save what it looks for" }).click();
    await expect(admin.getByText("Say what to find in at least a few words.")).toBeVisible();
    await brief.getByLabel("What to find").fill("Find bulk dish soap and laundry basics with public case prices.");
    await brief.getByLabel("Themes (separate with commas)").fill("laundry, E2E dish soap");
    await brief.getByRole("button", { name: "Save what it looks for" }).click();
    await expect(admin.getByText(`Saved. Searches for ${profile} will use this from now on.`)).toBeVisible();
    await admin.reload();
    await admin.getByRole("tab", { name: /product ideas/ }).click();
    await finder.getByLabel("Profile").selectOption({ label: profile });
    await brief.getByText("Edit what it looks for").click();
    await expect(brief.getByLabel("What to find")).toHaveValue("Find bulk dish soap and laundry basics with public case prices.");
    await expect(brief.getByLabel("Themes (separate with commas)")).toHaveValue("laundry, E2E dish soap");
    const hintBox = finder.getByLabel("What to look for this time (optional)");
    await hintBox.fill("E2E bulk dish soap");

    // Turned off after the page loaded: the click reaches the server, which says no without running the bot.
    fixture(["item-discovery-off", run]);
    await finder.getByRole("button", { name: "Find products" }).click();
    await expect(admin.getByText(`Product search is turned off for ${profile}, so it can't run.`)).toBeVisible();
    // A refused start keeps the hint, so it isn't lost.
    await expect(hintBox).toHaveValue("E2E bulk dish soap");

    // With the month's scheduled searches used up, an admin can still search: extras are counted apart.
    fixture(["item-discovery-used", run]);
    await admin.reload();
    await admin.getByRole("tab", { name: /product ideas/ }).click();
    await finder.getByLabel("Profile").selectOption({ label: profile });
    await expect(finder.getByText(/1 of 1 scheduled searches used this month, plus 1 extra started here\. Last search .*: 2 new ideas\./)).toBeVisible({ timeout: 60_000 });
    await expect(finder.getByRole("button", { name: "Find products" })).toBeEnabled();

    // Past searches keep their step-by-step log: how long it took, what it searched and what it found.
    const past = finder.getByRole("group", { name: "Past searches" });
    // An admin's extra search shows what they asked it to look for.
    await past.getByText(/Started here · nothing new/).click();
    await expect(past.getByText("You asked for: E2E bulk dish soap")).toBeVisible();
    await past.getByText(/Scheduled · took 1m 35s · 2 new ideas/).click();
    await expect(past.getByText("1 search · 1 page opened · 1 find noted · 2 returned")).toBeVisible();
    await expect(past.getByText("Searched “E2E bulk laundry pods”")).toBeVisible();
    await expect(past.getByRole("link", { name: `Found E2E ${run} Laundry pods from E2E Supplier` })).toBeVisible();

    // A running search shows how long it's been going and what it's doing, and updates by itself when it ends.
    fixture(["item-discovery-live", run]);
    await admin.reload();
    await admin.getByRole("tab", { name: /product ideas/ }).click();
    await finder.getByLabel("Profile").selectOption({ label: profile });
    const live = finder.getByRole("status", { name: "Search progress" });
    await expect(live.getByText("Searching now")).toBeVisible({ timeout: 60_000 });
    await expect(live.getByTestId("search-elapsed")).toHaveText(/^\d+s so far$/);
    await expect(live.getByText("Searched “E2E party supplies wholesale”")).toBeVisible();
    await expect(finder.getByRole("button", { name: "Find products" })).toBeDisabled();
    fixture(["item-discovery-finish", run]);
    await expect(live).toBeHidden({ timeout: 20_000 });
    await expect(past.getByText(/Started here · took \d+s · 1 new idea/)).toBeVisible();
  } finally {
    await adminContext.close();
  }
});
