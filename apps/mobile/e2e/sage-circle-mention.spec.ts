import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { newSignedInPage, USER_A_EMAIL, USER_B_EMAIL } from "./support/auth";

// A member @mentions Sage inside a circle and gets an answer there, visible to the circle. Before,
// Sage only answered @mentions in the Commons feed and stayed silent in circles. Live model call.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const API_BASE_URL = process.env.E2E_API_BASE_URL || "http://localhost:3001";
const COOP_ID = "cahootz";
const LIVE_POLL = { timeout: 120_000, intervals: [1_000, 2_000, 3_000] };

/** Fixture cleanup only (see apps/api/scripts/e2e-agent-trails.ts). */
function trailFixture(...args: string[]) {
  const output = execFileSync(
    "pnpm",
    ["--silent", "-F", "@cahootz/api", "exec", "tsx", "--import", "./dotenv.config.js", "scripts/e2e-agent-trails.ts", ...args],
    { cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000 },
  );
  const line = output.split("\n").reverse().find((entry) => entry.startsWith("E2E_RESULT "));
  if (!line) throw new Error(`Agent-trail fixture printed no result:\n${output}`);
  return JSON.parse(line.slice("E2E_RESULT ".length));
}

async function sessionTokenFor(page: Page) {
  const token = await page.evaluate(() => window.localStorage.getItem("cahootz.sessionToken"));
  if (!token) throw new Error("Missing session token after sign-in");
  return token;
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

test("Sage answers an @mention inside a circle", { tag: "@sage" }, async ({ browser }) => {
  test.setTimeout(240_000);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const leader = await newSignedInPage(browser, USER_A_EMAIL);
  const member = await newSignedInPage(browser, USER_B_EMAIL);
  let postId: string | undefined;
  let circleId: string | undefined;
  let tokenA: string | undefined;
  let tokenB: string | undefined;

  try {
    tokenA = await sessionTokenFor(leader.page);
    tokenB = await sessionTokenFor(member.page);
    // Fixtures: A leads a circle that B joins, and posts a plan there.
    const { group } = await trpcPost("groups.create", tokenA, { name: `E2E Cleanup circle ${runId}`, privacy: "invite-only" });
    circleId = group.id as string;
    await trpcPost("groups.joinByCode", tokenB, { inviteCode: group.inviteCode });
    const created = await trpcPost("commons.createPost", tokenA, {
      coopId: COOP_ID, circleId, title: `E2E ${runId} park cleanup`,
      content: `E2E ${runId}: Park cleanup this Saturday at 9. We have bags but no gloves yet.`, tag: "Idea",
    });
    postId = (created.post?.id ?? created.id) as string;
    const url = `/${COOP_ID}/posts/${postId}`;

    // 1. B asks Sage in the circle thread.
    await member.page.goto(url);
    const question = `E2E ${runId}: @sage what else should we bring besides gloves?`;
    await member.page.getByPlaceholder("Write a comment...").locator("visible=true").first().fill(question);
    await member.page.getByLabel("Send comment").locator("visible=true").first().click();
    await expect(shown(member.page, `E2E ${runId}:`)).toBeVisible();

    // 2. Sage answers in the thread, and the circle's leader sees the same reply.
    for (const viewer of [member, leader]) {
      await expect(async () => {
        // Reloading a post URL on web lands on the circle picker, so open the post again instead.
        await viewer.page.goto(url);
        await expect(viewer.page.getByText("Sage", { exact: true }).locator("visible=true")).toHaveCount(1, { timeout: 5_000 });
      }).toPass(LIVE_POLL);
    }
  } finally {
    if (postId) trailFixture("cleanup-post", postId);
    if (postId && tokenA) await trpcPost("commons.deletePost", tokenA, { postId }).catch(() => {});
    if (circleId) {
      if (tokenB) await trpcPost("groups.leave", tokenB, { groupId: circleId }).catch(() => {});
      if (tokenA) await trpcPost("groups.leave", tokenA, { groupId: circleId }).catch(() => {});
    }
    await leader.context.close();
    await member.context.close();
  }
});
