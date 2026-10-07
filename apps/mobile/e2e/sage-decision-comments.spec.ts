import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { newSignedInPage, USER_B_EMAIL } from "./support/auth";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const API_BASE_URL = process.env.E2E_API_BASE_URL || "http://localhost:3001";
const COOP_ID = "cahootz";
const LIVE_POLL = { timeout: 150_000, intervals: [1_000, 2_000, 3_000] }; // live model calls

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

// An everyday group decision isn't something the charter covers. Before this change Sage needed a
// charter quote for every reply, so it stayed silent (or quoted an unrelated rule). Now it may ground a
// reply on the member's own words, and an independent check confirms the reply is on topic before it
// publishes. Live model calls, so tagged @sage.
test("Sage helps with an everyday decision, grounded on the thread and checked for relevance", { tag: "@sage" }, async ({ browser }) => {
  test.setTimeout(300_000);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const member = await newSignedInPage(browser, USER_B_EMAIL);
  let postId: string | undefined;
  let token: string | null = null;

  try {
    token = await sessionTokenFor(member.page);
    if (!token) throw new Error("Missing session token after sign-in");
    await trpcPost("sage.setTrailSettings", token, { showSageDecisionTrails: true });

    // 1. Fixture: a member asks the Commons to choose between two options (the journey is Sage's reply).
    const created = await trpcPost("commons.createPost", token, {
      coopId: COOP_ID, title: `E2E ${runId} potluck spot`,
      content: `E2E ${runId}: For our monthly potluck, should we use the library room or rotate between homes? The library is free but closes at 7. Rotating homes lets us stay late, but the same two families end up hosting every time.`,
      tag: "Ask",
    });
    postId = created.post.id;

    // 2. Sage replies on its own.
    await member.page.goto(`/${COOP_ID}/posts/${postId}`);
    await expect(async () => {
      await member.page.reload();
      await expect(member.page.getByText("Sage", { exact: true }).locator("visible=true").first()).toBeVisible({ timeout: 5_000 });
    }).toPass(LIVE_POLL);

    // 3. The member opens how Sage decided: the evidence is an exact quote from a source code checked,
    //    and the independent relevance check passed before Sage published.
    await expect(shown(member.page, "Sage decision trail")).toBeVisible();
    await member.page.getByRole("button", { name: /Show Sage decision:/ }).locator("visible=true").first().click();
    await expect(shown(member.page, /^Quotes (the post or its thread|the charter or a mission goal|a published resource, document or member count Sage looked up) exactly/)).toBeVisible();
    await expect(shown(member.page, "An independent check found the reply and its evidence on topic")).toBeVisible();
    await expect(shown(member.page, "Published a reply as Sage")).toBeVisible();

    // 4. It stays after a reload.
    await member.page.reload();
    await member.page.getByRole("button", { name: /Show Sage decision:/ }).locator("visible=true").first().click();
    await expect(shown(member.page, "An independent check found the reply and its evidence on topic")).toBeVisible();
  } finally {
    // Fixture cleanup: Sage's actions, tasks and trails for the E2E post, then the post and the setting.
    if (postId) {
      execFileSync("pnpm", ["--silent", "-F", "@cahootz/api", "exec", "tsx", "--import", "./dotenv.config.js", "scripts/e2e-agent-trails.ts", "cleanup-post", postId],
        { cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000 });
    }
    if (postId && token) await trpcPost("commons.deletePost", token, { postId }).catch(() => {});
    if (token) await trpcPost("sage.setTrailSettings", token, { showSageDecisionTrails: false }).catch(() => {});
    await member.context.close();
  }
});
