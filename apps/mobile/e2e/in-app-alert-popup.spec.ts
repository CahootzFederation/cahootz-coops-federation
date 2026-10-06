import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { newSignedInPage } from "./support/auth";

const API_BASE_URL = process.env.E2E_API_BASE_URL || "http://localhost:3001";
const USER_A_EMAIL =
  process.env.E2E_USER_A_EMAIL || "releaseclick1@test.cahootz.local";
const USER_B_EMAIL =
  process.env.E2E_USER_B_EMAIL || "releaseclick2@test.cahootz.local";
const COOP_ID = "cahootz";

async function sessionTokenFor(page: Page) {
  return page.evaluate(() =>
    window.localStorage.getItem("cahootz.sessionToken"),
  );
}

async function storedUser(page: Page): Promise<{ id: string; handle: string }> {
  const raw = await page.evaluate(() =>
    window.localStorage.getItem("cahootz.user"),
  );
  return JSON.parse(raw || "{}");
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
  return response.json();
}

/** The popup's own unread-alerts check (not the inbox or the badge). */
function isPopupCheck(url: string) {
  const decoded = decodeURIComponent(url);
  return (
    decoded.includes("/trpc/notification.getNotifications") &&
    decoded.includes('"unreadOnly":true') &&
    decoded.includes('"limit":10')
  );
}

/**
 * Opens the home feed and waits for the popup's first check, which only
 * records alerts already waiting. Anything created after this pops up.
 */
async function openHomeAndSettle(page: Page) {
  const firstCheck = page.waitForResponse((res) => isPopupCheck(res.url()), {
    timeout: 60_000,
  });
  await page.goto("/");
  await expect(page.getByLabel("Open menu")).toBeVisible();
  await firstCheck;
}

async function postInCircle(page: Page, groupId: string, text: string) {
  await page.goto(`/${COOP_ID}/posts?circleId=${groupId}`);
  const composer = page.getByRole("textbox", {
    name: "Share what's happening...",
  });
  await expect(composer).toBeVisible();
  await composer.fill(text);
  await page.getByLabel("Post", { exact: true }).click();
  await expect(composer).toHaveValue("");
}

