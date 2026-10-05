import { expect, test, type Page } from "@playwright/test";
import { USER_A_EMAIL, newSignedInPage } from "./support/auth";

/** Visible text only: Expo Router keeps earlier screens mounted (hidden). */
function shown(page: Page, text: string | RegExp, options?: { exact?: boolean }) {
  return page.getByText(text, options).filter({ visible: true });
}

const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

test("a member sends a proposal by answering three plain questions", async ({ browser }) => {
  const { context, page } = await newSignedInPage(browser, USER_A_EMAIL);
  // Sending runs the AI proposal review (paid model calls, several minutes),
  // which other journeys cover. Here only the form is under test, so the
  // create call is answered locally and the text it would send is checked.
  let sentText = "";
  await page.route("**/trpc/proposal.create**", async (route) => {
    if (route.request().method() === "OPTIONS") return route.continue();
    sentText = JSON.parse(route.request().postData() || "{}").text ?? "";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ result: { data: { id: `prop_e2e_form_${RUN_ID}`, status: "submitted" } } }),
    });
  });

  try {
    await page.goto("/proposals?coopId=cahootz&submit=1");
    await expect(shown(page, "New proposal", { exact: true })).toBeVisible();
    await expect(shown(page, "1. What do you want to do?")).toBeVisible();
    await expect(shown(page, "2. Why does it matter, and who does it help?")).toBeVisible();
    await expect(shown(page, "3. What will it take?")).toBeVisible();
    // The old four-step form's fields are gone.
    await expect(shown(page, /Step \d of 4/)).toHaveCount(0);
    await expect(shown(page, /Problem Statement|Community Benefit|Expected Impact/)).toHaveCount(0);

    // Send stays tappable and lists what's missing.
    const send = page.getByRole("button", { name: "Send proposal" });
    await send.click();
    await expect(shown(page, /Almost there\. To send it:/)).toBeVisible();
    await expect(shown(page, /Say what you want to do/)).toBeVisible();
    expect(sentText).toBe("");

    const idea = `E2E ${RUN_ID} weekly tutoring for kids`;
    await page.getByLabel("What do you want to do?").fill(idea);
    await expect(shown(page, /Almost there/)).toHaveCount(0);
    const firstCategory = page.getByRole("radio").filter({ visible: true }).first();
    const categoryCount = await page.getByRole("radio").filter({ visible: true }).count();
    // Timeline chips are radios too; categories (when the commons has them) come first.
    if (categoryCount > 6) await firstCategory.click();
    await page
      .getByLabel("Why does it matter, and who does it help?")
      .fill("Kids on our block fall behind in reading and need a safe place after school.");
    await page.getByRole("checkbox", { name: "Not sure yet" }).click();
    await page.getByRole("radio", { name: "1-3 months" }).click();

    // Optional detail stays folded until asked for.
    await expect(page.getByLabel("Who will help?")).toHaveCount(0);
    await page.getByRole("button", { name: "Add more detail (optional)" }).click();
    await page.getByLabel("Who will help?").fill("Two retired teachers");

    await send.click();
    await expect(shown(page, "Your proposal was sent")).toBeVisible();
    expect(sentText).toContain(`Proposal Title: ${idea}`);
    expect(sentText).toContain("Why it matters and who it helps: Kids on our block");
    expect(sentText).toContain("Budget Requested: Not sure yet");
    expect(sentText).toContain("Timeline: 1-3 months");
    expect(sentText).toContain("Team: Two retired teachers");
  } finally {
    await context.close();
  }
});
