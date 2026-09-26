import { expect, test, type Page } from "@playwright/test";
import { USER_A_EMAIL, USER_B_EMAIL, newSignedInPage } from "./support/auth";

const API_BASE_URL = process.env.E2E_API_BASE_URL || "http://localhost:3001";

async function sessionTokenFor(page: Page) {
  const token = await page.evaluate(() =>
    window.localStorage.getItem("cahootz.sessionToken"),
  );
  if (!token) throw new Error("Missing session token after sign-in");
  return token;
}

async function trpc(
  method: "GET" | "POST",
  path: string,
  sessionToken: string,
  input: unknown,
) {
  const url =
    method === "GET"
      ? `${API_BASE_URL}/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`
      : `${API_BASE_URL}/trpc/${path}`;
  const response = await fetch(url, {
    method,
    headers: {
      "content-type": "application/json",
      "x-session-token": sessionToken,
    },
    body: method === "POST" ? JSON.stringify(input) : undefined,
  });
  const text = await response.text();
  expect(response.ok, `${path} failed: ${text}`).toBe(true);
  return JSON.parse(text).result.data as any;
}

/** Fixture reset: unseat the user from any welcome lounge they're a newcomer in. */
async function leaveWelcomeLounges(sessionToken: string) {
  const { groups } = await trpc("GET", "groups.listMine", sessionToken, {
    coopId: "cahootz",
  });
  for (const group of groups) {
    if (group.kind !== "WELCOME_TABLE") continue;
    await trpc("POST", "groups.leave", sessionToken, { groupId: group.id });
  }
}

/** Cleanup: delete this run's comments (the intro and the reply) by content. */
async function deleteRunComments(
  sessionToken: string,
  postId: string | null,
  runId: string,
) {
  if (!postId) return;
  const { post } = await trpc("GET", "commons.getPost", sessionToken, {
    postId,
  });
  for (const comment of post.comments) {
    if (!String(comment.body).includes(runId)) continue;
    await fetch(`${API_BASE_URL}/trpc/commons.deleteComment`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-session-token": sessionToken,
      },
      body: JSON.stringify({ commentId: comment.id }),
    }).catch(() => undefined);
  }
}

// A newcomer joins a welcome lounge, answers the intro prompt, and dismisses
// the push primer; another member replies to the intro from the welcome
// thread; the newcomer gets a "replied to your intro" alert that opens the
// thread with their intro highlighted.
test("a newcomer's welcome lounge intro gets a reply alert that opens the intro", async ({
  browser,
}) => {
  const runId = `E2E-${Date.now().toString(36)}`;
  const introText = `${runId} intro: here to meet neighbors and swap garden tips`;
  const replyText = `${runId} welcome aboard, glad you're here`;

  const [member, newcomer] = await Promise.all([
    newSignedInPage(browser, USER_A_EMAIL),
    newSignedInPage(browser, USER_B_EMAIL),
  ]);
  const memberToken = await sessionTokenFor(member.page);
  const newcomerToken = await sessionTokenFor(newcomer.page);
  let welcomePostId: string | null = null;

  try {
    // Fixture setup: unseat both shared accounts (leaving also drops any
    // earlier run's intro record), seat User A in the open lounge, and
    // clear both inboxes so the new alerts are the only unread ones.
    await leaveWelcomeLounges(newcomerToken);
    await leaveWelcomeLounges(memberToken);
    const lounge = await trpc("POST", "groups.assignWelcomeTable", memberToken, {
      coopId: "cahootz",
    });
    await trpc("POST", "notification.markAllAsRead", memberToken, {});
    await trpc("POST", "notification.markAllAsRead", newcomerToken, {});

    // User B joins through the real UI and is prompted for an intro.
    await newcomer.page.reload();
    await newcomer.page
      .getByText("Join a welcome lounge", { exact: true })
      .click();
    await expect(
      newcomer.page.getByText(lounge.name, { exact: true }).first(),
    ).toBeVisible();
    await expect(
      newcomer.page.getByText("Say hi — what brought you here?", { exact: true }),
    ).toBeVisible();
    await newcomer.page.getByLabel("Your intro").fill(introText);
    await newcomer.page.getByRole("button", { name: "Post intro" }).click();
    await expect(
      newcomer.page.getByText("Your intro is posted 🎉"),
    ).toBeVisible();

    // The push primer appears right after posting; "Not now" dismisses it
    // without an OS prompt.
    await expect(
      newcomer.page.getByText("Want a heads-up when someone welcomes you?"),
    ).toBeVisible();
    await newcomer.page.getByRole("button", { name: "Not now" }).click();
    await expect(
      newcomer.page.getByText("Want a heads-up when someone welcomes you?"),
    ).toBeHidden();

    const status = await trpc(
      "GET",
      "groups.getWelcomeIntroStatus",
      newcomerToken,
      { groupId: lounge.groupId },
    );
    welcomePostId = status.welcomePostId;
    expect(status.intro?.respondedAt ?? null).toBeNull();

    // User A opens the lounge's welcome thread from the join alert and
    // replies to User B's intro.
    await member.page.reload();
    await member.page.getByLabel("Alerts", { exact: true }).click();
    await member.page
      .getByLabel(`Unread: 👋 New member in ${lounge.name}`)
      .first()
      .click();
    const introComment = member.page
      .getByTestId(/^comment-/)
      .filter({ hasText: introText });
    await expect(introComment).toBeVisible();
    await introComment.getByRole("button", { name: /^Reply to / }).click();
    await expect(member.page.getByText(/^Replying to /)).toBeVisible();
    const composer = member.page.getByPlaceholder("Write a comment...");
    await composer.click();
    await composer.press("End");
    await composer.pressSequentially(replyText);
    await member.page.getByLabel("Send comment").click();
    await expect(
      member.page.getByTestId(/^comment-/).filter({ hasText: replyText }),
    ).toBeVisible();

    // User B reloads, sees the reply alert, and it opens on their intro.
    await newcomer.page.reload();
    await newcomer.page.getByLabel("Alerts", { exact: true }).click();
    const replyAlert = newcomer.page
      .getByLabel(/^Unread: 💬 .+ replied to your intro$/)
      .first();
    await expect(replyAlert).toBeVisible();
    await replyAlert.click();
    const highlighted = newcomer.page.getByLabel("Highlighted comment");
    await expect(highlighted).toBeVisible();
    await expect(highlighted).toContainText(introText);
    await expect(highlighted.getByText("Your intro", { exact: true })).toBeVisible();
    // Scoped to the thread's comments: the lounge feed underneath (still
    // mounted, hidden) can preview the same reply text.
    await expect(
      newcomer.page.getByTestId(/^comment-/).filter({ hasText: replyText }),
    ).toBeVisible();

    // The intro prompt doesn't come back once the intro is posted.
    await newcomer.page.goto("/");
    await newcomer.page.getByText(lounge.name, { exact: true }).first().click();
    await expect(
      newcomer.page.getByRole("textbox", { name: "Share what's happening..." }),
    ).toBeVisible();
    await expect(
      newcomer.page.getByText("Say hi — what brought you here?", { exact: true }),
    ).toBeHidden();
  } finally {
    await deleteRunComments(memberToken, welcomePostId, runId).catch(() => undefined);
    await deleteRunComments(newcomerToken, welcomePostId, runId).catch(() => undefined);
    await leaveWelcomeLounges(newcomerToken).catch(() => undefined);
    await Promise.all([member.context.close(), newcomer.context.close()]);
  }
});
