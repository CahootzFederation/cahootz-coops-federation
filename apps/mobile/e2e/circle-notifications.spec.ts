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

async function openCircleSettings(page: Page, groupId: string) {
  await page.goto(`/${COOP_ID}/posts?circleId=${groupId}`);
  await page.getByLabel("Circle settings and members").click();
  await expect(
    page.getByRole("radiogroup", { name: "Circle notifications" }),
  ).toBeVisible();
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
  await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
}

test("a circle member chooses which circle activity notifies them", async ({
  browser,
}) => {
  // Two sign-ins plus two circle posts can exceed the default 90s budget.
  test.setTimeout(150_000);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const circleName = `E2E Notify Circle ${runId}`;
  const firstPost = `E2E notify first ${runId}`;
  const mutedPost = `E2E notify muted ${runId}`;
  const circleAlert = new RegExp(`posted in ${circleName}\\.`);

  const userA = await newSignedInPage(browser, USER_A_EMAIL);
  const userB = await newSignedInPage(browser, USER_B_EMAIL);
  let groupId: string | undefined;

  try {
    const sessionTokenA = await sessionTokenFor(userA.page);
    const sessionTokenB = await sessionTokenFor(userB.page);
    expect(sessionTokenA).toBeTruthy();
    expect(sessionTokenB).toBeTruthy();

    const created = await trpcPost("groups.create", sessionTokenA!, {
      name: circleName,
      privacy: "private",
    });
    groupId = created?.result?.data?.group?.id;
    const inviteCode = created?.result?.data?.group?.inviteCode;
    expect(groupId).toBeTruthy();
    await trpcPost("groups.joinByCode", sessionTokenB!, { inviteCode });

    // B opens circle settings: "Only @mentions" is the default.
    await openCircleSettings(userB.page, groupId!);
    const allActivity = userB.page.getByRole("radio", { name: "All activity" });
    const onlyMentions = userB.page.getByRole("radio", {
      name: "Only @mentions",
    });
    const nothing = userB.page.getByRole("radio", { name: "Nothing" });
    await expect(onlyMentions).toBeChecked();

    await allActivity.click();
    await expect(allActivity).toBeChecked();
    await userB.page.reload();
    await expect(allActivity).toBeChecked();
    await expect(onlyMentions).not.toBeChecked();

    // A posts; B (on "All activity") gets a circle alert.
    await postInCircle(userA.page, groupId!, firstPost);
    await userB.page.goto("/notifications");
    await expect(
      userB.page.getByText("Alerts", { exact: true }).first(),
    ).toBeVisible();
    await expect(async () => {
      await userB.page.reload();
      await expect(userB.page.getByText(circleAlert)).toHaveCount(1);
    }).toPass({ timeout: 20_000 });

    // B mutes the circle; A's next post creates no alert.
    await openCircleSettings(userB.page, groupId!);
    await nothing.click();
    await expect(nothing).toBeChecked();
    await userB.page.reload();
    await expect(nothing).toBeChecked();

    await postInCircle(userA.page, groupId!, mutedPost);
    await userB.page.waitForTimeout(2_000);
    await userB.page.goto("/notifications");
    await expect(
      userB.page.getByText("Alerts", { exact: true }).first(),
    ).toBeVisible();
    await expect(userB.page.getByText(circleAlert)).toHaveCount(1);
  } finally {
    const sessionTokenA = await sessionTokenFor(userA.page).catch(() => null);
    const sessionTokenB = await sessionTokenFor(userB.page).catch(() => null);
    if (sessionTokenA && groupId) {
      const input = encodeURIComponent(
        JSON.stringify({ coopId: COOP_ID, circleId: groupId, limit: 20 }),
      );
      const feed = await fetch(
        `${API_BASE_URL}/trpc/commons.listFeed?input=${input}`,
        { headers: { "x-session-token": sessionTokenA } },
      ).then((res) => res.json());
      const posts: Array<{ id: string; body: string }> =
        feed?.result?.data?.posts ?? [];
      for (const post of posts) {
        if (post.body === firstPost || post.body === mutedPost) {
          await trpcPost("commons.deletePost", sessionTokenA, {
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
