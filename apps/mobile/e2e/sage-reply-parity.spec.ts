import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { newSignedInPage, USER_A_EMAIL, USER_B_EMAIL } from "./support/auth";
import { withExclusiveAccountSetting } from "./support/exclusive";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const API_BASE_URL = process.env.E2E_API_BASE_URL || "http://localhost:3001";
const COOP_ID = "cahootz";
const LIVE_POLL = { timeout: 120_000, intervals: [1_000, 2_000, 3_000] }; // live model calls
const SAME_MODEL = /^Model gpt-5\.6-luna\.$/;

/** Fixture setup and cleanup only (see apps/api/scripts/e2e-agent-trails.ts). */
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
  return page.evaluate(() => window.localStorage.getItem("cahootz.sessionToken"));
}

async function trpc(pathName: string, token: string, body?: unknown, method: "POST" | "GET" = "POST") {
  const url = method === "GET"
    ? `${API_BASE_URL}/trpc/${pathName}?input=${encodeURIComponent(JSON.stringify(body ?? {}))}`
    : `${API_BASE_URL}/trpc/${pathName}`;
  const response = await fetch(url, {
    method, headers: { "content-type": "application/json", "x-session-token": token },
    ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
  });
  const text = await response.text();
  expect(response.ok, `${pathName} failed: ${text}`).toBe(true);
  return JSON.parse(text).result.data as any;
}

function shown(page: Page, text: string | RegExp) {
  return page.getByText(text).locator("visible=true").first();
}

async function expandTrail(page: Page, outcome: RegExp) {
  await page.getByRole("button", { name: new RegExp(`Show Sage decision: ${outcome.source}`) }).locator("visible=true").first().click();
}

// A member asks Sage something in a direct message and again by @mentioning Sage in a comment. Both are
// answered by the same model (gpt-5.6-luna), which each reply's decision trail shows. Live model calls.
// Uses B's Sage conversation and flips B's decision-trail setting, so it takes both locks.
test("Sage answers a DM and an @mention with the same model", { tag: "@sage" }, async ({ browser }) =>
  withExclusiveAccountSetting("sage-decision-trails", () => withExclusiveAccountSetting("user-b-sage-conversation", async () => {
    test.setTimeout(300_000);
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const memberA = await newSignedInPage(browser, USER_A_EMAIL);
    const memberB = await newSignedInPage(browser, USER_B_EMAIL);
    let postId: string | undefined;
    let dmGroupId: string | undefined;
    let tokenA: string | null = null;
    let tokenB: string | null = null;
    try {
      tokenA = await sessionTokenFor(memberA.page);
      tokenB = await sessionTokenFor(memberB.page);
      if (!tokenA || !tokenB) throw new Error("Missing session token after sign-in");
      // Fixture state: B sees decision trails, A has a post B can comment on.
      await trpc("sage.setTrailSettings", tokenB, { showSageDecisionTrails: true });
      const { sageUserId } = trailFixture("sage-user");
      const created = await trpc("commons.createPost", tokenA, {
        coopId: COOP_ID, title: `E2E ${runId} weekend plans`, content: `E2E ${runId}: Who's going to the market cleanup on Saturday?`, tag: "Social",
      });
      postId = created.post.id;

      // 1. A direct message to Sage.
      await memberB.page.goto(`/messages?userId=${sageUserId}&name=Sage`);
      await memberB.page.getByLabel(/^Message Sage/).locator("visible=true").first().fill(`E2E ${runId}: How long does a vote stay open here?`);
      await memberB.page.getByLabel("Send message").locator("visible=true").first().click();
      await expect(async () => {
        await expandTrail(memberB.page, /Replied in the direct message/);
        await expect(shown(memberB.page, "Read a direct message to Sage")).toBeVisible({ timeout: 5_000 });
      }).toPass(LIVE_POLL);
      await expect(shown(memberB.page, SAME_MODEL)).toBeVisible();
      const { threads } = await trpc("groups.listDirect", tokenB, { coopId: COOP_ID }, "GET");
      dmGroupId = threads.find((thread: { person: { id: string } }) => thread.person.id === sageUserId)?.groupId;

      // 2. The same kind of question as an @mention in a comment on the Commons feed.
      await memberB.page.goto(`/${COOP_ID}/posts/${postId}`);
      await memberB.page.getByPlaceholder("Write a comment...").locator("visible=true").first().fill(`E2E ${runId}: @sage how long does a vote stay open here?`);
      await memberB.page.getByLabel("Send comment").locator("visible=true").first().click();
      await expect(async () => {
        // Reloading a post URL on web lands on the circle picker, so open the post again instead.
        await memberB.page.goto(`/${COOP_ID}/posts/${postId}`);
        await expandTrail(memberB.page, /Replied in the comments as Sage/);
        await expect(shown(memberB.page, "Read a comment that @mentioned Sage")).toBeVisible({ timeout: 5_000 });
      }).toPass(LIVE_POLL);
      await expect(shown(memberB.page, SAME_MODEL)).toBeVisible();
    } finally {
      if (postId) trailFixture("cleanup-post", postId);
      trailFixture("cleanup", "-", dmGroupId ?? "-", postId ?? "-");
      if (postId && tokenA) await trpc("commons.deletePost", tokenA, { postId }).catch(() => {});
      if (tokenB) await trpc("sage.setTrailSettings", tokenB, { showSageDecisionTrails: false }).catch(() => {});
      await memberA.context.close();
      await memberB.context.close();
    }
  })),
);
