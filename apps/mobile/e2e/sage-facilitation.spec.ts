import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { newSignedInPage, USER_A_EMAIL, USER_B_EMAIL } from "./support/auth";

// Sage facilitates like an assistant community manager: code decides a thread needs it (members
// disagree, the group puts it off, a vote is about to close), and Sage steps in once. Live model calls,
// so tagged @sage. Fixtures (apps/api/scripts/e2e-sage-facilitation.ts) run the real service code.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const API_BASE_URL = process.env.E2E_API_BASE_URL || "http://localhost:3001";
const COOP_ID = "cahootz";
const LIVE_POLL = { timeout: 150_000, intervals: [1_000, 2_000, 3_000] };

function fixture(...args: string[]) {
  const output = execFileSync(
    "pnpm",
    ["--silent", "-F", "@cahootz/api", "exec", "tsx", "--import", "./dotenv.config.js", "scripts/e2e-sage-facilitation.ts", ...args],
    { cwd: REPO_ROOT, encoding: "utf8", timeout: 180_000 },
  );
  const line = output.split("\n").reverse().find((entry) => entry.startsWith("E2E_RESULT "));
  if (!line) throw new Error(`e2e-sage-facilitation.ts printed no result:\n${output}`);
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

async function comment(page: Page, text: string) {
  await page.getByPlaceholder("Write a comment...").fill(text);
  await page.getByLabel("Send comment").click();
  await expect(shown(page, text)).toBeVisible();
}

function sageComments(page: Page) {
  return page.getByText("Sage", { exact: true }).locator("visible=true");
}

/**
 * Waits until the thread shows `count` Sage comments. In a circle, Sage posts by itself only when the
 * live model is confident enough; otherwise the circle leader is asked, and here the leader approves it
 * in the app. Either way exactly one comment results from the trigger.
 */
async function expectSageToSpeak(viewer: Page, leader: Page, postId: string, url: string, count: number) {
  await expect(async () => {
    await viewer.reload();
    if (await sageComments(viewer).count() === count) return;
    const [actionId] = fixture("pending", postId).actionIds as string[];
    if (actionId) {
      await leader.goto(`/sage/${actionId}`);
      await leader.getByRole("button", { name: "Approve" }).click();
      await expect(leader.getByRole("button", { name: "Approve" })).toHaveCount(0);
    }
    await viewer.goto(url);
    await expect(sageComments(viewer)).toHaveCount(count, { timeout: 5_000 });
  }).toPass(LIVE_POLL);
}

// A circle thread: only code's trigger starts Sage here (circle comments don't get the Commons feed's
// per-comment analysis), so the journey exercises the trigger itself.
test("Sage lays out a disagreement in a circle, then brings the thread back after the group puts it off", { tag: "@sage" }, async ({ browser }) => {
  test.setTimeout(480_000);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const userA = await newSignedInPage(browser, USER_A_EMAIL);
  const userB = await newSignedInPage(browser, USER_B_EMAIL);
  let postId: string | undefined;
  let circleId: string | undefined;
  let tokenA: string | undefined;
  let tokenB: string | undefined;

  try {
    tokenA = await sessionTokenFor(userA.page);
    tokenB = await sessionTokenFor(userB.page);
    // Fixtures: A leads a circle that B joins, and shares an idea there (the journey is the thread that follows).
    const { group } = await trpcPost("groups.create", tokenA, { name: `E2E Potluck circle ${runId}`, privacy: "invite-only" });
    circleId = group.id as string;
    await trpcPost("groups.joinByCode", tokenB, { inviteCode: group.inviteCode });
    const created = await trpcPost("commons.createPost", tokenA, {
      coopId: COOP_ID, circleId, title: `E2E ${runId} potluck spot`,
      content: `E2E ${runId}: Idea for the monthly potluck: keep it in the library room, or start rotating between homes.`, tag: "Idea",
    });
    postId = (created.post?.id ?? created.id) as string;
    const url = `/${COOP_ID}/posts/${postId}`;
    await userA.page.goto(url);
    await userB.page.goto(url);

    // 1. Two members push back on each other in the thread.
    await comment(userA.page, `E2E ${runId}: The library is free and on the bus line, I'd rather keep it there.`);
    await comment(userB.page, `E2E ${runId}: I don't think the library works, it closes at 7 and the same people always rush out.`);
    expect(fixture("claims", postId).claims).toEqual([]);
    await comment(userA.page, `E2E ${runId}: But what about people without cars? Homes are spread all over town.`);

    // 2. Code sees the disagreement on the third comment, and Sage lays out the options once.
    await expect.poll(() => fixture("claims", postId!).claims, { timeout: 60_000 }).toEqual([expect.stringMatching(/^disagreement:/)]);
    await expectSageToSpeak(userB.page, userA.page, postId, url, 1);

    // 3. B puts it off. Sage doesn't comment; it follows the thread under B's Following.
    await userB.page.goto(url);
    await comment(userB.page, `E2E ${runId}: Let's revisit this next week once we know who could host.`);
    await expect.poll(() => fixture("claims", postId!).claims, { timeout: 60_000 }).toContainEqual(expect.stringMatching(/^deferral:/));
    await userB.page.goto("/sage");
    await userB.page.getByRole("tab", { name: "Following" }).locator("visible=true").first().click();
    await expect(shown(userB.page, `Bring back: E2E ${runId} potluck spot`)).toBeVisible();
    await userA.page.goto(url);
    await expect(sageComments(userA.page)).toHaveCount(1);

    // 4. The week passes with nobody picking it up: the wake loop brings it back with one more Sage comment.
    expect(fixture("revisit-due", postId)).toMatchObject({ result: "DONE" });
    await expectSageToSpeak(userB.page, userA.page, postId, url, 2);
  } finally {
    if (postId) fixture("cleanup", postId, "-");
    if (postId && tokenA) await trpcPost("commons.deletePost", tokenA, { postId }).catch(() => {});
    if (circleId) {
      if (tokenB) await trpcPost("groups.leave", tokenB, { groupId: circleId }).catch(() => {});
      if (tokenA) await trpcPost("groups.leave", tokenA, { groupId: circleId }).catch(() => {});
    }
    await userA.context.close();
    await userB.context.close();
  }
});

test("Sage adds a little warmth when it helps a harmless busy discussion", { tag: "@sage" }, async ({ browser }) => {
  test.setTimeout(360_000);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const userA = await newSignedInPage(browser, USER_A_EMAIL);
  const userB = await newSignedInPage(browser, USER_B_EMAIL);
  let postId: string | undefined;
  let circleId: string | undefined;
  let tokenA: string | undefined;
  let tokenB: string | undefined;

  try {
    tokenA = await sessionTokenFor(userA.page);
    tokenB = await sessionTokenFor(userB.page);
    const { group } = await trpcPost("groups.create", tokenA, { name: `E2E Garden circle ${runId}`, privacy: "invite-only" });
    circleId = group.id as string;
    await trpcPost("groups.joinByCode", tokenB, { inviteCode: group.inviteCode });
    const created = await trpcPost("commons.createPost", tokenA, {
      coopId: COOP_ID, circleId, title: `E2E ${runId} garden workday`,
      content: `E2E ${runId}: Find a two-hour window for the garden workday.`, tag: "Idea",
    });
    postId = (created.post?.id ?? created.id) as string;
    const url = `/${COOP_ID}/posts/${postId}`;
    await userA.page.goto(url);
    await userB.page.goto(url);

    for (const [member, text] of [
      [userA, `E2E ${runId}: Saturday morning works for my schedule.`],
      [userB, `E2E ${runId}: Saturday morning overlaps with market setup.`],
      [userA, `E2E ${runId}: Sunday afternoon leaves enough daylight.`],
      [userB, `E2E ${runId}: Sunday afternoon overlaps with the pantry shift.`],
      [userA, `E2E ${runId}: The hardware co-op can lend work lights.`],
      [userB, `E2E ${runId}: The garden gate closes at six.`],
      [userA, `E2E ${runId}: We still need a two-hour window that works.`],
    ] as const) await comment(member.page, text);

    await expect.poll(() => fixture("claims", postId!).claims, { timeout: 60_000 }).toEqual([expect.stringMatching(/^busy_thread:/)]);
    await expectSageToSpeak(userB.page, userA.page, postId, url, 1);

    await expect(shown(userB.page, /You’ve surfaced the constraints clearly; here’s what still needs deciding\.|This thread has done a few laps; here’s the useful part\./)).toBeVisible();
  } finally {
    if (postId) fixture("cleanup", postId, "-");
    if (postId && tokenA) await trpcPost("commons.deletePost", tokenA, { postId }).catch(() => {});
    if (circleId) {
      if (tokenB) await trpcPost("groups.leave", tokenB, { groupId: circleId }).catch(() => {});
      if (tokenA) await trpcPost("groups.leave", tokenA, { groupId: circleId }).catch(() => {});
    }
    await userA.context.close();
    await userB.context.close();
  }
});

test("Before a vote closes, Sage posts one balanced summary of the discussion", { tag: "@sage" }, async ({ browser }) => {
  test.setTimeout(300_000);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const userA = await newSignedInPage(browser, USER_A_EMAIL);
  const userB = await newSignedInPage(browser, USER_B_EMAIL);
  let proposalId: string | undefined;

  try {
    // Fixture: a proposal open for voting that closes in 24 hours.
    proposalId = fixture("seed-votable", runId, USER_A_EMAIL).proposalId as string;
    const url = `/proposal-detail?id=${proposalId}&coopId=${COOP_ID}`;

    // 1. Two members discuss it on the proposal page.
    for (const [member, text] of [
      [userA, `E2E ${runId}: Our block has nothing open late, families really need this.`],
      [userB, `E2E ${runId}: I'm for a fridge but $1200 up front is a lot before we know who restocks it.`],
      [userA, `E2E ${runId}: Fair. We could start with a one-month trial at the rec center.`],
    ] as const) {
      await member.page.goto(url);
      await member.page.getByPlaceholder("Share your thoughts, questions, or concerns…").fill(text);
      await member.page.getByText("Post", { exact: true }).locator("visible=true").first().click();
      await expect(shown(member.page, text)).toBeVisible();
    }

    // 2. The wake step summarizes it (run now instead of waiting for the 15-minute sweep).
    expect(fixture("pre-vote", proposalId).result).toBe("PUBLISHED");

    // 3. Both members see Sage's summary, marked as an AI helper, taking no side.
    for (const member of [userB, userA]) {
      await member.page.goto(url);
      const viewAll = member.page.getByText(/View all \d+ comments/).locator("visible=true").first();
      if (await viewAll.isVisible().catch(() => false)) await viewAll.click();
      const summary = member.page.getByTestId("sage-proposal-comment").locator("visible=true").first();
      await expect(summary).toBeVisible();
      await expect(summary.getByText("AI helper")).toBeVisible();
      await expect(summary).toContainText("I'm not taking a side; how to vote is up to each of you.");
      await expect(summary).not.toContainText(/vote (yes|no|for|against)/i);
    }

    // 4. One summary per proposal: running the step again adds nothing.
    expect(fixture("pre-vote", proposalId).result).toBe("SKIPPED");
    await userA.page.reload();
    const viewAll = userA.page.getByText(/View all \d+ comments/).locator("visible=true").first();
    if (await viewAll.isVisible().catch(() => false)) await viewAll.click();
    await expect(userA.page.getByTestId("sage-proposal-comment").locator("visible=true")).toHaveCount(1);
  } finally {
    if (proposalId) fixture("cleanup", "-", proposalId);
    await userA.context.close();
    await userB.context.close();
  }
});
