import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { newSignedInPage, USER_A_EMAIL, USER_B_EMAIL } from "./support/auth";

// A member offers their own work in a family ("I'm a master arborist… let me and my team work for you!").
// Sage privately asks them to list it or open a shop. Listing is automatic by default; a steward can turn
// that off and review offers instead. Fixtures run Sage's real post-model path with a fixed model output
// (apps/api/scripts/e2e-self-offer.ts), so no live model is called.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function fixture(...args: string[]) {
  const output = execFileSync(
    "pnpm",
    ["--silent", "-F", "@cahootz/api", "exec", "tsx", "--import", "./dotenv.config.js", "scripts/e2e-self-offer.ts", ...args],
    { cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000 },
  );
  const line = output.split("\n").reverse().find((entry) => entry.startsWith("E2E_RESULT "));
  if (!line) throw new Error(`e2e-self-offer printed no result:\n${output}`);
  return JSON.parse(line.slice("E2E_RESULT ".length));
}

function shown(page: Page, text: string | RegExp) {
  return page.getByText(text).locator("visible=true").first();
}

async function openOffersFromAlert(page: Page) {
  await page.goto("/notifications");
  await shown(page, "Want to offer this to your Commons?").click();
  await expect(page).toHaveURL(/resource-invitations/);
}

test("a member's own offer becomes a listing or a shop, and stewards can require review", { tag: "@sage" }, async ({ browser }) => {
  test.setTimeout(300_000);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const { coopId, name: familyName } = fixture("setup", runId, USER_A_EMAIL, USER_B_EMAIL);
  const member = await newSignedInPage(browser, USER_A_EMAIL);
  const steward = await newSignedInPage(browser, USER_B_EMAIL);
  const firstTitle = `E2E ${runId} tree care and removal`;
  const secondTitle = `E2E ${runId} stump grinding`;

  try {
    // Sage turns the post into a private card for its author.
    expect(fixture("offer", coopId, USER_A_EMAIL, firstTitle).status).toBe("INVITED");
    await openOffersFromAlert(member.page);
    await expect(shown(member.page, firstTitle)).toBeVisible();
    await expect(shown(member.page, familyName)).toBeVisible();

    // Open a shop: the application is prefilled and set to the family the offer came from.
    await member.page.getByLabel(`Open a shop for ${firstTitle}`).locator("visible=true").first().click();
    await expect(member.page).toHaveURL(/apply-store/);
    await expect(member.page.getByPlaceholder("Enter your store name").locator("visible=true").first()).toHaveValue(firstTitle);
    await expect(member.page.getByLabel(`Shop for ${familyName}`).locator("visible=true").first()).toHaveAttribute("aria-checked", "true");
    // Regression: the app sent applications without a commons, so the server refused every one.
    await shown(member.page, "Select Category").click();
    await member.page.getByText("Services", { exact: true }).locator("visible=true").first().click();
    await shown(member.page, "Continue").click();
    await member.page.getByPlaceholder("(555) 555-5555").locator("visible=true").first().fill("5555550100");
    await shown(member.page, "Continue").click();
    await expect(shown(member.page, `Shop in ${familyName}`)).toBeVisible();
    await shown(member.page, "Create Store").click();
    await expect(member.page).toHaveURL(/stripe-onboarding/);
    await member.page.goto("/resource-invitations");

    // List it: by default it's listed right away for the family.
    await member.page.getByLabel(`List ${firstTitle}`).locator("visible=true").first().click();
    await expect(shown(member.page, `Listed in ${familyName}. Members can find it under Commons resources.`)).toBeVisible();
    await steward.page.goto(`/commons-resources?coopId=${coopId}`);
    await expect(shown(steward.page, firstTitle)).toBeVisible();

    // The steward turns auto-listing off.
    const toggle = steward.page.getByLabel("List member offers automatically").locator("visible=true").first();
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(shown(steward.page, "Stewards review each offer before it's listed.")).toBeVisible();
    await steward.page.reload();
    await expect(shown(steward.page, "Stewards review each offer before it's listed.")).toBeVisible();

    // The next offer waits for a steward.
    expect(fixture("offer", coopId, USER_A_EMAIL, secondTitle).status).toBe("INVITED");
    await openOffersFromAlert(member.page);
    await member.page.getByLabel(`List ${secondTitle}`).locator("visible=true").first().click();
    await expect(shown(member.page, `Sent to the stewards of ${familyName}. It will be listed once they approve it.`)).toBeVisible();

    await steward.page.reload();
    await expect(shown(steward.page, "Waiting for review")).toBeVisible();
    await steward.page.getByLabel(`Approve ${secondTitle}`).locator("visible=true").first().click();
    await expect(shown(steward.page, "Waiting for review")).toBeHidden();
    await expect(shown(steward.page, secondTitle)).toBeVisible();

    // Members see both listings, but no steward controls.
    await member.page.goto(`/commons-resources?coopId=${coopId}`);
    await expect(shown(member.page, firstTitle)).toBeVisible();
    await expect(shown(member.page, secondTitle)).toBeVisible();
    await expect(member.page.getByLabel("List member offers automatically")).toHaveCount(0);
  } finally {
    await member.context.close();
    await steward.context.close();
    fixture("cleanup", coopId);
  }
});
