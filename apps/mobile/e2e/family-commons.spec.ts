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
  const customGoal = `E2E catering ${runId}`;
  const houseRule = `E2E rule ${runId}: no business talk at Sunday dinner.`;
  // Brand-new accounts, created by signing in with them.
  const invitedNewcomer = `e2e-family-${runId}@test.cahootz.local`;
  const generalNewcomer = `e2e-general-${runId}@test.cahootz.local`;
  let familyPath = "";
  let welcomePostPath = "";

  test.afterAll(() => {
    familyFixture("cleanup", familyName);
    familyFixture("cleanup-referral", MARKET_COOP_ID, USER_B_EMAIL);
    familyFixture("cleanup-newcomers", invitedNewcomer, generalNewcomer);
  });

  test("a member starts a family and a new person they invite by email joins it from onboarding", async ({
    browser,
  }) => {
    test.setTimeout(480_000);
    const steward = await newSignedInPage(browser, USER_A_EMAIL);
    const outsider = await newSignedInPage(browser, USER_B_EMAIL);
    let newcomer: Awaited<ReturnType<typeof newcomerAtOnboardingChoices>> | undefined;

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
      await shown(steward.page, "Next: family agreement", { exact: true }).click();

      // Step 3: the family agreement, previewed before anything is saved.
      await expect(shown(steward.page, "Family · step 3 of 3")).toBeVisible();
      await steward.page.getByLabel("Family mission").fill(`E2E mission ${runId}`);
      await steward.page.getByRole("radio", { name: "3 days" }).click();
      await steward.page.getByRole("radio", { name: "Two-thirds" }).click();
      await steward.page.getByLabel("New house rule").fill(houseRule);
      await steward.page.getByRole("button", { name: "Add rule" }).click();
      await shown(steward.page, "Read the full agreement", { exact: true }).click();
      await expect(shown(steward.page, new RegExp(`1\\. ${customGoal}: \\$4,000 within 6 months`))).toBeVisible();
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
      await nameField.fill(familyName);
      await shown(steward.page, "Next: make it concrete", { exact: true }).click();
      await expect(steward.page.getByLabel(`Target amount for ${customGoal}`)).toHaveValue("4000");
      await shown(steward.page, "Next: family agreement", { exact: true }).click();
      await expect(steward.page.getByLabel("Family mission")).toHaveValue(`E2E mission ${runId}`);
      await shown(steward.page, "Create family", { exact: true }).click();
      await expect(steward.page).toHaveURL(/commons-invites\?coopId=family-/);
      familyPath = new URL(steward.page.url()).searchParams.get("coopId")!;
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
      await customTarget.fill("5000");
      await shown(steward.page, "Next: family agreement", { exact: true }).click();
      await expect(steward.page.getByLabel("Family mission")).toHaveValue(`E2E mission ${runId}`);
      await shown(steward.page, "Save changes", { exact: true }).click();
      await expect(steward.page).toHaveURL(new RegExp(`/commons/${familyPath}`));
      await shown(steward.page, "Read full charter →", { exact: true }).click();
      await expect(shown(steward.page, new RegExp(`1\\. ${customGoal}: \\$5,000 within 6 months`))).toBeVisible();
      await steward.page.reload();
      await shown(steward.page, "Read full charter →", { exact: true }).click();
      await expect(shown(steward.page, new RegExp(`${customGoal}: \\$5,000 within 6 months`))).toBeVisible();
      await steward.page.goto(`/commons-invites?coopId=${familyPath}`);
      await expect(shown(steward.page, "Steward tools")).toBeVisible();

      // A steward's named invitation, bound to the newcomer's email.
      await steward.page.getByLabel("Their name").fill("Cousin E2E");
      await steward.page.getByLabel("Their email").fill(invitedNewcomer);
      await shown(steward.page, "Send invitation", { exact: true }).click();
      await expect(shown(steward.page, "Invitation sent.")).toBeVisible();
      await steward.page.reload();
      await expect(shown(steward.page, "Cousin E2E", { exact: true })).toBeVisible();

      // The family is private: it isn't listed for someone outside it.
      await outsider.page.goto("/commons");
      await expect(shown(outsider.page, "Start a family")).toBeVisible();
      await expect(shown(outsider.page, familyName, { exact: true })).toHaveCount(0);

      // The invited person signs up. Onboarding's last step leads with a
      // button into the family they were invited to, by its name, found just
      // from their signed-in email. The welcome lounge and General are still
      // there, and the family isn't listed a second time as a plain invitation.
      newcomer = await newcomerAtOnboardingChoices(browser, invitedNewcomer);
      const onboarding = newcomer.page;
      await expect(shown(onboarding, "Your family", { exact: true })).toBeVisible();
      const joinFamily = onboarding.getByRole("button", { name: `Join ${familyName}` });
      await expect(joinFamily).toBeVisible();
      await expect(shown(onboarding, /invited you\. You'll see the family's rules before you join\./)).toBeVisible();
      await expect(onboarding.getByRole("button", { name: "Join a welcome lounge" })).toBeVisible();
      await expect(shown(onboarding, "Go to General")).toBeVisible();
      await expect(shown(onboarding, "Explore on my own")).toHaveCount(0);
      await expect(onboarding.getByLabel(`Open invitation to ${familyName}`)).toHaveCount(0);
      await joinFamily.click();
      await expect(
        shown(onboarding, new RegExp(`invited you to join ${familyName}`)),
      ).toBeVisible();
      await expect(shown(onboarding, /This is a private family space/)).toBeVisible();
      // The agreement they accept is the one the steward set up.
      await expect(shown(onboarding, new RegExp(`E2E mission ${runId}`))).toBeVisible();
      await expect(shown(onboarding, new RegExp(`E2E rule ${runId}: no business talk`))).toBeVisible();

      // Joining needs the family's rules accepted first.
      await shown(onboarding, `Join ${familyName}`, { exact: true }).click();
      await expect(shown(onboarding, `Agree to ${familyName}'s rules to continue.`)).toBeVisible();
      await onboarding.getByRole("checkbox", { name: `I agree to ${familyName}'s rules` }).click();
      await shown(onboarding, `Join ${familyName}`, { exact: true }).click();

      // They land on the family's pinned welcome post, and stay in after a reload.
      await expect(onboarding).toHaveURL(new RegExp(`/${familyPath}/posts/`));
      await expect(shown(onboarding, WELCOME_POST)).toBeVisible();
      welcomePostPath = new URL(onboarding.url()).pathname;
      await onboarding.reload();
      await expect(shown(onboarding, WELCOME_POST)).toBeVisible();

      // Choosing their family still seated them in a welcome lounge.
      await expectSeatedInWelcomeLounge(onboarding);

      // They put off their profile, so onboarding comes back on a new
      // device. Now that they're in, it offers to go straight to the family.
      await newcomer.context.close();
      newcomer = await newcomerAtOnboardingChoices(browser, invitedNewcomer);
      await expect(newcomer.page.getByRole("button", { name: `Join ${familyName}` })).toHaveCount(0);
      await newcomer.page.getByRole("button", { name: `Go to ${familyName}` }).click();
      await expect(newcomer.page).toHaveURL(new RegExp(`/${familyPath}/posts`));
      await expect(shown(newcomer.page, WELCOME_POST)).toBeVisible();

      // User A sees the invitation as accepted, and the newcomer as a member.
      await steward.page.reload();
      await expect(shown(steward.page, "Recently accepted")).toBeVisible();
      await expect(shown(steward.page, "Joined", { exact: true })).toBeVisible();
      await expect(shown(steward.page, "No pending invitations.")).toBeVisible();
      await expect(shown(steward.page, "Remove", { exact: true })).toHaveCount(1);

      // The family's page shows its goals, weighted in the order the steward set.
      await steward.page.goto(`/commons/${familyPath}`);
      await expect(shown(steward.page, "What we're building toward")).toBeVisible();
      await expect(shown(steward.page, customGoal, { exact: true })).toBeVisible();
      await expect(shown(steward.page, "Keep the family home in the family", { exact: true })).toBeVisible();
      await expect(shown(steward.page, "67%")).toBeVisible();
      await expect(shown(steward.page, "33%")).toBeVisible();

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
      await outsider.context.close();
      await newcomer?.context.close();
    }
  });

  test("AI name ideas fill the family name with one no commons uses", { tag: "@sage" }, async ({ browser }) => {
    test.setTimeout(180_000);
    const steward = await newSignedInPage(browser, USER_A_EMAIL);
    try {
      await steward.page.goto("/commons");
      await steward.page.getByRole("button", { name: "Start a family" }).click();
      await steward.page
        .getByLabel("Family description")
        .filter({ visible: true })
        .fill(`E2E ${runId}: Sunday dinners at Grandma Ruth's in Memphis, three last names between us`);
      await steward.page.getByRole("button", { name: "Suggest names" }).filter({ visible: true }).click();

      const firstIdea = steward.page.getByRole("button", { name: /^Use the name / }).filter({ visible: true }).first();
      await expect(firstIdea).toBeVisible({ timeout: 90_000 });
      const idea = (await firstIdea.textContent())!.trim();
      await firstIdea.click();
      await expect(steward.page.getByLabel("Family name").filter({ visible: true })).toHaveValue(idea);
      await expect(steward.page.getByRole("button", { name: "More ideas" }).filter({ visible: true })).toBeVisible();
    } finally {
      await steward.context.close();
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

  test("a removed member loses access, and a forwarded family link only lets someone ask to join", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    expect(familyPath, "the first test creates the family").not.toBe("");
    const steward = await newSignedInPage(browser, USER_A_EMAIL);
    // A fresh, signed-out browser: someone opening a forwarded link.
    const visitorContext = await browser.newContext({ viewport: { width: 430, height: 932 } });
    const visitor = await visitorContext.newPage();
    let removed: Awaited<ReturnType<typeof newcomerAtOnboardingChoices>> | undefined;

    try {
      // A steward removes the member who joined in the first test.
      await steward.page.goto(`/commons-invites?coopId=${familyPath}`);
      await expect(shown(steward.page, "Members", { exact: true })).toBeVisible();
      await shown(steward.page, "Remove", { exact: true }).click();
      await shown(steward.page, /^Confirm remove /).click();
      await expect(shown(steward.page, /^Confirm remove /)).toHaveCount(0);
      await steward.page.reload();
      await expect(shown(steward.page, "Remove", { exact: true })).toHaveCount(0);

      // Their access ends right away: the family's welcome post is closed to them.
      removed = await newcomerAtOnboardingChoices(browser, invitedNewcomer);
      await shown(removed.page, "Skip for now", { exact: true }).click();
      await removed.page.goto(welcomePostPath);
      await expect(shown(removed.page, "Join this commons to view this post.")).toBeVisible();

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

      // A pending request doesn't open anything.
      await visitor.goto(welcomePostPath);
      await expect(shown(visitor, "Join this commons to view this post.")).toBeVisible();
      await visitor.goBack();

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
      await removed?.context.close();
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