test("new alerts pop up while the app is open and open what they're about", async ({
  browser,
}) => {
  // Two sign-ins, an invitation, two posts and up to three 15s alert checks.
  test.setTimeout(360_000);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const circleName = `E2E Popup Circle ${runId}`;
  const mentionPost = `E2E popup mention ${runId}`;
  const quietPost = `E2E popup on alerts ${runId}`;
  const burstPost = `E2E popup burst ${runId}`;

  const userA = await newSignedInPage(browser, USER_A_EMAIL);
  const userB = await newSignedInPage(browser, USER_B_EMAIL);
  let groupId: string | undefined;

  try {
    const sessionTokenA = await sessionTokenFor(userA.page);
    const sessionTokenB = await sessionTokenFor(userB.page);
    expect(sessionTokenA).toBeTruthy();
    expect(sessionTokenB).toBeTruthy();
    const memberA = await storedUser(userA.page);
    const memberB = await storedUser(userB.page);
    expect(memberA.handle).toBeTruthy();
    expect(memberB.id).toBeTruthy();

    // Fixture setup: User A leads a fresh private circle and invites User B.
    const created = await trpcPost("groups.create", sessionTokenA!, {
      name: circleName,
      privacy: "private",
    });
    groupId = created?.result?.data?.group?.id;
    expect(groupId).toBeTruthy();
    const invited = await trpcPost("groups.invite", sessionTokenA!, {
      groupId,
      userId: memberB.id,
    });
    expect(invited?.error).toBeUndefined();

    await openHomeAndSettle(userA.page);

    // B accepts through their Circles screen; A, still on the feed, gets a
    // popup without reloading.
    await userB.page.goto("/");
    await userB.page.getByLabel("Manage circles").click();
    await userB.page.getByLabel(`Accept invitation to ${circleName}`).click();
    await expect(userB.page).toHaveURL(new RegExp(`circleId=${groupId}`), {
      timeout: 20_000,
    });

    const joinedPopup = userA.page.getByRole("button", {
      name: new RegExp(`^New alert: .+ joined ${circleName}\\.`),
    });
    await expect(joinedPopup).toBeVisible({ timeout: 45_000 });
    await joinedPopup.click();
    await expect(userA.page).toHaveURL(new RegExp(`circleId=${groupId}`));
    await expect(joinedPopup).toHaveCount(0);

    // B @mentions A in the circle; the popup opens the post itself.
    await openHomeAndSettle(userA.page);
    await postInCircle(userB.page, groupId!, `@${memberA.handle} ${mentionPost}`);

    const mentionPopup = userA.page.getByRole("button", {
      name: /^New alert: You were mentioned\. .+ mentioned you in a post\./,
    });
    await expect(mentionPopup).toBeVisible({ timeout: 45_000 });
    await mentionPopup.click();
    await expect(userA.page).toHaveURL(new RegExp(`/${COOP_ID}/posts/[^/?]+`));
    await expect(userA.page.getByText(mentionPost).first()).toBeVisible();

    // A burst of mentions shares one card with the real count, which opens
    // Alerts. B's burst is fixture setup (sent together so it lands in one check).
    await openHomeAndSettle(userA.page);
    for (const n of [1, 2, 3]) {
      const sent = await trpcPost("commons.createPost", sessionTokenB!, {
        coopId: COOP_ID,
        circleId: groupId,
        content: `@${memberA.handle} ${burstPost} ${n}`,
      });
      expect(sent?.error).toBeUndefined();
    }
    const burstPopup = userA.page.getByRole("button", {
      name: /^New alerts: You were mentioned 3 times\. Latest: .+ mentioned you in a post\./,
    });
    await expect(burstPopup).toBeVisible({ timeout: 45_000 });
    await expect(
      userA.page.getByRole("button", { name: /^New alert:/ }),
    ).toHaveCount(0);
    await burstPopup.click();
    await expect(userA.page).toHaveURL(/\/notifications/);
    await expect(burstPopup).toHaveCount(0);

    // On the Alerts screen nothing pops up; the alert shows in the list.
    const alertsCheck = userA.page.waitForResponse(
      (res) => isPopupCheck(res.url()),
      { timeout: 60_000 },
    );
    await userA.page.goto("/notifications");
    await expect(
      userA.page.getByText("Alerts", { exact: true }).first(),
    ).toBeVisible();
    await alertsCheck;
    await postInCircle(userB.page, groupId!, `@${memberA.handle} ${quietPost}`);
    // Wait out a full alert check while A stays on Alerts.
    await userA.page.waitForResponse((res) => isPopupCheck(res.url()), {
      timeout: 30_000,
    });
    await userA.page.waitForTimeout(1_000);
    await expect(
      userA.page.getByRole("button", { name: /^New alert:/ }),
    ).toHaveCount(0);
    await userA.page.reload();
    await expect(
      userA.page.getByText(/mentioned you in a post\./).first(),
    ).toBeVisible({ timeout: 20_000 });
  } finally {
    const sessionTokenA = await sessionTokenFor(userA.page).catch(() => null);
    const sessionTokenB = await sessionTokenFor(userB.page).catch(() => null);
    if (sessionTokenB && groupId) {
      const input = encodeURIComponent(
        JSON.stringify({ coopId: COOP_ID, circleId: groupId, limit: 20 }),
      );
      const feed = await fetch(
        `${API_BASE_URL}/trpc/commons.listFeed?input=${input}`,
        { headers: { "x-session-token": sessionTokenB } },
      )
        .then((res) => res.json())
        .catch(() => null);
      const posts: Array<{ id: string; body: string }> =
        feed?.result?.data?.posts ?? [];
      for (const post of posts) {
        if (
          post.body.includes(mentionPost) ||
          post.body.includes(quietPost) ||
          post.body.includes(burstPost)
        ) {
          await trpcPost("commons.deletePost", sessionTokenB, {
            postId: post.id,
          }).catch(() => {});
        }
      }
    }
    if (groupId && sessionTokenB) {
      await trpcPost("groups.leave", sessionTokenB, { groupId }).catch(
        () => {},
      );
    }
    if (groupId && sessionTokenA) {
      await trpcPost("groups.leave", sessionTokenA, { groupId }).catch(
        () => {},
      );
    }
    await Promise.all([userA.context.close(), userB.context.close()]);
  }
});
