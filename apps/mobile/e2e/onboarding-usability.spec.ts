import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { USER_A_EMAIL, newSignedInPage } from "./support/auth";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const TEST_CODE = process.env.E2E_LOGIN_CODE || "000000";
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const APPLICANT_EMAIL = `e2e-applicant-${RUN_ID}@test.cahootz.local`;

/** Visible text only: Expo Router keeps earlier screens mounted (hidden). */
function shown(page: Page, text: string | RegExp, options?: { exact?: boolean }) {
  return page.getByText(text, options).filter({ visible: true });
}

/** Lookup and cleanup for the throwaway applicant (apps/api/scripts/e2e-application-reference.ts). */
function applicationFixture(command: "lookup" | "cleanup", email: string) {
  const output = execFileSync(
    "pnpm",
    [
      "--silent",
      "-F",
      "@cahootz/api",
      "exec",
      "tsx",
      "--import",
      "./dotenv.config.js",
      "scripts/e2e-application-reference.ts",
      command,
      email,
    ],
    { cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000 },
  );
  const line = output
    .split("\n")
    .reverse()
    .find((entry) => entry.startsWith("E2E_RESULT "));
  if (!line) throw new Error(`Application fixture printed no result:\n${output}`);
  return JSON.parse(line.slice("E2E_RESULT ".length));
}

/** Waits past the 5 seconds after which errors used to disappear. */
async function outlastOldErrorTimeout(page: Page) {
  await page.waitForTimeout(6_000);
}

