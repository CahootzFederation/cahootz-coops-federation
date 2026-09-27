import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { newSignedInPage, USER_A_EMAIL, USER_B_EMAIL } from "./support/auth";

const API_BASE_URL = process.env.E2E_API_BASE_URL || "http://localhost:3001";
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

async function sessionTokenFor(page: Page) {
  const token = await page.evaluate(() =>
    window.localStorage.getItem("cahootz.sessionToken"),
  );
  if (!token) throw new Error("Missing session token after sign-in");
  return token;
}

async function trpcPost(path: string, sessionToken: string, body: unknown) {
  const response = await fetch(`${API_BASE_URL}/trpc/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-session-token": sessionToken,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  expect(response.ok, `${path} failed: ${text}`).toBe(true);
  return JSON.parse(text).result.data as any;
}

/**
 * Fixture only: `apps/api/scripts/e2e-onboarding-drip.ts` backdates the
 * member's join date so the day 1 step is due, then runs the real drip
 * logic for that one member against the same database the API uses.
 */
function dripFixture(...args: string[]) {
  const output = execFileSync(
    "pnpm",
    [
      "--silent",
      "-F",
      "@cahootz/api",
      "exec",
      "tsx",
      "--import",
      "./dotenv.config.js",
      "scripts/e2e-onboarding-drip.ts",
      ...args,
    ],
    { cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000 },
  );
  const line = output
    .split("\n")
    .reverse()
    .find((entry) => entry.startsWith("E2E_RESULT "));
  if (!line) throw new Error(`Drip fixture printed no result:\n${output}`);
  return JSON.parse(line.slice("E2E_RESULT ".length));
}

// A member who joined yesterday and hasn't been back gets a day 1 drip
// about what happened in their circles, and opening it lands on that post.
test("a quiet new member gets a day 1 drip that opens today's post in their circle", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const circleName = `E2E drip circle ${runId}`;
  const postBody = `E2E drip ${runId}: who wants to swap seedlings this weekend?`;

  let newcomer = await newSignedInPage(browser, USER_A_EMAIL);
  const poster = await newSignedInPage(browser, USER_B_EMAIL);
  const newcomerToken = await sessionTokenFor(newcomer.page);
  const posterToken = await sessionTokenFor(poster.page);
  let circleId: string | undefined;
  let postId: string | undefined;
  let originalJoinedAt: string | null | undefined;

  try {
    // Fixture setup: User B posts in a circle User A belongs to.
    const { group } = await trpcPost("groups.create", posterToken, {
      name: circleName,
      privacy: "invite-only",
    });
    circleId = group.id;
    await trpcPost("groups.joinByCode", newcomerToken, {
      inviteCode: group.inviteCode,
    });
    const { post } = await trpcPost("commons.createPost", posterToken, {
      coopId: "cahootz",
      circleId,
      content: postBody,
      tag: "Social",
    });
    postId = post.id;
    // A reply makes it the liveliest post in User A's circles today.
    await trpcPost("commons.createComment", posterToken, {
      postId,
      content: `E2E drip ${runId}: I have tomatoes to share.`,
    });

    // User A goes quiet (no open app making requests), then the drip runs.
    await newcomer.context.close();
    const prepared = dripFixture("prepare", USER_A_EMAIL);
    originalJoinedAt = prepared.originalJoinedAt;
    expect(prepared.summary.sent, JSON.stringify(prepared.summary)).toBe(1);
    expect(prepared.send).toMatchObject({ step: 1, status: "SENT", targetType: "POST", targetId: postId });
    expect(prepared.notification.data).toMatchObject({ postId, circleId, dripStep: "1" });
    const title: string = prepared.notification.title;

    // User A comes back, reloads, and finds the drip in Alerts.
    newcomer = await newSignedInPage(browser, USER_A_EMAIL);
    await newcomer.page.reload();
    await newcomer.page.getByLabel("Alerts", { exact: true }).click();
    const alert = newcomer.page.getByLabel(`Unread: ${title}`, { exact: true });
    await expect(alert).toBeVisible();
    await expect(alert.getByText(/new posts? since yesterday/)).toBeVisible();

    // Filtering to the new category still shows it.
    await newcomer.page.getByRole("button", { name: "Getting started", exact: true }).click();
    await expect(alert).toBeVisible();

    // Tapping it lands on the post User B wrote.
    await alert.click();
    await expect(newcomer.page).toHaveURL(new RegExp(`/cahootz/posts/${postId}`));
    await expect(newcomer.page.getByText(postBody).first()).toBeVisible();
    await newcomer.page.reload();
    await expect(newcomer.page.getByText(postBody).first()).toBeVisible();
  } finally {
    if (postId) {
      await trpcPost("commons.deletePost", posterToken, { postId }).catch(() => {});
    }
    if (circleId) {
      await trpcPost("groups.leave", newcomerToken, { groupId: circleId }).catch(() => {});
      await trpcPost("groups.leave", posterToken, { groupId: circleId }).catch(() => {});
    }
    if (originalJoinedAt !== undefined) {
      dripFixture("cleanup", USER_A_EMAIL, originalJoinedAt ?? "null");
    }
    await Promise.all([newcomer.context.close(), poster.context.close()]);
  }
});
