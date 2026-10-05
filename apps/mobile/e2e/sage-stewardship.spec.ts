import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { newSignedInPage, USER_A_EMAIL, USER_B_EMAIL } from "./support/auth";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const API_BASE_URL = process.env.E2E_API_BASE_URL || "http://localhost:3001";
const COOP_ID = "cahootz";
// Approval runs the tool in-process without a Trigger key, or in a Trigger worker with one.
const SERVER_POLL = { timeout: 60_000, intervals: [500, 1_000, 2_000] };

/**
 * Fixture setup and cleanup only: `apps/api/scripts/e2e-sage-suggestions.ts`
 * creates the two Sage suggestions through the real createTrendSuggestion
 * path, so this journey doesn't depend on which capability a live model picks.
 */
function sageFixture(...args: string[]) {
  const output = execFileSync(
    "pnpm",
    ["--silent", "-F", "@cahootz/api", "exec", "tsx", "--import", "./dotenv.config.js", "scripts/e2e-sage-suggestions.ts", ...args],
    { cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000 },
  );
  const line = output.split("\n").reverse().find((entry) => entry.startsWith("E2E_RESULT "));
  if (!line) throw new Error(`Sage fixture printed no result:\n${output}`);
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

/** Expo Router keeps earlier screens mounted (hidden), so match visible text only. */
function shown(page: Page, text: string | RegExp) {
  return page.getByText(text).locator("visible=true").first();
}

// Sage comments on a member's circle post on its own (confident, Auto-reply on), and the leader can
// see what it did and why. A proposal draft still needs the leader's approval and stays an
// editable, unsubmitted draft owned by the leader.
test("Sage comments on its own and a circle leader approves an editable proposal draft", async ({ browser }) => {
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

    const { group } = await trpcPost("groups.create", leaderToken, { name: `E2E Sage circle ${runId}`, privacy: "invite-only" });
    circleId = group.id;
    await trpcPost("groups.joinByCode", memberToken, { inviteCode: group.inviteCode });
    const created = await trpcPost("commons.createPost", memberToken, {
      coopId: COOP_ID, circleId, title: `E2E ${runId} cleanup meetup`,
      content: `E2E ${runId}: Where should we meet for the cleanup?`, tag: "Need",
    });
    postId = created.post?.id ?? created.id;
    if (!postId) throw new Error(`createPost returned no id: ${JSON.stringify(created)}`);
    const chatLine = `E2E ${runId}: I can bring rakes and gloves for the cleanup.`;
    await trpcPost("groups.addComment", leaderToken, { groupId: circleId, content: chatLine });

    // A joins the discussion first, so both kinds of Sage-comment alerts are exercised.
    await trpcPost("commons.createComment", leaderToken, { postId, content: `E2E ${runId}: I can bring gloves.` });

    const { commentActionId, proposalActionId } = sageFixture("seed", runId, circleId!, postId!);
    seeded = true;

    // 1. Sage comments on its own when it is confident: the member who wrote the post sees Sage's
    //    comment without anyone approving it, and it persists after a reload.
    const commentText = `E2E ${runId}: Book the community room by Thursday; it fills up on weekends.`;
    await member.page.goto(`/${COOP_ID}/posts/${postId}`);
    await expect(shown(member.page, commentText)).toBeVisible();
    await member.page.reload();
    await expect(shown(member.page, commentText)).toBeVisible();
    await expect(shown(member.page, "Sage")).toBeVisible();
    // Sage's comment is labeled as coming from an AI helper; B's post and A's comment are not.
    await expect(member.page.getByLabel("AI helper, not a person").filter({ visible: true })).toHaveCount(1);

    // B, the post's author, is told Sage commented, and the alert opens the post.
    await member.page.getByLabel("Alerts", { exact: true }).locator("visible=true").first().click();
    await shown(member.page, "Sage commented on your post").click();
    await expect(member.page).toHaveURL(new RegExp(`/posts/${postId}`));
    await expect(shown(member.page, commentText)).toBeVisible();
    // A, who commented on the post, is told too.
    await leader.page.goto("/");
    await leader.page.getByLabel("Alerts", { exact: true }).locator("visible=true").first().click();
    await expect(shown(leader.page, "Sage commented on a post you commented on")).toBeVisible();

    // 2. The circle leader can see what Sage did and why, with nothing left to approve.
    await leader.page.goto(`/sage/${commentActionId}`);
    await expect(shown(leader.page, "Sage commented on its own")).toBeVisible();
    await expect(shown(leader.page, "Why Sage suggests this")).toBeVisible();
    await expect(shown(leader.page, `E2E ${runId}: Three members asked where the cleanup should meet.`)).toBeVisible();
    await expect(shown(leader.page, "Published")).toBeVisible();
    // Where it happened: the circle, the exact post Sage replied to, and the conversation it read.
    await expect(shown(leader.page, `E2E Sage circle ${runId}`)).toBeVisible();
    await expect(shown(leader.page, "Replying to")).toBeVisible();
    await expect(shown(leader.page, `E2E ${runId}: Where should we meet for the cleanup?`).first()).toBeVisible();
    await expect(shown(leader.page, "Conversation Sage read")).toBeVisible();
    await expect(shown(leader.page, chatLine)).toBeVisible();
    await expect(shown(leader.page, "Sage's comment")).toBeVisible();

    // Tapping the post opens the regular post detail screen, with its comments - including Sage's.
    await leader.page.getByLabel("Open the post Sage is replying to").locator("visible=true").first().click();
    await expect(leader.page).toHaveURL(new RegExp(`/${COOP_ID}/posts/${postId}`));
    await expect(shown(leader.page, commentText)).toBeVisible();
    await expect(shown(leader.page, `E2E ${runId}: Where should we meet for the cleanup?`)).toBeVisible();
    await expect(leader.page.getByRole("button", { name: "Approve" })).toHaveCount(0);

    // 3. Sage recommends a proposal; approving creates a draft, never a submitted proposal.
    await leader.page.goto(`/sage/${proposalActionId}`);
    await expect(shown(leader.page, "Sage recommends a proposal")).toBeVisible();
    await expect(shown(leader.page, /Nothing is submitted until you submit it/)).toBeVisible();
    // The leader can judge the draft against the circle and conversation it came from before approving.
    await expect(shown(leader.page, `E2E Sage circle ${runId}`)).toBeVisible();
    await expect(shown(leader.page, chatLine)).toBeVisible();
    await leader.page.getByRole("button", { name: "Approve" }).click();
    await expect(async () => {
      await leader.page.reload();
      await expect(leader.page.getByRole("button", { name: "Edit proposal draft" })).toBeVisible({ timeout: 10_000 });
    }).toPass(SERVER_POLL);

    // 4. The leader edits the draft; the edit is saved and survives a reload, still as a draft.
    await leader.page.getByRole("button", { name: "Edit proposal draft" }).click();
    const title = leader.page.getByLabel("Proposal title").locator("visible=true").first();
    await expect(title).toHaveValue(`E2E ${runId} Shared tool library`);
    const body = leader.page.getByLabel("Proposal body").locator("visible=true").first();
    const editedBody = `E2E ${runId}: Fund a shared tool library, starting with a three-month pilot.`;
    await body.fill(editedBody);
    await leader.page.getByRole("button", { name: "Save", exact: true }).locator("visible=true").first().click();
    await expect(shown(leader.page, "Draft saved.")).toBeVisible();
    await leader.page.reload();
    await expect(leader.page.getByLabel("Proposal body").locator("visible=true").first()).toHaveValue(editedBody);
  } finally {
    if (seeded) sageFixture("cleanup", runId, circleId!);
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
