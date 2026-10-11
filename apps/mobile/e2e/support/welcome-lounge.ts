import { expect, type Page } from "@playwright/test";

/** Fixture helpers shared by the welcome lounge intro journeys. */

export const API_BASE_URL =
  process.env.E2E_API_BASE_URL || "http://localhost:3001";

export async function sessionTokenFor(page: Page) {
  const token = await page.evaluate(() =>
    window.localStorage.getItem("cahootz.sessionToken"),
  );
  if (!token) throw new Error("Missing session token after sign-in");
  return token;
}

export async function trpc(
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

/**
 * Fixture reset: unseat the user from any welcome lounge they're a newcomer
 * in. Leaving also drops their intro record, so a rejoin prompts again.
 */
export async function leaveWelcomeLounges(sessionToken: string) {
  const { groups } = await trpc("GET", "groups.listMine", sessionToken, {
    coopId: "cahootz",
  });
  for (const group of groups) {
    if (group.kind !== "WELCOME_TABLE") continue;
    await trpc("POST", "groups.leave", sessionToken, { groupId: group.id });
  }
}

/**
 * Marks only stale welcome-journey alerts as read. The fixture accounts are
 * shared across workers, so clearing the whole inbox can erase an alert that
 * an unrelated notification journey has just created.
 */
export async function markWelcomeNotificationsAsRead(
  sessionToken: string,
  lounge: { groupId: string; postId: string | null },
) {
  const welcomeTypes = new Set([
    "WELCOME_LOUNGE_JOIN",
    "WELCOME_INTRO_REPLY",
    "WELCOME_INTRO_UNANSWERED",
    "WELCOME_INTRO_UNANSWERED_ADMIN",
    "COMMONS_COMMENT_LIKE",
  ]);
  const { notifications } = await trpc(
    "GET",
    "notification.getNotifications",
    sessionToken,
    { unreadOnly: true, limit: 50 },
  );
  for (const notification of notifications) {
    if (!welcomeTypes.has(notification.type)) continue;
    const data = notification.data as
      | { groupId?: string; postId?: string }
      | null;
    if (
      data?.groupId !== lounge.groupId &&
      (!lounge.postId || data?.postId !== lounge.postId)
    ) {
      continue;
    }
    await trpc("POST", "notification.markAsRead", sessionToken, {
      notificationId: notification.id,
    });
  }
}

/**
 * Cleanup: remove this viewer's reactions on, then delete, the comments on
 * `postId` whose text contains `runId` (deleting a comment also cascades
 * its reactions and intro record; un-reacting first covers comments the
 * viewer can't delete).
 */
export async function cleanUpRunComments(
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
    const call = (path: string) =>
      fetch(`${API_BASE_URL}/trpc/${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-session-token": sessionToken,
        },
        body: JSON.stringify({ commentId: comment.id }),
      }).catch(() => undefined);
    if (comment.viewerReacted) await call("commons.toggleCommentReaction");
    await call("commons.deleteComment");
  }
}

/**
 * Fixture setup shared by the intro journeys: unseat both accounts, seat the
 * member in the open lounge, and clear stale welcome alerts. Returns the
 * member's lounge.
 */
export async function seatMemberInOpenLounge(
  memberToken: string,
  newcomerToken: string,
) {
  await leaveWelcomeLounges(newcomerToken);
  await leaveWelcomeLounges(memberToken);
  const lounge = await trpc("POST", "groups.assignWelcomeTable", memberToken, {
    coopId: "cahootz",
  });
  const status = await trpc(
    "GET",
    "groups.getWelcomeIntroStatus",
    memberToken,
    { groupId: lounge.groupId },
  );
  const alertScope = {
    groupId: lounge.groupId as string,
    postId: (status.welcomePostId as string | null) ?? null,
  };
  await markWelcomeNotificationsAsRead(memberToken, alertScope);
  await markWelcomeNotificationsAsRead(newcomerToken, alertScope);
  return lounge as { groupId: string; name: string };
}

/** The newcomer joins through the real Circle View card and posts an intro from the lounge prompt. */
export async function joinLoungeAndPostIntro(
  page: Page,
  loungeName: string,
  introText: string,
) {
  await page.reload();
  await page.getByText("Join a welcome lounge", { exact: true }).click();
  await expect(page.getByText(loungeName, { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText("Say hi — what brought you here?", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Your intro").fill(introText);
  await page.getByRole("button", { name: "Post intro" }).click();
  await expect(page.getByText("Your intro is posted 🎉")).toBeVisible();
}

/** Dismisses the push primer that follows a posted intro, without an OS prompt. */
export async function dismissPushPrimer(page: Page) {
  const primer = page.getByText("Want a heads-up when someone welcomes you?");
  await expect(primer).toBeVisible();
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(primer).toBeHidden();
}

/** Opens the lounge's welcome thread from the member's "New member" alert. */
export async function openWelcomeThreadFromJoinAlert(
  page: Page,
  loungeName: string,
) {
  await page.reload();
  await page.getByLabel("Alerts", { exact: true }).click();
  await page
    .getByLabel(`Unread: 👋 New member in ${loungeName}`)
    .first()
    .click();
}

/** A comment card in the post detail thread, found by its text. */
export function threadComment(page: Page, text: string) {
  return page.getByTestId(/^comment-/).filter({ hasText: text });
}