test.describe("onboarding usability", () => {
  test.afterAll(() => {
    applicationFixture("cleanup", APPLICANT_EMAIL);
  });

  test("a returning member signs in from the first welcome screen without seeing the intro again", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/profile-onboarding/);
    await expect(shown(page, "A community app for everyday help and action")).toBeVisible();

    await page.getByRole("button", { name: "I already have an account" }).click();

    // Straight to sign-in, with email and one-time-code autofill turned on.
    const email = page.getByPlaceholder("name@email.com");
    await expect(email).toBeVisible();
    await expect(shown(page, "Sign in", { exact: true })).toBeVisible();
    await expect(shown(page, /No password needed/)).toBeVisible();
    await expect(shown(page, "Common", { exact: true })).toHaveCount(0);
    await expect(email).toHaveAttribute("autocomplete", "email");
    await email.fill(USER_A_EMAIL);
    await page.getByRole("button", { name: "Log in with code" }).click();
    const code = page.getByPlaceholder("Enter 6-digit code");
    await expect(code).toHaveAttribute("autocomplete", "one-time-code");
    await code.fill(TEST_CODE);
    await page.getByRole("button", { name: "Verify & Sign In" }).click();

    // The fixture account hasn't finished its profile, so it lands on the
    // profile form - not back on the intro it already skipped.
    await expect(page).toHaveURL(/profile-onboarding/);
    await expect(shown(page, "Build your profile")).toBeVisible();
    await expect(shown(page, "A community app for everyday help and action")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Continue", exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Do this later" }).click();
    await page.getByRole("button", { name: "Skip for now" }).click();
    await expect(page.getByLabel("Open menu").filter({ visible: true })).toBeVisible();

    // Coming back later doesn't restart the welcome screens.
    await page.reload();
    await expect(page.getByLabel("Open menu").filter({ visible: true })).toBeVisible();
    await expect(page).not.toHaveURL(/profile-onboarding/);
  });

  test("Start using Cahootz says what's missing, and the message stays until the person edits", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(shown(page, "Build your profile")).toBeVisible();

    const start = page.getByRole("button", { name: "Start using Cahootz" });
    await expect(start).toBeEnabled();
    await start.click();

    await expect(shown(page, /Almost there\. To continue:/)).toBeVisible();
    await expect(shown(page, /Write 40 more letters in "Short intro"/)).toBeVisible();
    await expect(shown(page, /Add at least one thing to "Interests"/)).toBeVisible();

    await outlastOldErrorTimeout(page);
    await expect(shown(page, /Almost there\. To continue:/)).toBeVisible();

    // Editing clears it, and the next tap lists only what's still missing.
    await page.getByPlaceholder("music, housing, food, wellness, events").fill("music, gardening");
    await expect(shown(page, /Almost there\. To continue:/)).toHaveCount(0);
    await start.click();
    await expect(shown(page, /Write 40 more letters in "Short intro"/)).toBeVisible();
    await expect(shown(page, /Add at least one thing to "Interests"/)).toHaveCount(0);
  });

  test("the application says what's missing, keeps the message, and shows the saved reference number", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.goto("/");
    await page.getByRole("button", { name: "I already have an account" }).click();
    await shown(page, "Join a Commons", { exact: true }).click();
    await page.getByText("Learn More").filter({ visible: true }).first().click();
    await page.getByText(/^Apply to Join/).filter({ visible: true }).click();

    // Step 1: Continue explains what's missing instead of sitting greyed out.
    await expect(shown(page, /Step 1 of 4/)).toBeVisible();
    const emailField = page.getByPlaceholder("marcus@example.com");
    await expect(emailField).toHaveAttribute("autocomplete", "email");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(shown(page, /Please fill in these to continue:/)).toBeVisible();
    await outlastOldErrorTimeout(page);
    await expect(shown(page, /Please fill in these to continue:/)).toBeVisible();

    await page.getByPlaceholder("Marcus", { exact: true }).fill("E2E");
    await expect(shown(page, /Please fill in these to continue:/)).toHaveCount(0);
    await page.getByPlaceholder("Johnson", { exact: true }).fill(`Applicant ${RUN_ID}`);
    await emailField.fill(APPLICANT_EMAIL);
    await page.getByPlaceholder("(555) 123-4567").fill(`415555${String(Date.now()).slice(-4)}`);
    // Sign-in uses an emailed code, so the application never asks for a password.
    await expect(page.getByPlaceholder("Create a strong password")).toHaveCount(0);
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    // Step 2: answer whatever the commons asks, driven by the list of
    // unanswered questions that Continue now shows.
    await expect(shown(page, /Step 2 of 4/)).toBeVisible();
    for (let attempt = 0; attempt < 12; attempt++) {
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      const missing = shown(page, /Please answer these questions to continue:/);
      if (!(await missing.isVisible().catch(() => false))) break;
      const firstLabel = ((await missing.innerText()).split("\n• ")[1] ?? "").trim();
      expect(firstLabel).not.toBe("");
      const question = page.getByText(firstLabel, { exact: false }).filter({ visible: true }).first();
      const firstChoice = question.locator(
        'xpath=following::*[@role="button" or @role="checkbox" or self::input or self::textarea][1]',
      );
      const tag = await firstChoice.evaluate((el) => el.tagName.toLowerCase());
      if (tag === "input" || tag === "textarea") {
        await firstChoice.fill("E2E answer");
      } else {
        await firstChoice.click();
      }
    }
    await expect(shown(page, /Step 3 of 4/)).toBeVisible();
    await page.getByRole("button", { name: "Skip for Now" }).click();

    // Step 4: Submit is tappable before the boxes are checked and says why it can't go yet.
    await expect(shown(page, /Step 4 of 4/)).toBeVisible();
    const submit = page.getByRole("button", { name: /Submit Application/ });
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(shown(page, /Please finish these before you submit:/)).toBeVisible();
    await expect(shown(page, /Check the box for the Privacy Policy/)).toBeVisible();
    await outlastOldErrorTimeout(page);
    await expect(shown(page, /Please finish these before you submit:/)).toBeVisible();

    for (const box of await page.getByRole("checkbox").filter({ visible: true }).all()) {
      await box.click();
    }
    await expect(shown(page, /Please finish these before you submit:/)).toHaveCount(0);
    await submit.click();

    // The reference shown is the one saved on the application.
    const referenceLine = shown(page, /^Your reference number: APP-[A-Z0-9]{6}$/);
    await expect(referenceLine).toBeVisible({ timeout: 60_000 });
    const shownReference = (await referenceLine.innerText()).replace("Your reference number: ", "").trim();
    const saved = applicationFixture("lookup", APPLICANT_EMAIL);
    expect(saved.referenceCode).toBe(shownReference);
  });

  test("Sage introduces itself as an AI helper and says what waits for a person", async ({ browser }) => {
    const { context, page } = await newSignedInPage(browser, USER_A_EMAIL);
    try {
      await page.goto("/sage");
      await expect(shown(page, "Meet Sage", { exact: true })).toBeVisible();
      await expect(shown(page, /AI helper\. It's a computer program, not a person\./)).toBeVisible();
      await expect(shown(page, "What always waits for a person", { exact: true })).toBeVisible();
      await expect(shown(page, /spending or moving money, changing who is a member/)).toBeVisible();

      // "Got it" shrinks it to one line, remembered on this device.
      await page.getByRole("button", { name: "Got it" }).click();
      await expect(shown(page, "Meet Sage", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "What is Sage?" })).toBeVisible();
      await page.reload();
      await expect(page.getByRole("button", { name: "What is Sage?" })).toBeVisible();
      await expect(shown(page, "Meet Sage", { exact: true })).toHaveCount(0);

      // And it can be opened again.
      await page.getByRole("button", { name: "What is Sage?" }).click();
      await expect(shown(page, "Meet Sage", { exact: true })).toBeVisible();

      // Sage settings always explains it.
      await page.goto("/sage-settings");
      await expect(shown(page, "What always waits for a person", { exact: true })).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
