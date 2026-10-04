import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { newSignedInPage, USER_A_EMAIL, USER_B_EMAIL } from "./support/auth";

// The platform admin portal is part of the web app, not the mobile app; this journey drives it at
// E2E_ADMIN_BASE_URL. The admin email must be on PLATFORM_ADMIN_EMAILS for both the web app and the API.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const API_BASE_URL = process.env.E2E_API_BASE_URL || "http://localhost:3001";
const ADMIN_BASE_URL = process.env.E2E_ADMIN_BASE_URL || "http://localhost:3000";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || "e2e-admin@test.cahootz.local";
const COOP_ID = "cahootz";
const LIVE_POLL = { timeout: 120_000, intervals: [1_000, 2_000, 3_000] };

function fixture(script: string, ...args: string[]) {
  const output = execFileSync(
    "pnpm",
    ["--silent", "-F", "@cahootz/api", "exec", "tsx", "--import", "./dotenv.config.js", `scripts/${script}`, ...args],
    { cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000 },
  );
  const line = output.split("\n").reverse().find((entry) => entry.startsWith("E2E_RESULT "));
  if (!line) throw new Error(`${script} printed no result:\n${output}`);
  return JSON.parse(line.slice("E2E_RESULT ".length));
}

async function sessionTokenFor(page: Page) {
  return page.evaluate(() => window.localStorage.getItem("cahootz.sessionToken"));
}

