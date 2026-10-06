import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { newSignedInPage, USER_A_EMAIL, USER_B_EMAIL } from "./support/auth";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const TEST_CODE = process.env.E2E_LOGIN_CODE || "000000";
// A normal (APPLICATION_REQUIRED) commons User A belongs to and User B
// doesn't, from `pnpm -F @repo/db seed:e2e-marketplace`.
const MARKET_COOP_ID = "e2e-market";
const MARKET_NAME = "E2E Market Commons";
// The body of the pinned welcome post every new family starts with.
const WELCOME_POST = /This is our private family space/;

/**
 * Fixture cleanup only: `apps/api/scripts/e2e-family-commons.ts` deletes the
 * E2E family this spec creates, and the apply-referral state it leaves in
 * the market commons.
 */
function familyFixture(...args: string[]) {
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
      "scripts/e2e-family-commons.ts",
      ...args,
    ],
    { cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000 },
  );
  const line = output
    .split("\n")
    .reverse()
    .find((entry) => entry.startsWith("E2E_RESULT "));
  if (!line) throw new Error(`Family fixture printed no result:\n${output}`);
  return JSON.parse(line.slice("E2E_RESULT ".length));
}

/**
 * Visible text only. Expo Router keeps earlier screens of a stack mounted
 * (hidden), so the same text can exist on a screen underneath.
 */
function shown(page: Page, text: string | RegExp, options?: { exact?: boolean }) {
  return page.getByText(text, options).filter({ visible: true });
}

/** Signs in from the sign-in screen and skips the wizard's intro (if shown) and profile steps. */
async function signInFromSignInScreen(page: Page, email: string) {
  await page.getByPlaceholder("name@email.com").fill(email);
  await page.getByRole("button", { name: "Log in with code" }).click();
  await page.getByPlaceholder("Enter 6-digit code").fill(TEST_CODE);
  await page.getByRole("button", { name: "Verify & Sign In" }).click();

  await expect(page).toHaveURL(/profile-onboarding/);
  // Someone who already saw the intro on this device starts at the profile form.
  const introContinue = page.getByRole("button", { name: "Continue", exact: true });
  const deferProfile = page.getByRole("button", { name: "Do this later" });
  await expect(introContinue.or(deferProfile).first()).toBeVisible();
  if (await introContinue.isVisible()) await introContinue.click();
  await deferProfile.click();
}

/**
 * A fresh browser signed in through the UI and left on the onboarding
 * wizard's last step ("Find your way in"), like a newcomer. The onboarding
 * journeys sign up throwaway accounts (see `newcomerEmail`) rather than the
 * shared releaseclick fixtures, so seating someone in a welcome lounge never
 * disturbs the lounge specs running alongside this file.
 */
async function newcomerAtOnboardingChoices(browser: Browser, email: string) {
  const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
  // Skip the signed-out app-intro carousel so "/?entry=sign-in" opens sign-in.
  await context.addInitScript(() =>
    window.localStorage.setItem("cahootz.hasSeenAnonymousProfileIntro", "true"),
  );
  const page = await context.newPage();
  await page.goto("/?entry=sign-in");
  await signInFromSignInScreen(page, email);
  await expect(shown(page, "Find your way in")).toBeVisible();
  return { context, page };
}

