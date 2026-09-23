import { expect, test } from "@playwright/test";
import { newSignedInPage, openGeneralFeed } from "./support/auth";

const API_BASE_URL = process.env.E2E_API_BASE_URL || "http://localhost:3001";
const USER_A_EMAIL =
  process.env.E2E_USER_A_EMAIL || "releaseclick1@test.cahootz.local";
const USER_B_EMAIL =
  process.env.E2E_USER_B_EMAIL || "releaseclick2@test.cahootz.local";

async function sessionTokenFor(page: import("@playwright/test").Page) {
  return page.evaluate(() =>
    window.localStorage.getItem("cahootz.sessionToken"),
  );
}

async function deleteEventPost(
  sessionToken: string | null,
  postId: string | undefined,
) {
  if (!sessionToken || !postId) return;
  const response = await fetch(`${API_BASE_URL}/trpc/commons.deletePost`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-session-token": sessionToken,
    },
    body: JSON.stringify({ postId }),
  });
  expect(response.ok).toBe(true);
}

async function fillEventForm(
  page: import("@playwright/test").Page,
  title: string,
) {
  const startAt = new Date(Date.now() + 60 * 60 * 1000);
  const date = startAt.toISOString().slice(0, 10);
  const time = `${String(startAt.getHours()).padStart(2, "0")}:${String(
    startAt.getMinutes(),
  ).padStart(2, "0")}`;

  await page.getByPlaceholder("New member welcome").fill(title);
  await page.getByLabel("Date", { exact: true }).fill(date);
  await page.getByLabel("Start time", { exact: true }).fill(time);
  await page.getByLabel("Publish event").click();
}

test("creating an event shows it inline in the feed and in the upcoming module", async ({
  browser,
}) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const title = `E2E Welcome Table ${runId}`;
  const { context, page } = await newSignedInPage(browser, USER_A_EMAIL);
  let eventId: string | undefined;

  try {
    await openGeneralFeed(page);
    await page.getByLabel("Create event").click();
    await expect(page.getByText("Create event", { exact: true })).toBeVisible();
    await fillEventForm(page, title);

    await expect(page).toHaveURL(/\/events\/[^/]+$/, { timeout: 20000 });
    eventId = new URL(page.url()).pathname.split("/").pop();
    await expect(page.getByText(title, { exact: true }).first()).toBeVisible();

    // Going back returns to the same, already-mounted feed screen instance,
    // which does not auto-refetch - reload to force a fresh fetch that
    // includes the event just created, same as other cross-navigation
    // assertions in this suite.
    await page.getByLabel("Go back").click();
    await page.reload();
    await expect(
      page.getByText(title, { exact: true }).first(),
    ).toBeVisible({ timeout: 20000 });
    await expect(page.getByText("Upcoming", { exact: true })).toBeVisible();
  } finally {
    const sessionToken = await sessionTokenFor(page);
    if (sessionToken && eventId) {
      const input = encodeURIComponent(JSON.stringify({ eventId }));
      const detail = await fetch(
        `${API_BASE_URL}/trpc/events.get?input=${input}`,
      ).then((res) => res.json());
      await deleteEventPost(sessionToken, detail?.result?.data?.post?.id);
    }
    await context.close();
  }
});

test("a second member's RSVP updates the going count for the event creator", async ({
  browser,
}) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const title = `E2E Circle Mixer ${runId}`;

  const userA = await newSignedInPage(browser, USER_A_EMAIL);
  const userB = await newSignedInPage(browser, USER_B_EMAIL);
  let eventId: string | undefined;

  try {
    await openGeneralFeed(userA.page);
    await userA.page.getByLabel("Create event").click();
    await fillEventForm(userA.page, title);
    await expect(userA.page).toHaveURL(/\/events\/[^/]+$/, { timeout: 20000 });
    eventId = new URL(userA.page.url()).pathname.split("/").pop();

    await openGeneralFeed(userB.page);
    // Defensive reload - see the note in the previous test about the feed
    // screen not auto-refetching after cross-navigation.
    await userB.page.reload();
    await expect(
      userB.page.getByText(title, { exact: true }).first(),
    ).toBeVisible({ timeout: 20000 });
    await userB.page.getByText(title, { exact: true }).first().click();
    await expect(userB.page).toHaveURL(/\/events\/[^/]+$/, { timeout: 20000 });
    // Match the event detail screen's "Going (N)" label specifically - the
    // feed card behind it (still mounted under the pushed route) also has a
    // plain "Going" RSVP button, which a bare /^Going/ match can pick up
    // while it's hidden, causing a flaky toBeVisible() failure.
    const detailGoingButton = userB.page.getByText(/^Going \(/, {
      exact: false,
    });
    await expect(detailGoingButton.first()).toBeVisible({ timeout: 20000 });
    await detailGoingButton.first().click();

    await userA.page.reload();
    await expect(userA.page.getByText(/Going \(2\)/)).toBeVisible({
      timeout: 20000,
    });
  } finally {
    const sessionTokenA = await sessionTokenFor(userA.page);
    if (sessionTokenA && eventId) {
      const input = encodeURIComponent(JSON.stringify({ eventId }));
      const detail = await fetch(
        `${API_BASE_URL}/trpc/events.get?input=${input}`,
      ).then((res) => res.json());
      await deleteEventPost(sessionTokenA, detail?.result?.data?.post?.id);
    }
    await Promise.all([userA.context.close(), userB.context.close()]);
  }
});

