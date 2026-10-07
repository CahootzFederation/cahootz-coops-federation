import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { newSignedInPage, USER_A_EMAIL, USER_B_EMAIL } from "./support/auth";
import { withExclusiveAccountSetting } from "./support/exclusive";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const API_BASE_URL = process.env.E2E_API_BASE_URL || "http://localhost:3001";
const COOP_ID = "cahootz";
const SERVER_POLL = { timeout: 60_000, intervals: [500, 1_000, 2_000] };

/** Fixture setup and cleanup only (see apps/api/scripts/e2e-sage-suggestions.ts). */
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

function shown(page: Page, text: string | RegExp) {
  return page.getByText(text).locator("visible=true").first();
}

// A member turns on "Show Sage decision trails" in Sage settings and then sees, on a circle post and on
// a Sage suggestion, how Sage decided: what it read, what it considered, which rules it checked, what
// it did, and the live result. Another member who hasn't turned the setting on sees none of it.
test("a member who turns on decision trails sees how Sage decided, and others don't", async ({ browser }) => {
  test.setTimeout(180_000);
  // Every spec that flips "Show Sage decision trails" on a fixture account takes a turn (see support/exclusive.ts).
  await withExclusiveAccountSetting("sage-decision-trails", async () => {
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const leader = await newSignedInPage(browser, USER_A_EMAIL);
    const member = await newSignedInPage(browser, USER_B_EMAIL);
    let circleId: string | undefined;
    let postId: string | undefined;
    let seeded = false;
    let leaderToken: string | null = null;

    try {
      leaderToken = await sessionTokenFor(leader.page);
      const memberToken = await sessionTokenFor(member.page);
      if (!leaderToken || !memberToken) throw new Error("Missing session token after sign-in");
      // Fixture state: both start with the setting off.
      await trpcPost("sage.setTrailSettings", leaderToken, { showSageDecisionTrails: false });
      await trpcPost("sage.setTrailSettings", memberToken, { showSageDecisionTrails: false });

      // 1. The leader turns the setting on through the real settings screen, and it persists.
      await leader.page.goto("/profile");
      await shown(leader.page, "Sage settings").click();
      const toggle = leader.page.getByRole("switch", { name: "Show Sage decision trails" });
      await expect(toggle).toHaveAttribute("aria-checked", "false");
      await toggle.click();
      await expect(shown(leader.page, "Saved.")).toBeVisible();
      await leader.page.reload();
      await expect(leader.page.getByRole("switch", { name: "Show Sage decision trails" })).toHaveAttribute("aria-checked", "true");

      // 2. Fixture: a circle with a member's post, and two Sage decisions over its conversation.
      const { group } = await trpcPost("groups.create", leaderToken, { name: `E2E Trail circle ${runId}`, privacy: "invite-only" });
      circleId = group.id;
      await trpcPost("groups.joinByCode", memberToken, { inviteCode: group.inviteCode });
      const created = await trpcPost("commons.createPost", memberToken, {
        coopId: COOP_ID, circleId, title: `E2E ${runId} cleanup meetup`,
        content: `E2E ${runId}: Where should we meet for the cleanup?`, tag: "Need",
      });
      postId = created.post.id;
      const { commentActionId, proposalActionId } = sageFixture("seed", runId, circleId!, postId!);
      seeded = true;

      // 3. On the post, the leader sees the trail for Sage's comment, stage by stage.
      await leader.page.goto(`/${COOP_ID}/posts/${postId}`);
      await expect(shown(leader.page, "Sage decision trail")).toBeVisible();
      await leader.page.getByRole("button", { name: /Show Sage decision: Commented on the post as Sage/ }).locator("visible=true").first().click();
      for (const stage of ["Observed", "Evidence gathered", "Action considered", "Policy check", "Action taken", "Result", "Follow-up"]) {
        await expect(shown(leader.page, stage)).toBeVisible();
      }
      await expect(shown(leader.page, /^Read \d+ posts, comments and messages in E2E Trail circle/)).toBeVisible();
      await expect(shown(leader.page, "Confident enough to comment without approval (75%+)")).toBeVisible();
      await expect(shown(leader.page, "Not a repeat of a recent suggestion in this circle")).toBeVisible();
      await expect(shown(leader.page, "Published")).toBeVisible();

      // 4. The post's author hasn't turned the setting on: Sage's comment is there, its trail is not.
      const commentText = `E2E ${runId}: Book the community room by Thursday; it fills up on weekends.`;
      await member.page.goto(`/${COOP_ID}/posts/${postId}`);
      await expect(shown(member.page, commentText)).toBeVisible();
      await expect(member.page.getByText("Sage decision trail")).toHaveCount(0);

      // 5. On the proposal suggestion, the trail's result follows the leader's decision live.
      await leader.page.goto(`/sage/${proposalActionId}`);
      await leader.page.getByRole("button", { name: /Show Sage decision: Sent to the circle leader for approval/ }).locator("visible=true").first().click();
      await expect(shown(leader.page, "Waiting for approval")).toBeVisible();
      await leader.page.getByRole("button", { name: "Approve" }).click();
      await expect(async () => {
        await leader.page.reload();
        await leader.page.getByRole("button", { name: /Show Sage decision: Sent to the circle leader for approval/ }).locator("visible=true").first().click({ timeout: 10_000 });
        await expect(shown(leader.page, "Done")).toBeVisible({ timeout: 10_000 });
        await expect(leader.page.getByText("Waiting for approval")).toHaveCount(0);
      }).toPass(SERVER_POLL);
      expect(commentActionId).toBeTruthy();
    } finally {
      if (seeded) sageFixture("cleanup", runId, circleId!);
      const memberToken = await sessionTokenFor(member.page).catch(() => null);
      if (leaderToken) await trpcPost("sage.setTrailSettings", leaderToken, { showSageDecisionTrails: false }).catch(() => {});
      if (postId && memberToken) await trpcPost("commons.deletePost", memberToken, { postId }).catch(() => {});
      if (circleId) {
        if (memberToken) await trpcPost("groups.leave", memberToken, { groupId: circleId }).catch(() => {});
        if (leaderToken) await trpcPost("groups.leave", leaderToken, { groupId: circleId }).catch(() => {});
      }
      await leader.context.close();
      await member.context.close();
    }
  });
});