/** Circle View shows the member's own lounge in place of the "join" card. */
async function expectSeatedInWelcomeLounge(page: Page) {
  await page.goto("/");
  await expect(shown(page, /^Welcome Lounge \d+$/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Join a welcome lounge" })).toHaveCount(0);
}

test.describe.configure({ mode: "serial" });

test.describe("family commons", () => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const familyName = `E2E Family ${runId}`;
  const setupFamilyName = `E2E Family Setup ${runId}`;
  const customGoal = `E2E catering ${runId}`;
  const houseRule = `E2E rule ${runId}: no business talk at Sunday dinner.`;
  // A brand-new account, created by signing in with it.
  const generalNewcomer = `e2e-general-${runId}@test.cahootz.local`;

  test.afterAll(() => {
    familyFixture("cleanup", familyName);
    familyFixture("cleanup", setupFamilyName);
    familyFixture("cleanup-referral", MARKET_COOP_ID, USER_B_EMAIL);
    familyFixture("cleanup-newcomers", generalNewcomer);
  });

  test("a steward sets up the family's goals and agreement, can change them while everyone is a steward, and not after", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const steward = await newSignedInPage(browser, USER_A_EMAIL);
    const member = await newSignedInPage(browser, USER_B_EMAIL);

    try {
      // User A starts a private family from the commons directory, and the
      // guided setup walks them through goals and the family agreement.
      await steward.page.goto("/commons");
      await steward.page.getByRole("button", { name: "Start a family" }).click();
      const nameField = steward.page.getByLabel("Family name").filter({ visible: true });
      await expect(shown(steward.page, "Family · step 1 of 3")).toBeVisible();

      // A name is required before moving on.
      await shown(steward.page, "Next: make it concrete", { exact: true }).click();
      await expect(shown(steward.page, "Give your family space a name.")).toBeVisible();

      // Step 1: what the family will build together, from ideas or their own
      // words. Names are unique across every commons, regardless of case; a
      // taken name is caught when the family is created, which comes back here.
      await nameField.fill(MARKET_NAME.toLowerCase());
      await steward.page.getByRole("checkbox", { name: "Keep the family home in the family" }).click();
      await steward.page.getByLabel("Your own goal").fill(customGoal);
      await steward.page.getByRole("button", { name: "Add goal" }).click();
      await expect(steward.page.getByRole("checkbox", { name: customGoal })).toBeChecked();
      await shown(steward.page, "Next: make it concrete", { exact: true }).click();

      // Step 2: targets, timeframes and priority order.
      await expect(shown(steward.page, "Family · step 2 of 3")).toBeVisible();
      await steward.page.getByLabel("Target amount for Keep the family home in the family").fill("6000");
      await steward.page.getByRole("button", { name: "Keep the family home in the family within 1 year" }).click();
      await steward.page.getByLabel(`Target amount for ${customGoal}`).fill("4000");
      await steward.page.getByRole("button", { name: `${customGoal} within 6 months` }).click();
      await steward.page.getByRole("button", { name: `Move ${customGoal} up` }).click();
      // $4,000 over 6 months plus $6,000 over 12.
      await expect(shown(steward.page, "$1,167 a month")).toBeVisible();

      // Priorities start from the order (the first goal highest) and can be
      // set by hand, but only continue once they add up to 100%.
      const customPriority = steward.page.getByLabel(`Priority for ${customGoal}`);
      const homePriority = steward.page.getByLabel("Priority for Keep the family home in the family");
      await expect(customPriority).toHaveValue("67");
      await expect(homePriority).toHaveValue("33");
      await expect(shown(steward.page, "Priorities add up to 100%")).toBeVisible();
      await customPriority.fill("60");
      await homePriority.fill("30");
      await expect(shown(steward.page, "Priorities add up to 90% (needs to be 100%)")).toBeVisible();
      await shown(steward.page, "Next: family agreement", { exact: true }).click();
      await expect(
        shown(steward.page, "Goal priorities add up to 90%. Make them add up to 100% to continue."),
      ).toBeVisible();
      await expect(shown(steward.page, "Family · step 2 of 3")).toBeVisible();
      await homePriority.fill("40");
      await expect(shown(steward.page, "Priorities add up to 100%")).toBeVisible();
      await shown(steward.page, "Next: family agreement", { exact: true }).click();

      // Step 3: the family agreement, previewed before anything is saved.
      await expect(shown(steward.page, "Family · step 3 of 3")).toBeVisible();
      await steward.page.getByLabel("Family mission").fill(`E2E mission ${runId}`);
      await steward.page.getByRole("radio", { name: "3 days" }).click();
      await steward.page.getByRole("radio", { name: "Two-thirds" }).click();
      await steward.page.getByLabel("New house rule").fill(houseRule);
      await steward.page.getByRole("button", { name: "Add rule" }).click();
      await shown(steward.page, "Read the full agreement", { exact: true }).click();
      await expect(shown(steward.page, new RegExp(`1\\. ${customGoal} \\(60%\\): \\$4,000 within 6 months`))).toBeVisible();
      await expect(shown(steward.page, /A family decision stays open for 3 days\./)).toBeVisible();
      await expect(shown(steward.page, /it passes with two-thirds of the votes/)).toBeVisible();
      await expect(shown(steward.page, /is its interim steward until the family elects its stewards/)).toBeVisible();

      await shown(steward.page, "Create family", { exact: true }).click();
      await expect(
        shown(steward.page, `The name "${MARKET_NAME.toLowerCase()}" is already taken. Try another one.`),
      ).toBeVisible();
      await expect(shown(steward.page, "Family · step 1 of 3")).toBeVisible();
      await expect(steward.page).toHaveURL(/create-family/);

      // Fixing the name keeps every other answer.
      await nameField.fill(setupFamilyName);
      await shown(steward.page, "Next: make it concrete", { exact: true }).click();
      await expect(steward.page.getByLabel(`Target amount for ${customGoal}`)).toHaveValue("4000");
      await shown(steward.page, "Next: family agreement", { exact: true }).click();
      await expect(steward.page.getByLabel("Family mission")).toHaveValue(`E2E mission ${runId}`);
      await shown(steward.page, "Create family", { exact: true }).click();
      await expect(steward.page).toHaveURL(/commons-invites\?coopId=family-/);
      const familyPath = new URL(steward.page.url()).searchParams.get("coopId")!;
      await expect(shown(steward.page, "Steward tools")).toBeVisible();

      // While everyone in the family is a steward, a steward can change the
      // setup later. The editor starts from the saved answers.
      await expect(shown(steward.page, /^2 goals and a mission\. Votes stay open 3 days and pass with two-thirds\./)).toBeVisible();
      await steward.page.getByRole("button", { name: "Edit goals and agreement" }).click();
      await expect(shown(steward.page, "Family goals", { exact: true })).toBeVisible();
      await expect(steward.page.getByRole("checkbox", { name: customGoal })).toBeChecked();
      await shown(steward.page, "Next: make it concrete", { exact: true }).click();
      const customTarget = steward.page.getByLabel(`Target amount for ${customGoal}`);
      await expect(customTarget).toHaveValue("4000");
      await expect(steward.page.getByLabel(`Priority for ${customGoal}`)).toHaveValue("60");
      await customTarget.fill("5000");
      await shown(steward.page, "Next: family agreement", { exact: true }).click();
      await expect(steward.page.getByLabel("Family mission")).toHaveValue(`E2E mission ${runId}`);
      await shown(steward.page, "Save changes", { exact: true }).click();
      await expect(steward.page).toHaveURL(new RegExp(`/commons/${familyPath}`));
      await shown(steward.page, "Read full charter →", { exact: true }).click();
      await expect(shown(steward.page, new RegExp(`1\\. ${customGoal} \\(60%\\): \\$5,000 within 6 months`))).toBeVisible();
      await steward.page.reload();
      await shown(steward.page, "Read full charter →", { exact: true }).click();
      await expect(shown(steward.page, new RegExp(`${customGoal} \\(60%\\): \\$5,000 within 6 months`))).toBeVisible();
      await steward.page.goto(`/commons-invites?coopId=${familyPath}`);
      await expect(shown(steward.page, "Steward tools")).toBeVisible();

      // A steward's named invitation, bound to the newcomer's email.
      await steward.page.getByLabel("Their name").fill("Cousin E2E");

      // A invites B by email, and B joins as a member, not a steward. The
      // rules B accepts are the agreement A set up.
      await steward.page.getByLabel("Their name").fill("E2E Setup Cousin");
      await steward.page.getByLabel("Their email").fill(USER_B_EMAIL);
      await shown(steward.page, "Send invitation", { exact: true }).click();
      await expect(shown(steward.page, "Invitation sent.")).toBeVisible();
      await member.page.goto("/");
      await member.page.getByLabel(`Open invitation to ${setupFamilyName}`).click();
      await expect(shown(member.page, new RegExp(`E2E mission ${runId}`))).toBeVisible();
      await expect(shown(member.page, new RegExp(`E2E rule ${runId}: no business talk`))).toBeVisible();
      await member.page.getByRole("checkbox", { name: `I agree to ${setupFamilyName}'s rules` }).click();
      await shown(member.page, `Join ${setupFamilyName}`, { exact: true }).click();
      await expect(member.page).toHaveURL(/\/family-[^/]+\/posts\//);

      // The family's page shows its goals, weighted as A set them.
      await steward.page.goto(`/commons/${familyPath}`);
      await expect(shown(steward.page, "What we're building toward")).toBeVisible();
      await expect(shown(steward.page, customGoal, { exact: true })).toBeVisible();
      await expect(shown(steward.page, "Keep the family home in the family", { exact: true })).toBeVisible();
      await expect(shown(steward.page, "60%", { exact: true })).toBeVisible();
      await expect(shown(steward.page, "40%", { exact: true })).toBeVisible();

      // Now that someone here isn't a steward, stewards can't change the
      // setup on their own anymore.
      await steward.page.getByRole("button", { name: "Edit goals and agreement" }).click();
      await expect(shown(steward.page, "Stewards can't change this anymore")).toBeVisible();
      await expect(shown(steward.page, /^1 person here isn't a steward, so changing the family's goals/)).toBeVisible();
      await expect(shown(steward.page, "Save changes", { exact: true })).toHaveCount(0);
      await steward.page.goto(`/commons-invites?coopId=${familyPath}`);
      await expect(shown(steward.page, /^1 person here isn't a steward/)).toBeVisible();
      await expect(steward.page.getByRole("button", { name: "Edit goals and agreement" })).toHaveCount(0);
    } finally {
      await steward.context.close();
      await member.context.close();
    }
  });

  test("a newcomer who goes to General from onboarding is still seated in a welcome lounge", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const newcomer = await newcomerAtOnboardingChoices(browser, generalNewcomer);

    try {
      await shown(newcomer.page, "Go to General").click();
      await expect(newcomer.page).toHaveURL(/\/cahootz\/posts/);
      await expect(
        newcomer.page.getByRole("textbox", { name: "Share what's happening..." }),
      ).toBeVisible();
      await expectSeatedInWelcomeLounge(newcomer.page);
    } finally {
      await newcomer.context.close();
    }
  });

  test("a forwarded family link only lets someone ask to join", async ({ browser }) => {
    test.setTimeout(240_000);
    const steward = await newSignedInPage(browser, USER_A_EMAIL);
    // A fresh, signed-out browser: someone opening a forwarded link.
    const visitorContext = await browser.newContext({ viewport: { width: 430, height: 932 } });
    const visitor = await visitorContext.newPage();

    try {
      // User A starts a private family and lands on its steward tools.
      await steward.page.goto("/commons");
      await steward.page.getByRole("button", { name: "Start a family" }).click();
      await steward.page.getByLabel("Family name").filter({ visible: true }).fill(familyName);
      await shown(steward.page, "Skip for now and create the family", { exact: true }).click();
      await expect(steward.page).toHaveURL(/commons-invites\?coopId=family-/);
      await expect(shown(steward.page, "Steward tools")).toBeVisible();

      // A steward's shareable link.
      await shown(steward.page, "Create a shareable link").click();
      const link = (await steward.page.getByLabel("Shareable link").textContent())!.trim();
      const invitePath = new URL(link).pathname;
      expect(invitePath).toMatch(/^\/invite\//);

      // Opened signed out: it shows the family and privacy notice, not its members.
      await visitor.goto(invitePath);
      await expect(shown(visitor, `You've been sent a link to ${familyName}`)).toBeVisible();
      await expect(shown(visitor, /This is a private family space/)).toBeVisible();
      await shown(visitor, "Sign in or create an account", { exact: true }).click();

      // After signing in (and the onboarding wizard), the link resumes, and it
      // only lets User B ask to join.
      await signInFromSignInScreen(visitor, USER_B_EMAIL);
      await expect(visitor).toHaveURL(/\/invite\//);
      await expect(shown(visitor, "Request access", { exact: true })).toBeVisible();

      // The link never grants membership: it only sends a request.
      await visitor.getByRole("checkbox", { name: `I agree to ${familyName}'s rules` }).click();
      await visitor
        .getByPlaceholder("Add a note so they know it's you (optional)")
        .fill(`E2E ${runId}: it's your cousin`);
      await shown(visitor, "Request access", { exact: true }).click();
      await expect(shown(visitor, "Request sent")).toBeVisible();
      await visitor.reload();
      await expect(shown(visitor, "Request sent")).toBeVisible();

      // User A reviews and approves the request.
      await steward.page.reload();
      await expect(shown(steward.page, "Requests to join")).toBeVisible();
      await expect(shown(steward.page, `“E2E ${runId}: it's your cousin”`)).toBeVisible();
      await shown(steward.page, "Approve", { exact: true }).click();
      await expect(shown(steward.page, "Requests to join")).toHaveCount(0);

      // Now User B is in.
      await visitor.reload();
      await expect(shown(visitor, `You're already in ${familyName}`)).toBeVisible();
      await shown(visitor, `Open ${familyName}`, { exact: true }).click();
      await expect(shown(visitor, WELCOME_POST)).toBeVisible();
    } finally {
      await steward.context.close();
      await visitorContext.close();
    }
  });

  test("an invitation to a normal commons only invites someone to apply", async ({ browser }) => {
    test.setTimeout(180_000);
    const member = await newSignedInPage(browser, USER_A_EMAIL);
    const invitee = await newSignedInPage(browser, USER_B_EMAIL);

    try {
      await member.page.goto(`/commons/${MARKET_COOP_ID}`);
      await shown(member.page, "Invite", { exact: true }).click();
      await expect(shown(member.page, "Invite someone to apply")).toBeVisible();
      await member.page.getByLabel("Their email").fill(USER_B_EMAIL);
      await shown(member.page, "Invite to apply", { exact: true }).click();
      await expect(shown(member.page, "Invitation sent.")).toBeVisible();

      await invitee.page.goto("/");
      await invitee.page.getByLabel(`Open invitation to ${MARKET_NAME}`).click();
      await expect(
        shown(invitee.page, new RegExp(`invited you to apply to ${MARKET_NAME}`)),
      ).toBeVisible();
      await expect(shown(invitee.page, /This invitation doesn't skip that/)).toBeVisible();
      await shown(invitee.page, `Apply to ${MARKET_NAME}`, { exact: true }).click();

      // The application opens; submitting it leaves them pending, not a member.
      await expect(shown(invitee.page, "Send application", { exact: true })).toBeVisible();
      const phone = invitee.page.getByPlaceholder("Phone");
      if (await phone.isVisible().catch(() => false)) await phone.fill("(555) 010-4242");
      await shown(invitee.page, "Send application", { exact: true }).click();
      await expect(shown(invitee.page, "Application sent")).toBeVisible();
      await shown(invitee.page, "Done", { exact: true }).click();
      await invitee.page.reload();
      await expect(shown(invitee.page, "Application pending").first()).toBeVisible();

      // User A sees their invitation was used for an application.
      await member.page.reload();
      await expect(shown(member.page, "Applied", { exact: true })).toBeVisible();

      // The applicant can take it back.
      await shown(invitee.page, "Withdraw application", { exact: true }).click();
      await expect(shown(invitee.page, "Membership required")).toBeVisible();
    } finally {
      await member.context.close();
      await invitee.context.close();
    }
  });
});
