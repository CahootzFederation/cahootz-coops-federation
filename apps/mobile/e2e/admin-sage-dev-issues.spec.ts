import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { withExclusiveAccountSetting } from "./support/exclusive";

// Drives the web platform admin portal (E2E_ADMIN_BASE_URL), like admin-sage-outreach.spec.ts. The admin
// email must be on PLATFORM_ADMIN_EMAILS for the web app. Members never see Sage's issue ideas.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const ADMIN_BASE_URL = process.env.E2E_ADMIN_BASE_URL || "http://localhost:3000";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || "e2e-admin@test.cahootz.local";

function fixture(...args: string[]) {
  const output = execFileSync(
    "pnpm",
    ["--silent", "-F", "@cahootz/api", "exec", "tsx", "--import", "./dotenv.config.js", "scripts/e2e-admin.ts", ...args],
    { cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000 },
  );
  const line = output.split("\n").reverse().find((entry) => entry.startsWith("E2E_RESULT "));
  if (!line) throw new Error(`e2e-admin.ts printed no result:\n${output}`);
  return JSON.parse(line.slice("E2E_RESULT ".length));
}

// The playground lists its agents after a fetch, which can take a while on a cold dev server.
async function openIssueIdeas(page: Page) {
  const entry = page.getByRole("button", { name: "Sage issue ideas" });
  await expect(entry).toBeVisible({ timeout: 60_000 });
  await entry.click();
  await expect(page.getByRole("heading", { name: "Sage issue ideas" })).toBeVisible();
}

// A platform admin reviews Sage's issue ideas: a draft the privacy check blocked can't be posted, a test
// draft never reaches the public repo, a dismissed draft stays dismissed, and the weekly/monthly choice sticks.
// The cadence is one platform-wide setting, so the spec holds a lock and puts it back afterwards.
test("a platform admin reviews Sage's issue ideas and sets how often Sage drafts one", async ({ browser }) => withExclusiveAccountSetting("sage-dev-issue-cadence", async () => {
  test.setTimeout(240_000);
  const tag = randomUUID().slice(0, 8);
  const { cadence: previousCadence } = fixture("dev-issue-seed", tag);
  const context = await browser.newContext();
  const admin = await context.newPage();

  try {
    await admin.goto(`${ADMIN_BASE_URL}/portal/admin/login`);
    await admin.getByLabel("Email address").fill(ADMIN_EMAIL);
    await admin.getByRole("button", { name: "Email me a login code" }).click();
    await expect(admin.getByLabel("Login code")).toBeVisible();
    const { code } = fixture("login-code", ADMIN_EMAIL);
    await admin.getByLabel("Login code").fill(code);
    await admin.getByRole("button", { name: "Verify & Sign In" }).click();
    await expect(admin).toHaveURL(/\/portal\/admin(?!\/login)/);

    await admin.getByRole("link", { name: "Agent Playground" }).click();
    await openIssueIdeas(admin);

    const flagged = admin.locator("article", { hasText: `E2E ${tag} flagged idea` });
    await expect(flagged).toContainText("This one can't be posted as written: Names a member or a Commons.", { timeout: 30_000 });
    await expect(flagged.getByRole("button", { name: "Post to GitHub" })).toBeDisabled();

    const clean = admin.locator("article", { hasText: `E2E ${tag} ride board looks empty` });
    await expect(clean).toContainText("What members are running into");
    admin.once("dialog", (dialog) => dialog.accept());
    await clean.getByRole("button", { name: "Post to GitHub" }).click();
    await expect(admin.getByText("Test drafts never go to GitHub.")).toBeVisible();
    await expect(clean.getByText(/· draft$/)).toBeVisible();

    await clean.getByRole("button", { name: "Dismiss" }).click();
    await expect(clean).toContainText("· dismissed");
    await expect(clean.getByRole("button", { name: "Post to GitHub" })).toHaveCount(0);

    const weekly = admin.getByRole("button", { name: "Every week" });
    const monthly = admin.getByRole("button", { name: "Every month" });
    if ((await monthly.getAttribute("aria-pressed")) === "true") {
      await weekly.click();
      await expect(weekly).toHaveAttribute("aria-pressed", "true");
    }
    await monthly.click();
    await expect(admin.getByText("Sage will now draft one issue a month.")).toBeVisible();
    await expect(monthly).toHaveAttribute("aria-pressed", "true");

    await admin.reload();
    await openIssueIdeas(admin);
    await expect(admin.getByRole("button", { name: "Every month" })).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });
    await expect(admin.locator("article", { hasText: `E2E ${tag} ride board looks empty` })).toContainText("· dismissed");
  } finally {
    fixture("dev-issue-cleanup", tag, previousCadence);
    await context.close();
  }
}));
