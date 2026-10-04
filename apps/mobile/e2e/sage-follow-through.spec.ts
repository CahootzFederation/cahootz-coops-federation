import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { newSignedInPage, USER_B_EMAIL } from "./support/auth";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const API_BASE_URL = process.env.E2E_API_BASE_URL || "http://localhost:3001";
const COOP_ID = "cahootz";
const LIVE_POLL = { timeout: 120_000, intervals: [1_000, 2_000, 3_000] }; // live model calls

async function sessionTokenFor(page: Page) {
  return page.evaluate(() => window.localStorage.getItem("cahootz.sessionToken"));
}

async function trpcPost(pathName: string, sessionToken: string, body: unknown) {
  const response = await fetch(`${API_BASE_URL}/trpc/${pathName}`, {
    method: "POST", headers: { "content-type": "application/json", "x-session-token": sessionToken }, body: JSON.stringify(body),
  });
  const text = await response.text();
  expect(response.ok, `${pathName} failed: ${text}`).toBe(true);
  return JSON.parse(text).result.data as any;
}

function shown(page: Page, text: string | RegExp) {
  return page.getByText(text).locator("visible=true").first();
}

// A member asks the Commons a shared-cost question. Sage replies on its own asking for the details it
// needs; when the member replies with those details in the app, Sage reads the thread (including its
// own reply) and follows through by drafting the proposal instead of asking again. Live model calls, so tagged @sage.
test("Sage follows through on its offer when a member replies with the details", { tag: "@sage" }, async ({ browser }) => {
  test.setTimeout(300_000);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const member = await newSignedInPage(browser, USER_B_EMAIL);
  let postId: string | undefined;
  let token: string | null = null;

  try {
    token = await sessionTokenFor(member.page);
    if (!token) throw new Error("Missing session token after sign-in");
    const created = await trpcPost("commons.createPost", token, {
      coopId: COOP_ID, title: `E2E ${runId} shared drivers`,
      content: `E2E ${runId}: Could member businesses share delivery drivers so we are not each paying for our own?`, tag: "Need",
    });
    postId = created.post.id;

    // 1. Sage replies on its own, asking for details. It may use the action-plan template or a plain
    //    clarifying question - templates are suggestions - so any Sage reply counts here.
    await member.page.goto(`/${COOP_ID}/posts/${postId}`);
    await expect(async () => {
      await member.page.reload();
      await expect(member.page.getByText("Sage", { exact: true }).locator("visible=true").first()).toBeVisible({ timeout: 5_000 });
    }).toPass(LIVE_POLL);

    // 2. The member replies with the details through the real comment box.
    await member.page.getByPlaceholder("Write a comment...").locator("visible=true").first()
      .fill(`E2E ${runId}: We deliver Mon/Wed/Fri, about 40 stops a week downtown, and pay a part-time driver $650 a month. Two other shops have the same days.`);
    await member.page.getByLabel("Send comment").locator("visible=true").first().click();

    // 3. Sage follows through: the member is told a proposal draft is ready, built from their details.
    await member.page.getByLabel("Alerts", { exact: true }).locator("visible=true").first().click();
    await expect(async () => {
      await member.page.reload();
      await expect(shown(member.page, "A proposal draft is ready")).toBeVisible({ timeout: 5_000 });
    }).toPass(LIVE_POLL);
    const drafts = await (await fetch(`${API_BASE_URL}/trpc/commonsActions.myProposalDrafts`, { headers: { "x-session-token": token } })).json();
    const draft = drafts.result.data.find((entry: { body: string; title: string }) => /\$?650|40 stops|Mon/i.test(`${entry.title} ${entry.body}`));
    expect(draft, "the draft should use the details the member gave").toBeTruthy();
  } finally {
    // Fixture cleanup: Sage's actions, drafts, alerts and trails for the E2E post, then the post.
    if (postId) {
      execFileSync("pnpm", ["--silent", "-F", "@cahootz/api", "exec", "tsx", "--import", "./dotenv.config.js", "scripts/e2e-agent-trails.ts", "cleanup-post", postId],
        { cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000 });
    }
    if (postId && token) await trpcPost("commons.deletePost", token, { postId }).catch(() => {});
    await member.context.close();
  }
});
