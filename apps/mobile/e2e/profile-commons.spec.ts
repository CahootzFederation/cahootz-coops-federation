import { expect, test, type Page } from "@playwright/test";
import { newSignedInPage, openGeneralFeed } from "./support/auth";

const API_BASE_URL = process.env.E2E_API_BASE_URL || "http://localhost:3001";
const USER_A_EMAIL =
  process.env.E2E_USER_A_EMAIL || "releaseclick1@test.cahootz.local";
const USER_B_EMAIL =
  process.env.E2E_USER_B_EMAIL || "releaseclick2@test.cahootz.local";

// Fixtures from `pnpm -F @repo/db seed:e2e-marketplace`: User A holds a
// Community Builder badge in the public E2E Market Commons, governs a private
// commons shared with User B, and administers a private commons User B isn't in.
const PUBLIC_COMMONS = "E2E Market Commons";
const SHARED_PRIVATE_COMMONS = "E2E Shared Private Commons";
const SOLO_PRIVATE_COMMONS = "E2E Solo Private Commons";

function handleFor(email: string) {
  return email.split("@")[0].replace(/[^a-z0-9]+/gi, "").toLowerCase();
}

async function displayNameFor(page: Page, email: string) {
  const input = encodeURIComponent(
    JSON.stringify({ handle: handleFor(email), limit: 1 }),
  );
  const response = await page.request.get(
    `${API_BASE_URL}/trpc/commons.getPersonalPage?input=${input}`,
  );
  expect(response.ok()).toBe(true);
  return (await response.json()).result.data.profile.name as string;
}

async function sessionToken(page: Page) {
  return page.evaluate(() => window.localStorage.getItem("cahootz.sessionToken"));
}

test("members open each other's pages from posts and comments and see only the commons they may see", async ({
  browser,
}) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const postText = `E2E profile commons post ${runId}`;
  const commentText = `E2E profile commons reply ${runId}`;

  const userA = await newSignedInPage(browser, USER_A_EMAIL);
  const userB = await newSignedInPage(browser, USER_B_EMAIL);
  const userAName = await displayNameFor(userA.page, USER_A_EMAIL);
  const userBName = await displayNameFor(userB.page, USER_B_EMAIL);
  let createdPostId: string | undefined;

  try {
    // User A posts so User B has somewhere to find A's avatar.
    await openGeneralFeed(userA.page);
    const composer = userA.page.getByRole("textbox", {
      name: "Share what's happening...",
    });
    await composer.fill(postText);
    await userA.page.getByLabel("Post", { exact: true }).click();
    await expect(composer).toHaveValue("");

    // User B taps A's avatar on the post in the feed.
    await openGeneralFeed(userB.page);
    await userB.page.reload();
    await expect(userB.page.getByText(postText, { exact: true })).toBeVisible();
    await userB.page
      .getByLabel(`Open ${userAName}'s personal page`)
      .first()
      .click();
    await expect(userB.page).toHaveURL(
      new RegExp(`/people/${handleFor(USER_A_EMAIL)}`),
    );

    // Public commons with A's badge, and the private commons B shares with A
    // (with A's governor role), are listed; A's other private commons is not.
    await expect(userB.page.getByText(PUBLIC_COMMONS, { exact: true })).toBeVisible();
    await expect(userB.page.getByText("Community Builder", { exact: true })).toBeVisible();
    await expect(userB.page.getByText(SHARED_PRIVATE_COMMONS, { exact: true })).toBeVisible();
    await expect(userB.page.getByText("Governor", { exact: true })).toBeVisible();
    await expect(userB.page.getByText(SOLO_PRIVATE_COMMONS, { exact: true })).toHaveCount(0);
    await expect(userB.page.getByText("Admin", { exact: true })).toHaveCount(0);

    // Still hidden after a reload.
    await userB.page.reload();
    await expect(userB.page.getByText(SHARED_PRIVATE_COMMONS, { exact: true })).toBeVisible();
    await expect(userB.page.getByText(SOLO_PRIVATE_COMMONS, { exact: true })).toHaveCount(0);

    // User B comments on A's post.
    // The General feed has no URL of its own, so reopen it from Circle View.
    await userB.page.goto("/");
    await openGeneralFeed(userB.page);
    await userB.page.getByText(postText, { exact: true }).click();
    await expect(userB.page).toHaveURL(/\/posts\/[^/]+$/);
    createdPostId = new URL(userB.page.url()).pathname.split("/").pop();
    await userB.page.getByPlaceholder("Write a comment...").fill(commentText);
    await userB.page.getByLabel("Send comment").click();
    await expect(userB.page.getByText(commentText, { exact: true }).last()).toBeVisible();

    // User A opens the post and taps B's name on the comment.
    await userA.page.goto("/");
    await openGeneralFeed(userA.page);
    await userA.page.getByText(postText, { exact: true }).click();
    await expect(userA.page.getByText(commentText, { exact: true }).last()).toBeVisible();
    await userA.page
      .getByLabel(`Open ${userBName}'s personal page`)
      .last()
      .click();
    await expect(userA.page).toHaveURL(
      new RegExp(`/people/${handleFor(USER_B_EMAIL)}`),
    );
    await expect(userA.page.getByText(SHARED_PRIVATE_COMMONS, { exact: true })).toBeVisible();
    await expect(userA.page.getByText(SOLO_PRIVATE_COMMONS, { exact: true })).toHaveCount(0);

    // On their own page, User A sees every commons they're in, private ones included.
    await userA.page.goto("/personal-page");
    await expect(userA.page.getByText(SOLO_PRIVATE_COMMONS, { exact: true })).toBeVisible();
    await expect(userA.page.getByText("Admin", { exact: true })).toBeVisible();
    await expect(userA.page.getByText(SHARED_PRIVATE_COMMONS, { exact: true })).toBeVisible();
    await expect(userA.page.getByText(PUBLIC_COMMONS, { exact: true })).toBeVisible();
  } finally {
    if (createdPostId) {
      const token = await sessionToken(userA.page);
      if (token) {
        const cleanupResponse = await fetch(`${API_BASE_URL}/trpc/commons.deletePost`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-session-token": token },
          body: JSON.stringify({ postId: createdPostId }),
        });
        expect(cleanupResponse.ok).toBe(true);
      }
    }
    await userA.context.close();
    await userB.context.close();
  }
});
