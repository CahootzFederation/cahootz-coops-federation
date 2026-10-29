import { expect, test } from "@playwright/test";

import { apiFixture } from "./support/offers";

const MARKETING_BASE_URL = process.env.E2E_MARKETING_BASE_URL;
const RUN = `${Date.now()}`;
const APP_STORE_URL = "https://apps.apple.com/us/app/cahootz-commons/id6772781102";
const COMMONS_ID = "e2e-market";
const COMMONS_NAME = "E2E Market Commons";
const fixture = (args: string[]) => apiFixture("scripts/e2e-waitlist.ts", args);

test.afterAll(() => {
  if (MARKETING_BASE_URL) fixture(["cleanup", RUN]);
});

for (const variant of ["community", "group-buy"] as const) {
  test(`${variant} homepage: people join the waitlist for the commons they pick, then get sent to the app`, async ({ page }) => {
    test.skip(!MARKETING_BASE_URL, "Set E2E_MARKETING_BASE_URL to the running apps/web origin.");
    if (!MARKETING_BASE_URL) return;
    const pickedEmail = `e2e-waitlist-${variant}-picked-${RUN}@test.cahootz.local`;
    const otherEmail = `e2e-waitlist-${variant}-other-${RUN}@test.cahootz.local`;
    const otherPlace = `E2E town ${variant} ${RUN}`;

    await page.goto(new URL(`/?homepage=${variant}`, MARKETING_BASE_URL).toString());

    // The commons list offers the waitlist, not an application.
    const commonsList = page.locator("#find-a-commons");
    await expect(page.getByRole("heading", { name: "Find a commons to join." })).toBeVisible();
    await expect(commonsList.getByRole("link", { name: /^Apply/ })).toHaveCount(0);
    await expect(commonsList.locator('a[href$="/application"]')).toHaveCount(0);
    await expect(page.locator("#join").getByRole("heading", { name: "Join the waitlist" })).toBeVisible();

    // Picking a commons in the list opens the waitlist with that commons chosen.
    await commonsList.getByRole("link", { name: `Join the waitlist for ${COMMONS_NAME}` }).click();
    await expect(page).toHaveURL(new RegExp(`[?&]commons=${COMMONS_ID}#join$`));
    const form = page.getByRole("form", { name: "Join the waitlist" });
    await expect(form).toBeInViewport();
    await expect(form.getByLabel("Which commons are you interested in?")).toHaveValue(COMMONS_ID);
    await form.getByLabel("Name").fill(`E2E Waitlist ${RUN}`);
    await form.getByLabel("Email address").fill(pickedEmail);
    await form.getByRole("button", { name: "Join the waitlist" }).click();

    const joined = page.getByRole("status", { name: "You're on the waitlist" });
    await expect(joined).toContainText(`We'll let you know when ${COMMONS_NAME} opens up.`);
    await expect(joined.getByRole("link", { name: "Get the app" })).toHaveAttribute("href", APP_STORE_URL);

    // Someone whose commons isn't listed has to say where they are.
    await joined.getByRole("button", { name: "Add someone else" }).click();
    await expect(form.getByLabel("Which commons are you interested in?")).toHaveValue("");
    await form.getByLabel("Email address").fill(otherEmail);
    await form.getByRole("button", { name: "Join the waitlist" }).click();
    await expect(form.getByRole("alert")).toHaveText("Pick the commons you're interested in.");
    await form.getByLabel("Which commons are you interested in?").selectOption({ label: "Somewhere else, or start a new one" });
    await form.getByRole("button", { name: "Join the waitlist" }).click();
    await expect(form.getByRole("alert")).toHaveText("Tell us where you are or what you want to start.");
    await form.getByLabel("Where are you, or what do you want to start?").fill(otherPlace);
    await form.getByRole("button", { name: "Join the waitlist" }).click();
    await expect(joined).toContainText(`We'll let you know when ${otherPlace} opens up.`);

    // Both signups were saved with the commons each person named.
    const saved = fixture(["find", RUN]) as Array<{ email: string; coopId: string | null; notes: string | null }>;
    expect(saved.find((entry) => entry.email === pickedEmail)).toMatchObject({
      coopId: COMMONS_ID,
      notes: `Interested coop: ${COMMONS_NAME}`,
    });
    expect(saved.find((entry) => entry.email === otherEmail)).toMatchObject({
      notes: `Interested coop: ${otherPlace}`,
    });
  });
}
