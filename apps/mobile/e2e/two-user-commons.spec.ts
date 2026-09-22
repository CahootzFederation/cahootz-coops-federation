import { expect, test } from "@playwright/test";
import { newSignedInPage, openGeneralFeed } from "./support/auth";

const API_BASE_URL = process.env.E2E_API_BASE_URL || "http://localhost:3001";
const USER_A_EMAIL =
  process.env.E2E_USER_A_EMAIL || "releaseclick1@test.cahootz.local";
const USER_B_EMAIL =
  process.env.E2E_USER_B_EMAIL || "releaseclick2@test.cahootz.local";

test("signing out one user does not sign out the other user", async ({
  browser,
}) => {
  const userA = await newSignedInPage(browser, USER_A_EMAIL);
  const userB = await newSignedInPage(browser, USER_B_EMAIL);

  try {
    await userA.page.getByLabel("Open menu").click();
    await userA.page
      .getByText(new RegExp(`Sign Out \\(@${USER_A_EMAIL.split("@")[0]}\\)`))
      .click();
    await expect(userA.page.getByLabel("Open menu")).toBeVisible();
    await userA.page.getByLabel("Open menu").click();
    await expect(
      userA.page.getByText("Sign In", { exact: true }),
    ).toBeVisible();

    await userB.page.reload();
    await userB.page.getByLabel("Open menu").click();
    await expect(
      userB.page.getByText(
        new RegExp(`Sign Out \\(@${USER_B_EMAIL.split("@")[0]}\\)`),
      ),
    ).toBeVisible();
  } finally {
    await userA.context.close();
    await userB.context.close();
  }
});

test("two users can complete a post and comment workflow in separate sessions", async ({
  browser,
}) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const postText = `E2E two-user post ${runId}`;
  const commentText = `E2E reply from user B ${runId}`;

  const userA = await newSignedInPage(browser, USER_A_EMAIL);
  const userB = await newSignedInPage(browser, USER_B_EMAIL);
  let createdPostId: string | undefined;

  try {
    await openGeneralFeed(userA.page);
    await openGeneralFeed(userB.page);

    const composer = userA.page.getByRole("textbox", {
      name: "Share what's happening...",
    });
    await composer.fill(postText);
    await userA.page.getByLabel("Post", { exact: true }).click();
    await expect(composer).toHaveValue("");
    await expect(
      userA.page.getByText(postText, { exact: true }).first(),
    ).toBeVisible();

    await userB.page.reload();
    const userBPost = userB.page.getByText(postText, { exact: true });
    await expect(userBPost).toBeVisible();
    await userBPost.click();
    await expect(userB.page).toHaveURL(/\/posts\/[^/]+$/);
    createdPostId = new URL(userB.page.url()).pathname.split("/").pop();
    await expect(
      userB.page.getByText(postText, { exact: true }).last(),
    ).toBeVisible();

    await userB.page.getByPlaceholder("Write a comment...").fill(commentText);
    await userB.page.getByLabel("Send comment").click();
    await expect(
      userB.page.getByText(commentText, { exact: true }).last(),
    ).toBeVisible();

    await userA.page.reload();
    await userA.page.getByText(postText, { exact: true }).click();
    await expect(
      userA.page.getByText(commentText, { exact: true }).last(),
    ).toBeVisible();
  } finally {
    if (createdPostId) {
      const sessionToken = await userA.page.evaluate(() =>
        window.localStorage.getItem("cahootz.sessionToken"),
      );
      if (sessionToken) {
        const cleanupResponse = await fetch(
          `${API_BASE_URL}/trpc/commons.deletePost`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-session-token": sessionToken,
            },
            body: JSON.stringify({ postId: createdPostId }),
          },
        );
        expect(cleanupResponse.ok).toBe(true);
      }
    }
    await userA.context.close();
    await userB.context.close();
  }
});
