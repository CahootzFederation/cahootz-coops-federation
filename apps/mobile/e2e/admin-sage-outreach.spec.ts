import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { newSignedInPage, USER_B_EMAIL } from "./support/auth";
import { withExclusiveAccountSetting } from "./support/exclusive";

// Drives the web platform admin portal (E2E_ADMIN_BASE_URL), like admin-commons-ai.spec.ts. The admin
// email must be on PLATFORM_ADMIN_EMAILS for both the web app and the API.
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

// A platform admin opens Sage Weekly Check-in in the Agent Playground, finds a member and sends them a
// check-in now. The member sees it in their Sage conversation, and the admin's history shows it as manual.
// User B is the target because sage-weekly-outreach.spec.ts uses User A's Sage conversation.
// Takes turns with sage-proactive.spec.ts, which also uses B's Sage conversation.
test("a platform admin sends a Sage check-in to a member from the Agent Playground", async ({ browser }) => withExclusiveAccountSetting("user-b-sage-conversation", async () => {
  test.setTimeout(240_000);
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  const member = await newSignedInPage(browser, USER_B_EMAIL);

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
    await admin.getByRole("button", { name: "Sage Weekly Check-in" }).click();
    await expect(admin.getByRole("heading", { name: "Sage Weekly Check-in" })).toBeVisible({ timeout: 60_000 });

    await admin.getByLabel("Find a member").fill(USER_B_EMAIL);
    await admin.getByRole("button", { name: "Search" }).click();
    await admin.getByRole("button", { name: `Send check-in to ${USER_B_EMAIL}` }).click();
    const banner = admin.getByText(/^Sent to .+: “/);
    await expect(banner).toBeVisible({ timeout: 90_000 });
    const sent = ((await banner.textContent()) ?? "").replace(/^Sent to .+?: “/, "").replace(/”$/, "");
    expect(sent.length).toBeGreaterThan(10);

    const row = admin.locator("tbody tr", { hasText: USER_B_EMAIL });
    await expect(row).toContainText("manual");
    await admin.reload();
    await admin.getByRole("button", { name: "Sage Weekly Check-in" }).click();
    await expect(row).toContainText("manual", { timeout: 60_000 });

    // The member gets it in their existing Sage conversation.
    await member.page.goto("/messages");
    const sage = member.page.getByLabel("Conversation with Sage");
    await expect(sage).toContainText(sent.slice(0, 40), { timeout: 30_000 });
    await sage.click();
    await expect(member.page.getByText(sent.slice(0, 40), { exact: false }).last()).toBeVisible();
  } finally {
    fixture("outreach-cleanup", USER_B_EMAIL);
    await adminContext.close();
    await member.context.close();
  }
}));
