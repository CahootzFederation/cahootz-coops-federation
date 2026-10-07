import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { newSignedInPage, USER_A_EMAIL, USER_B_EMAIL } from "./support/auth";

// Sage follows through on suggestions that wait on someone: it says when it will close them, reminds
// the person once, closes the suggestion when nobody answers, and closes it right away when it no
// longer applies. Fixtures run the real service code (apps/api/scripts/e2e-sage-steward.ts and
// e2e-sage-suggestions.ts) and backdate the wait; no live model is called.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const API_BASE_URL = process.env.E2E_API_BASE_URL || "http://localhost:3001";
const COOP_ID = "cahootz";
const SERVER_POLL = { timeout: 30_000, intervals: [250, 500, 1_000] };

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
const steward = (...args: string[]) => fixture("e2e-sage-steward.ts", ...args);
const suggestions = (...args: string[]) => fixture("e2e-sage-suggestions.ts", ...args);

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

/** Expo Router keeps earlier screens mounted (hidden), so match visible text only. */
function shown(page: Page, text: string | RegExp) {
  return page.getByText(text).locator("visible=true").first();
}

async function openAlerts(page: Page) {
  await page.goto("/");
  await page.getByLabel("Alerts", { exact: true }).locator("visible=true").first().click();
}

// Two people: A accepts an introduction, B is asked and never answers. B is told when Sage will close
// it, gets exactly one reminder that opens the suggestion, and then Sage closes it. A, who said yes and
// was waiting, is told it won't go ahead.
test("Sage reminds once about an unanswered suggestion, then closes it and tells whoever was waiting", async ({ browser }) => {
  test.setTimeout(240_000);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const need = await newSignedInPage(browser, USER_A_EMAIL);
  const helper = await newSignedInPage(browser, USER_B_EMAIL);
  let actionId = "-";

  try {
    const intro = steward("introduce", USER_A_EMAIL, USER_B_EMAIL, runId);
    expect(intro.created, JSON.stringify(intro)).toBe(true);
    actionId = intro.actionId;

    // 1. A sees when Sage will close the suggestion, and accepts.
    await need.page.goto(`/sage/${actionId}`);
    await expect(shown(need.page, /^Sage reminds you once, and closes this on .+ if nobody answers\.$/)).toBeVisible();
    await need.page.getByRole("button", { name: "Approve" }).click();

    // 2. B is asked, and is told the same.
    await expect(async () => {
      await helper.page.goto(`/sage/${actionId}`);
      await expect(helper.page.getByRole("button", { name: "Approve" })).toBeVisible({ timeout: 3_000 });
    }).toPass(SERVER_POLL);
    await expect(shown(helper.page, /^Sage reminds you once, and closes this on/)).toBeVisible();

    // 3. Days pass without an answer: B gets one reminder, and repeated wakes don't send another.
    steward("age-suggestion", actionId, runId);
    steward("suggestion-sweep");
    steward("suggestion-sweep");
    const reminderBody = new RegExp(`E2E ${runId} help setting up bookkeeping.*needs your answer\\. Sage will close it in 4 days`);
    await expect(async () => {
      await openAlerts(helper.page);
      await expect(helper.page.getByText(reminderBody).locator("visible=true")).toHaveCount(1, { timeout: 3_000 });
    }).toPass(SERVER_POLL);
    await expect(shown(helper.page, "Sage is still waiting on you")).toBeVisible();
    await shown(helper.page, reminderBody).click();
    await expect(helper.page).toHaveURL(new RegExp(`/sage/${actionId}`));
    await expect(helper.page.getByRole("button", { name: "Approve" })).toBeVisible();

    // 4. Still no answer after the reminder: Sage closes it. B can no longer answer, and the timeline says why.
    steward("age-suggestion", actionId, runId);
    steward("suggestion-sweep");
    await expect(async () => {
      await helper.page.reload();
      await expect(shown(helper.page, "Sage closed this: nobody answered after Sage's reminder")).toBeVisible({ timeout: 3_000 });
    }).toPass(SERVER_POLL);
    await expect(shown(helper.page, "Dismissed")).toBeVisible();
    await expect(helper.page.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect(shown(helper.page, "Nothing to review on this suggestion right now.")).toBeVisible();

    // 5. A, who said yes, is told it won't go ahead, and the alert opens the closed suggestion.
    const closedBody = new RegExp(`E2E ${runId} help setting up bookkeeping.*won't go ahead`);
    await expect(async () => {
      await openAlerts(need.page);
      await expect(need.page.getByText(closedBody).locator("visible=true")).toHaveCount(1, { timeout: 3_000 });
    }).toPass(SERVER_POLL);
    await expect(shown(need.page, "Sage closed a suggestion")).toBeVisible();
    await shown(need.page, closedBody).click();
    await expect(need.page).toHaveURL(new RegExp(`/sage/${actionId}`));
    await expect(shown(need.page, "Sage closed this: nobody answered after Sage's reminder")).toBeVisible();
  } finally {
    steward("cleanup", runId, "-", "-", actionId, "-");
    await need.context.close();
    await helper.context.close();
  }
});

// A circle leader is asked to approve a Sage comment on a member's post. When the member deletes the
// post, Sage closes the suggestion at its next check instead of waiting or reminding the leader.
test("Sage closes a suggestion as soon as it no longer applies", async ({ browser }) => {
  test.setTimeout(180_000);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const leader = await newSignedInPage(browser, USER_A_EMAIL);
  const member = await newSignedInPage(browser, USER_B_EMAIL);
  let circleId: string | undefined;
  let postId: string | undefined;
  let seeded = false;

  try {
    const leaderToken = await sessionTokenFor(leader.page);
    const memberToken = await sessionTokenFor(member.page);
    if (!leaderToken || !memberToken) throw new Error("Missing session token after sign-in");
    const { group } = await trpcPost("groups.create", leaderToken, { name: `E2E Follow-up circle ${runId}`, privacy: "invite-only" });
    circleId = group.id;
    await trpcPost("groups.joinByCode", memberToken, { inviteCode: group.inviteCode });
    const created = await trpcPost("commons.createPost", memberToken, {
      coopId: COOP_ID, circleId, title: `E2E ${runId} parking`, content: `E2E ${runId}: Where do we park for the meetup?`, tag: "Need",
    });
    postId = created.post?.id ?? created.id;
    if (!postId) throw new Error(`createPost returned no id: ${JSON.stringify(created)}`);

    const seed = suggestions("seed-pending", runId, circleId!, postId!);
    seeded = true;
    expect(seed.status, JSON.stringify(seed)).toBe("PENDING");

    // 1. The leader is asked to approve Sage's comment, and told when Sage will close it.
    await leader.page.goto(`/sage/${seed.actionId}`);
    await expect(leader.page.getByRole("button", { name: "Approve" })).toBeVisible();
    await expect(shown(leader.page, /^Sage reminds you once, and closes this on/)).toBeVisible();

    // 2. The member deletes the post (through the API: React Native Web can't show the confirm dialog).
    await trpcPost("commons.deletePost", memberToken, { postId });
    postId = undefined;

    // 3. At its next check Sage closes the suggestion, says why, and the leader has nothing left to approve.
    steward("suggestion-sweep");
    await expect(async () => {
      await leader.page.reload();
      await expect(shown(leader.page, "Sage closed this: the post it was about was deleted")).toBeVisible({ timeout: 3_000 });
    }).toPass(SERVER_POLL);
    await expect(shown(leader.page, "Dismissed")).toBeVisible();
    await expect(leader.page.getByRole("button", { name: "Approve" })).toHaveCount(0);

    // 4. No reminder about a suggestion that no longer applies.
    await openAlerts(leader.page);
    await expect(leader.page.getByText(new RegExp(`E2E ${runId} Answer the parking question.*needs your answer`)).locator("visible=true")).toHaveCount(0);
  } finally {
    if (seeded) suggestions("cleanup", runId, circleId!);
    const leaderToken = await sessionTokenFor(leader.page).catch(() => null);
    const memberToken = await sessionTokenFor(member.page).catch(() => null);
    if (postId && memberToken) await trpcPost("commons.deletePost", memberToken, { postId }).catch(() => {});
    if (circleId) {
      if (memberToken) await trpcPost("groups.leave", memberToken, { groupId: circleId }).catch(() => {});
      if (leaderToken) await trpcPost("groups.leave", leaderToken, { groupId: circleId }).catch(() => {});
    }
    await leader.context.close();
    await member.context.close();
  }
});