async function trpcPost(pathName: string, sessionToken: string, body: unknown) {
  const response = await fetch(`${API_BASE_URL}/trpc/${pathName}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-session-token": sessionToken },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  expect(response.ok, `${pathName} failed: ${text}`).toBe(true);
  return JSON.parse(text).result.data as any;
}

// A platform admin signs in to the web portal and uses the Commons AI actions page: changes Sage's
// monthly autonomy limits (pause and restore), sees a skipped repeat suggestion, reads and filters
// decision trails, and runs "Analyze now" on a circle, which opens the new trail.
test("a platform admin manages Sage limits, repeats, decision trails and Analyze now", { tag: "@sage" }, async ({ browser }) => {
  test.setTimeout(300_000);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const leader = await newSignedInPage(browser, USER_A_EMAIL);
  const member = await newSignedInPage(browser, USER_B_EMAIL);
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  let circleId: string | undefined;
  let postId: string | undefined;
  let seeded = false;
  const circleName = `E2E Admin circle ${runId}`;

  try {
    const leaderToken = await sessionTokenFor(leader.page);
    const memberToken = await sessionTokenFor(member.page);
    if (!leaderToken || !memberToken) throw new Error("Missing session token after sign-in");

    // Fixture: a circle with new activity, Sage suggestions in it, and a near-duplicate Sage skips.
    const { group } = await trpcPost("groups.create", leaderToken, { name: circleName, privacy: "invite-only" });
    circleId = group.id;
    await trpcPost("groups.joinByCode", memberToken, { inviteCode: group.inviteCode });
    const created = await trpcPost("commons.createPost", memberToken, {
      coopId: COOP_ID, circleId, title: `E2E ${runId} cleanup meetup`, content: `E2E ${runId}: Where should we meet for the cleanup?`, tag: "Need",
    });
    postId = created.post.id;
    await trpcPost("commons.createComment", leaderToken, { postId, content: `E2E ${runId}: The library steps work for me.` });
    fixture("e2e-sage-suggestions.ts", "seed", runId, circleId!, postId!);
    seeded = true;
    fixture("e2e-sage-suggestions.ts", "repeat", runId, circleId!);

    // 1. Sign in through the real admin login page.
    await admin.goto(`${ADMIN_BASE_URL}/portal/admin/login`);
    await admin.getByLabel("Email address").fill(ADMIN_EMAIL);
    await admin.getByRole("button", { name: "Email me a login code" }).click();
    await expect(admin.getByLabel("Login code")).toBeVisible();
    const { code } = fixture("e2e-admin.ts", "login-code", ADMIN_EMAIL);
    await admin.getByLabel("Login code").fill(code);
    await admin.getByRole("button", { name: "Verify & Sign In" }).click();
    await expect(admin).toHaveURL(/\/portal\/admin(?!\/login)/);

    await admin.goto(`${ADMIN_BASE_URL}/portal/admin/commons/${COOP_ID}/ai`);
    await expect(admin.getByRole("heading", { name: "Commons AI actions" })).toBeVisible({ timeout: 60_000 });

    // 2. Autonomy limits: pause Sage with a $0 limit, confirm it persists, then restore the defaults.
    const limits = admin.locator("section", { has: admin.getByText("Sage autonomy limit", { exact: true }) });
    await limits.getByLabel("Monthly USD limit").fill("0");
    await limits.getByRole("button", { name: "Save limits" }).click();
    await expect(limits.getByText("Paused", { exact: true })).toBeVisible();
    await admin.reload();
    await expect(limits.getByText("Paused", { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(limits.getByLabel("Monthly USD limit")).toHaveValue("0");
    await limits.getByLabel("Monthly USD limit").fill("5");
    await limits.getByLabel("Monthly call limit").fill("2000");
    await limits.getByRole("button", { name: "Save limits" }).click();
    await expect(limits.getByText("Active", { exact: true })).toBeVisible();

    // 3. The near-duplicate suggestion shows under Skipped repeats.
    await expect(admin.getByText(`skipped “E2E ${runId} shared tool libraries”`, { exact: false })).toBeVisible();

    // 4. Decision trails: expand the circle's trail, then filter by agent.
    const circleTrail = admin.getByRole("button", { name: new RegExp(`Sent to the circle leader for approval.*${circleName}`) }).first();
    await circleTrail.click();
    await expect(admin.getByText("Not a repeat of a recent suggestion in this circle").first()).toBeVisible();
    await expect(admin.getByText(`E2E ${runId}: Where should we meet for the cleanup?`).first()).toBeVisible();
    const agentFilter = admin.getByLabel("Filter decision trails by agent");
    await agentFilter.selectOption({ label: "Proposal review" });
    await expect(admin.getByRole("button", { name: new RegExp(circleName) }).filter({ hasText: "Circle trends" })).toHaveCount(0);
    await agentFilter.selectOption({ label: "Circle trends" });
    await expect(admin.getByRole("button", { name: new RegExp(`Sent to the circle leader for approval.*${circleName}`) }).first()).toBeVisible();
    await agentFilter.selectOption({ label: "All agents" });

    // 5. Analyze now reads the circle's new activity with the live model and opens the new trail.
    const analyze = admin.getByRole("button", { name: `Analyze ${circleName} now` });
    await expect(analyze).toBeEnabled();
    await analyze.click();
    await expect(async () => {
      await expect(admin.getByText(/A platform admin's "Analyze now"/).first()).toBeVisible({ timeout: 5_000 });
    }).toPass(LIVE_POLL);
    await expect(admin.getByRole("button", { name: `Analyze ${circleName} now` })).toBeDisabled();
  } finally {
    if (seeded) fixture("e2e-sage-suggestions.ts", "cleanup", runId, circleId!);
    fixture("e2e-admin.ts", "reset-limits", COOP_ID);
    const leaderToken = await sessionTokenFor(leader.page).catch(() => null);
    const memberToken = await sessionTokenFor(member.page).catch(() => null);
    if (postId && memberToken) await trpcPost("commons.deletePost", memberToken, { postId }).catch(() => {});
    if (circleId) {
      if (memberToken) await trpcPost("groups.leave", memberToken, { groupId: circleId }).catch(() => {});
      if (leaderToken) await trpcPost("groups.leave", leaderToken, { groupId: circleId }).catch(() => {});
    }
    await adminContext.close();
    await leader.context.close();
    await member.context.close();
  }
});
