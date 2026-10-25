import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { USER_A_EMAIL, newSignedInPage, skipOnboardingWizard } from "./support/auth";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const TEST_CODE = process.env.E2E_LOGIN_CODE || "000000";
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const PROFILE_EMAIL = `e2e-applicant-profile-${RUN_ID}@test.cahootz.local`;
const APPLICANT_EMAIL = `e2e-applicant-${RUN_ID}@test.cahootz.local`;

/** Visible text only: Expo Router keeps earlier screens mounted (hidden). */
function shown(page: Page, text: string | RegExp, options?: { exact?: boolean }) {
  return page.getByText(text, options).filter({ visible: true });
}

async function contrastRatio(foreground: Locator, background: Locator) {
  const [foregroundColor, backgroundColor] = await Promise.all([
    foreground.evaluate((element) => getComputedStyle(element).color),
    background.evaluate((element) => getComputedStyle(element).backgroundColor),
  ]);
  const luminance = (value: string) => {
    const [red, green, blue] = value
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map((channel) => Number(channel) / 255)
      .map((channel) =>
        channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
      );
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const foregroundLuminance = luminance(foregroundColor);
  const backgroundLuminance = luminance(backgroundColor);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
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
    applicationFixture("cleanup", PROFILE_EMAIL);
  });

  test("a returning member verifies email and skips completed onboarding", { tag: "@smoke" }, async ({
    page,
  }) => {
    await page.goto("/?entry=sign-in");


    // Straight to sign-in, with email and one-time-code autofill turned on.
    const email = page.getByPlaceholder("name@email.com");
    await expect(email).toBeVisible();
    await expect(shown(page, "Continue to Cahootz", { exact: true })).toBeVisible();
    await expect(shown(page, /No password needed/)).toBeVisible();
    await expect(shown(page, "Common", { exact: true })).toHaveCount(0);
    await expect(email).toHaveAttribute("autocomplete", "email");
    await email.fill(USER_A_EMAIL);
    await page.getByRole("button", { name: "Continue with email" }).click();
    const code = page.getByPlaceholder("Enter 6-digit code");
    await expect(code).toHaveAttribute("autocomplete", "one-time-code");
    await code.fill(TEST_CODE);
    await page.getByRole("button", { name: "Verify and continue" }).click();

    // Finish any outstanding setup once; subsequent visits bypass the wizard.
    await skipOnboardingWizard(page, "if-shown");
    await expect(page.getByLabel("Open menu").filter({ visible: true })).toBeVisible();

    await expect(shown(page, "Build your profile")).toHaveCount(0);
    await expect(shown(page, "Find your people")).toHaveCount(0);
    await page.goto('/profile-onboarding');
    await expect(page.getByLabel('Open menu').filter({ visible: true })).toBeVisible();
    await expect(page).not.toHaveURL(/profile-onboarding/);

    // Coming back later doesn't restart the welcome screens.
    await page.reload();
    await expect(page.getByLabel("Open menu").filter({ visible: true })).toBeVisible();
    await expect(page).not.toHaveURL(/profile-onboarding/);
  });

  test("a dark-mode device keeps the app's supported light theme and readable sign-in controls", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.addInitScript(() => document.documentElement.classList.add("dark"));
    await page.goto("/?entry=sign-in");
    await expect(page.locator("html")).not.toHaveClass(/dark/);

    const email = page.getByPlaceholder("name@email.com");
    const label = shown(page, "Email address", { exact: true });
    const card = page.getByTestId("login-form-card");
    const submit = page.getByRole("button", { name: "Continue with email" });
    const submitText = shown(page, "Continue with email", { exact: true });

    await expect(email).toBeVisible();
    await expect(label).toBeVisible();
    await expect(card).toBeVisible();
    await expect(submit).toBeVisible();
    expect(await contrastRatio(label, card)).toBeGreaterThan(2);
    expect(await contrastRatio(submitText, submit)).toBeGreaterThan(2);
  });

  test("signed-out onboarding links require email verification", async ({ page }) => {
    await page.goto("/profile-onboarding?step=commons");
    await expect(page.getByPlaceholder("name@email.com")).toBeVisible();
    await expect(shown(page, "Welcome to Cahootz", { exact: true })).toHaveCount(0);
    await expect(shown(page, "Find your people", { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByPlaceholder("name@email.com")).toBeVisible();
  });

  test("Start using Cahootz says what's missing, and the message stays until the person edits", async ({ page }) => {
    await page.goto("/?entry=sign-in");
    await page.getByPlaceholder("name@email.com").fill(PROFILE_EMAIL);
    await page.getByRole("button", { name: "Continue with email" }).click();
    await page.getByPlaceholder("Enter 6-digit code").fill(TEST_CODE);
    await page.getByRole("button", { name: "Verify and continue" }).click();
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

  test("the commons application explains missing answers and preserves its submitted state", async ({ page }) => {
    await page.goto("/?entry=sign-in");
    await page.getByPlaceholder("name@email.com").fill(APPLICANT_EMAIL);
    await page.getByRole("button", { name: "Continue with email" }).click();
    await page.getByPlaceholder("Enter 6-digit code").fill(TEST_CODE);
    await page.getByRole("button", { name: "Verify and continue" }).click();
    await page.getByRole("button", { name: "Do this later" }).click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByRole("button", { name: "Explore commons" }).click();
    await page.getByRole("button", { name: "View E2E Market Commons details" }).click();
    await page.getByRole("button", { name: "Apply to join", exact: true }).click();
    await shown(page, "Send application", { exact: true }).click();
    await expect(shown(page, /Please answer:.*Phone/)).toBeVisible();
    await outlastOldErrorTimeout(page);
    await expect(shown(page, /Please answer:.*Phone/)).toBeVisible();
    await page.getByPlaceholder("Full name").fill(`E2E Applicant ${RUN_ID}`);
    await page.getByPlaceholder("Phone", { exact: true }).fill(`415${String(Date.now()).slice(-7)}`);
    await shown(page, "Send application", { exact: true }).click();
    await expect(shown(page, "Application sent", { exact: true })).toBeVisible();
    await shown(page, "Done", { exact: true }).click();
    await page.reload();
    await expect(shown(page, "Application pending", { exact: true }).first()).toBeVisible();
  });

  test("Sage introduces itself as an AI helper and says what waits for a person", async ({ browser }) => {
    const { context, page } = await newSignedInPage(browser, USER_A_EMAIL);
    try {
      await page.goto("/sage");
      await expect(shown(page, "Meet Sage", { exact: true })).toBeVisible();
      await expect(shown(page, /Sage is AI, not a person\./)).toBeVisible();
      await expect(shown(page, "What always waits for a person", { exact: true })).toBeVisible();
      await expect(shown(page, "What Sage remembers", { exact: true })).toBeVisible();
      await expect(shown(page, /spending or moving money, changing who is a member/)).toBeVisible();
      // The full card must not push the suggestion tabs under the bottom navigation.
      await page.getByRole("tab", { name: "Following" }).filter({ visible: true }).click();
      await page.getByRole("tab", { name: "Needs you" }).filter({ visible: true }).click();

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
      // There it starts folded down to the one-liner; "How Sage works" opens the rest.
      await page.goto("/sage-settings");
      await expect(shown(page, /Sage is AI, not a person\./)).toBeVisible();
      await page.getByRole("button", { name: "How Sage works" }).click();
      await expect(shown(page, "What always waits for a person", { exact: true })).toBeVisible();
    } finally {
      await context.close();
    }
  });
});


test("restoring a saved session never exposes the public welcome or sign-in form", async ({ browser }) => {
  const { page, context } = await newSignedInPage(browser, USER_A_EMAIL);
  let releaseSession!: () => void;
  const sessionGate = new Promise<void>((resolve) => { releaseSession = resolve; });
  try {
    await page.route("**/trpc/user.getOnboardingProgress", async (route) => {
      await sessionGate;
      await route.continue();
    });
    const sessionRequest = page.waitForRequest("**/trpc/user.getOnboardingProgress");
    await page.goto("/");
    await sessionRequest;
    await expect(page.getByRole("progressbar").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue", exact: true })).toHaveCount(0);
    await expect(page.getByPlaceholder("name@email.com")).toHaveCount(0);
    await expect(page.getByRole("tablist", { name: "Main navigation" })).toHaveCount(0);
    releaseSession();
    await expect(page.getByLabel("Open menu")).toBeVisible();
    await expect(page.getByRole("tablist", { name: "Main navigation" })).toBeVisible();
  } finally {
    releaseSession();
    await context.close();
  }
});
