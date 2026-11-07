import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { newSignedInPage, USER_A_EMAIL, USER_B_EMAIL } from "./support/auth";
import { withExclusiveAccountSetting } from "./support/exclusive";

// A reply Sage holds back in the General feed goes to a Commons admin to approve in the app, instead of
// waiting in the platform admin queue where members never see it. The fixture runs the real Commons
// action agent with a fixed, low-confidence model answer (apps/api/scripts/e2e-sage-held-reply.ts); no
// live model is called.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const COOP_ID = "cahootz";
const SERVER_POLL = { timeout: 30_000, intervals: [250, 500, 1_000] };

function fixture(...args: string[]) {
  const output = execFileSync(
    "pnpm",
    ["--silent", "-F", "@cahootz/api", "exec", "tsx", "--import", "./dotenv.config.js", "scripts/e2e-sage-held-reply.ts", ...args],
    { cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000 },
  );
  const line = output.split("\n").reverse().find((entry) => entry.startsWith("E2E_RESULT "));
  if (!line) throw new Error(`e2e-sage-held-reply.ts printed no result:\n${output}`);
  return JSON.parse(line.slice("E2E_RESULT ".length));
}

/** Expo Router keeps earlier screens mounted (hidden), so match visible text only. */
function shown(page: Page, text: string | RegExp) {
  return page.getByText(text).locator("visible=true").first();
}

async function openAlerts(page: Page) {
  await page.goto("/");
  await page.getByLabel("Alerts", { exact: true }).locator("visible=true").first().click();
}

// Being a Commons admin is account-wide: while B holds the role, other journeys' held replies would go to B too.
test("a reply Sage holds back goes to a Commons admin, and approving it posts it", async ({ browser }) => withExclusiveAccountSetting("commons-admin-role", async () => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const member = await newSignedInPage(browser, USER_A_EMAIL);
  const admin = await newSignedInPage(browser, USER_B_EMAIL);
  let postId = "-";
  let grantedRole = "0";

  try {
    // Fixture: B is a Commons admin, A asks a question, and Sage drafts a reply it isn't sure enough to post.
    const seeded = fixture("seed", runId, COOP_ID, USER_A_EMAIL, USER_B_EMAIL);
    postId = seeded.postId;
    grantedRole = seeded.grantedRole ? "1" : "0";
    expect(seeded.actionId, JSON.stringify(seeded)).toBeTruthy();
    expect(seeded.reviewerIsAdmin, JSON.stringify(seeded)).toBe(true);
    const url = `/${COOP_ID}/posts/${postId}`;

    // 1. The member sees their question, with no Sage reply yet.
    await member.page.goto(url);
    await expect(shown(member.page, `E2E ${runId}: Does anyone know where we can borrow folding tables`)).toBeVisible();
    await expect(member.page.getByText(seeded.reply)).toHaveCount(0);

    // 2. The admin gets the alert, opens it, and sees exactly what Sage would post.
    await expect(async () => {
      await openAlerts(admin.page);
      await expect(shown(admin.page, "Sage has a suggestion for you")).toBeVisible({ timeout: 3_000 });
    }).toPass(SERVER_POLL);
    await shown(admin.page, "Sage has a suggestion for you").click();
    await expect(admin.page).toHaveURL(new RegExp(`/sage/${seeded.actionId}`));
    await expect(shown(admin.page, "Sage recommends commenting")).toBeVisible();
    await expect(shown(admin.page, seeded.reply)).toBeVisible();
    await expect(shown(admin.page, "Approving posts this comment as Sage on that post. It will not speak for you.")).toBeVisible();

    // 3. The admin approves.
    await admin.page.getByRole("button", { name: "Approve" }).click();
    await expect(admin.page.getByRole("button", { name: "Approve" })).toHaveCount(0);

    // 4. The member reloads and sees Sage's reply on their question.
    await expect(async () => {
      await member.page.goto(url);
      await expect(shown(member.page, seeded.reply)).toBeVisible({ timeout: 3_000 });
    }).toPass(SERVER_POLL);
    await expect(member.page.getByText(seeded.reply).locator("visible=true")).toHaveCount(1);
  } finally {
    fixture("cleanup", postId, COOP_ID, USER_B_EMAIL, grantedRole);
    await member.context.close();
    await admin.context.close();
  }
}, 180_000));