test("a circle leader can pin a post above the upcoming events module", async ({
  browser,
}) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const circleName = `E2E Pin Circle ${runId}`;
  const postText = `E2E pinned announcement ${runId}`;

  const userA = await newSignedInPage(browser, USER_A_EMAIL);
  const userB = await newSignedInPage(browser, USER_B_EMAIL);
  let createdPostId: string | undefined;
  let groupId: string | undefined;

  try {
    const sessionTokenA = await sessionTokenFor(userA.page);
    expect(sessionTokenA).toBeTruthy();

    const createGroupResponse = await fetch(
      `${API_BASE_URL}/trpc/groups.create`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-session-token": sessionTokenA!,
        },
        body: JSON.stringify({ name: circleName, privacy: "public" }),
      },
    ).then((res) => res.json());
    groupId = createGroupResponse?.result?.data?.group?.id;
    const inviteCode = createGroupResponse?.result?.data?.group?.inviteCode;
    expect(groupId).toBeTruthy();

    const sessionTokenB = await sessionTokenFor(userB.page);
    await fetch(`${API_BASE_URL}/trpc/groups.joinByCode`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-session-token": sessionTokenB!,
      },
      body: JSON.stringify({ inviteCode }),
    });

    await userA.page.goto(`/${"cahootz"}/posts?circleId=${groupId}`);
    await expect(
      userA.page.getByRole("textbox", { name: "Share what's happening..." }),
    ).toBeVisible();

    const composer = userA.page.getByRole("textbox", {
      name: "Share what's happening...",
    });
    await composer.fill(postText);
    await userA.page.getByLabel("Post", { exact: true }).click();
    await expect(composer).toHaveValue("");
    await expect(
      userA.page.getByText(postText, { exact: true }).first(),
    ).toBeVisible();

    await userA.page.getByLabel("Pin post").click();
    await expect(userA.page.getByText("Pinned", { exact: true })).toBeVisible();

    await userB.page.goto(`/${"cahootz"}/posts?circleId=${groupId}`);
    await expect(userB.page.getByText("Pinned", { exact: true })).toBeVisible();
    await expect(
      userB.page.getByText(postText, { exact: true }).first(),
    ).toBeVisible();
  } finally {
    const sessionTokenA = await sessionTokenFor(userA.page);
    if (sessionTokenA && groupId) {
      const input = encodeURIComponent(
        JSON.stringify({ coopId: "cahootz", circleId: groupId, limit: 20 }),
      );
      const feed = await fetch(
        `${API_BASE_URL}/trpc/commons.listFeed?input=${input}`,
        { headers: { "x-session-token": sessionTokenA } },
      ).then((res) => res.json());
      const allPosts = [
        ...(feed?.result?.data?.pinnedPost ? [feed.result.data.pinnedPost] : []),
        ...(feed?.result?.data?.posts ?? []),
      ];
      createdPostId = allPosts.find((post: any) => post.body === postText)?.id;
    }
    if (createdPostId) {
      await deleteEventPost(sessionTokenA, createdPostId);
    }
    if (groupId && sessionTokenA) {
      await fetch(`${API_BASE_URL}/trpc/groups.leave`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-session-token": sessionTokenA,
        },
        body: JSON.stringify({ groupId }),
      }).catch(() => {});
    }
    await Promise.all([userA.context.close(), userB.context.close()]);
  }
});
