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

function circleTile(page: Page, circleName: string) {
  return page.getByRole("button").filter({ hasText: circleName }).first();
}

test("a circle shows how many new posts and comments are waiting until you open it", async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const circleName = `E2E Unread Circle ${runId}`;
  const firstPost = `E2E unread post ${runId}`;
  const secondPost = `E2E unread follow-up ${runId}`;

  const userA = await newSignedInPage(browser, USER_A_EMAIL);
  const userB = await newSignedInPage(browser, USER_B_EMAIL);
  let groupId: string | undefined;
  const postIds: string[] = [];

  try {
    const sessionTokenA = await sessionTokenFor(userA.page);
    const sessionTokenB = await sessionTokenFor(userB.page);
    expect(sessionTokenA).toBeTruthy();
    expect(sessionTokenB).toBeTruthy();

    // Fixture: A makes a private circle, B joins, then A posts and comments.
    const created = await trpcPost("groups.create", sessionTokenA!, {
      name: circleName,
      privacy: "private",
    });
    groupId = created?.result?.data?.group?.id;
    const inviteCode = created?.result?.data?.group?.inviteCode;
    expect(groupId).toBeTruthy();
    await trpcPost("groups.joinByCode", sessionTokenB!, { inviteCode });
    const posted = await trpcPost("commons.createPost", sessionTokenA!, {
      coopId: COOP_ID,
      circleId: groupId,
      content: firstPost,
    });
    const postId = posted?.result?.data?.post?.id;
    expect(postId).toBeTruthy();
    postIds.push(postId);
    const commented = await trpcPost("commons.createComment", sessionTokenA!, {
      postId,
      content: `E2E unread comment ${runId}`,
    });
    expect(commented?.result?.data).toBeTruthy();

    // B sees two new things on the circle in Circle View.
    const pageB = userB.page;
    await pageB.goto("/");
    const tileB = circleTile(pageB, circleName);
    await expect(tileB).toBeVisible({ timeout: 20_000 });
    await expect(tileB).toHaveAccessibleName(`${circleName}, 2 new`);
    await expect(tileB.getByTestId("circle-unread-badge")).toHaveText("2");

    // A wrote both, so A has nothing new there.
    await userA.page.goto("/");
    const tileA = circleTile(userA.page, circleName);
    await expect(tileA).toBeVisible({ timeout: 20_000 });
    await expect(tileA.getByTestId("circle-unread-badge")).toHaveCount(0);

    // Opening the circle reads it.
    await tileB.click();
    await expect(pageB).toHaveURL(new RegExp(`circleId=${groupId}`));
    await expect(pageB.getByText(firstPost).first()).toBeVisible();

    await pageB.goto("/");
    await expect(tileB).toBeVisible({ timeout: 20_000 });
    await expect(tileB.getByTestId("circle-unread-badge")).toHaveCount(0);
    await pageB.reload();
    await expect(tileB).toBeVisible({ timeout: 20_000 });
    await expect(tileB.getByTestId("circle-unread-badge")).toHaveCount(0);

    // Something new after that brings the badge back, counting only the new post.
    const followUp = await trpcPost("commons.createPost", sessionTokenA!, {
      coopId: COOP_ID,
      circleId: groupId,
      content: secondPost,
    });
    const followUpId = followUp?.result?.data?.post?.id;
    expect(followUpId).toBeTruthy();
    postIds.push(followUpId);

    await pageB.reload();
    await expect(tileB).toBeVisible({ timeout: 20_000 });
    await expect(tileB).toHaveAccessibleName(`${circleName}, 1 new`);
    await expect(tileB.getByTestId("circle-unread-badge")).toHaveText("1");
  } finally {
    const sessionTokenA = await sessionTokenFor(userA.page).catch(() => null);
    const sessionTokenB = await sessionTokenFor(userB.page).catch(() => null);
    if (sessionTokenA) {
      for (const postId of postIds) {
        await trpcPost("commons.deletePost", sessionTokenA, { postId }).catch(
          () => {},
        );
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
