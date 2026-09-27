import { expect, test } from "@playwright/test";
import { USER_A_EMAIL, USER_B_EMAIL, newSignedInPage } from "./support/auth";
import {
  cleanUpRunComments,
  dismissPushPrimer,
  joinLoungeAndPostIntro,
  leaveWelcomeLounges,
  openWelcomeThreadFromJoinAlert,
  seatMemberInOpenLounge,
  sessionTokenFor,
  threadComment,
  trpc,
} from "./support/welcome-lounge";

// Both journeys here reseat the shared fixture accounts in the open lounge,
// so they live in one file to run in order rather than in parallel.

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
    const lounge = await seatMemberInOpenLounge(memberToken, newcomerToken);

    // User B joins through the real UI, posts an intro from the prompt, and
    // dismisses the push primer that follows.
    await joinLoungeAndPostIntro(newcomer.page, lounge.name, introText);
    await dismissPushPrimer(newcomer.page);

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
    await openWelcomeThreadFromJoinAlert(member.page, lounge.name);
    const introComment = threadComment(member.page, introText);
    await expect(introComment).toBeVisible();
    await introComment.getByRole("button", { name: /^Reply to / }).click();
    await expect(member.page.getByText(/^Replying to /)).toBeVisible();
    const composer = member.page.getByPlaceholder("Write a comment...");
    await composer.click();
    await composer.press("End");
    await composer.pressSequentially(replyText);
    await member.page.getByLabel("Send comment").click();
    await expect(threadComment(member.page, replyText)).toBeVisible();

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
    await expect(threadComment(newcomer.page, replyText)).toBeVisible();

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
    await cleanUpRunComments(memberToken, welcomePostId, runId).catch(() => undefined);
    await cleanUpRunComments(newcomerToken, welcomePostId, runId).catch(() => undefined);
    await leaveWelcomeLounges(newcomerToken).catch(() => undefined);
    await Promise.all([member.context.close(), newcomer.context.close()]);
  }
});

// A reaction counts as a response to an intro: another member likes the
// newcomer's intro from the welcome thread, and the newcomer gets a one-time
// "reacted to your intro" alert that opens the intro.
test("liking a newcomer's welcome lounge intro sends them a reaction alert", async ({
  browser,
}) => {
  const runId = `E2E-${Date.now().toString(36)}`;
  const introText = `${runId} intro: new in town, looking for a running group`;

  const [member, newcomer] = await Promise.all([
    newSignedInPage(browser, USER_A_EMAIL),
    newSignedInPage(browser, USER_B_EMAIL),
  ]);
  const memberToken = await sessionTokenFor(member.page);
  const newcomerToken = await sessionTokenFor(newcomer.page);
  let welcomePostId: string | null = null;

  try {
    const lounge = await seatMemberInOpenLounge(memberToken, newcomerToken);
    await joinLoungeAndPostIntro(newcomer.page, lounge.name, introText);
    await dismissPushPrimer(newcomer.page);
    welcomePostId = (
      await trpc("GET", "groups.getWelcomeIntroStatus", newcomerToken, {
        groupId: lounge.groupId,
      })
    ).welcomePostId;

    // User A likes User B's intro from the welcome thread; the count updates
    // and survives a reload.
    await openWelcomeThreadFromJoinAlert(member.page, lounge.name);
    const introComment = threadComment(member.page, introText);
    await expect(introComment).toBeVisible();
    await introComment.getByRole("button", { name: /^Like .+'s comment, 0 likes$/ }).click();
    await expect(
      introComment.getByRole("button", { name: /^Remove your like from .+'s comment, 1 like$/ }),
    ).toBeVisible();
    await member.page.reload();
    await expect(
      threadComment(member.page, introText).getByRole("button", {
        name: /^Remove your like from .+'s comment, 1 like$/,
      }),
    ).toBeVisible();

    // User B reloads, sees the reaction alert, and it opens on their intro.
    await newcomer.page.reload();
    await newcomer.page.getByLabel("Alerts", { exact: true }).click();
    const reactionAlert = newcomer.page
      .getByLabel(/^Unread: 💬 .+ reacted to your intro$/)
      .first();
    await expect(reactionAlert).toBeVisible();
    await reactionAlert.click();
    const highlighted = newcomer.page.getByLabel("Highlighted comment");
    await expect(highlighted).toBeVisible();
    await expect(highlighted).toContainText(introText);

    // The reaction answered the intro, so it no longer counts as unanswered.
    const status = await trpc("GET", "groups.getWelcomeIntroStatus", newcomerToken, {
      groupId: lounge.groupId,
    });
    expect(status.intro?.respondedAt).toBeTruthy();
    // ...and that like sent only the intro alert, not a generic like alert.
    const { notifications } = await trpc("GET", "notification.getNotifications", newcomerToken, {
      unreadOnly: true,
    });
    expect(notifications.map((n: { type: string }) => n.type)).not.toContain("COMMONS_COMMENT_LIKE");

    // An ordinary (non-intro) comment: User B posts a follow-up in the
    // thread, User A likes it, and User B gets the comment author's
    // "liked your comment" alert, which opens on that comment.
    const followUpText = `${runId} follow-up: mornings work best for me`;
    const composer = newcomer.page.getByPlaceholder("Write a comment...");
    await composer.click();
    await composer.pressSequentially(followUpText);
    await newcomer.page.getByLabel("Send comment").click();
    await expect(threadComment(newcomer.page, followUpText)).toBeVisible();

    await member.page.reload();
    const followUp = threadComment(member.page, followUpText);
    await expect(followUp).toBeVisible();
    await followUp.getByRole("button", { name: /^Like .+'s comment, 0 likes$/ }).click();
    await expect(
      followUp.getByRole("button", { name: /^Remove your like from .+'s comment, 1 like$/ }),
    ).toBeVisible();

    await newcomer.page.reload();
    await newcomer.page.getByLabel("Alerts", { exact: true }).click();
    const likeAlert = newcomer.page.getByLabel("Unread: Someone liked your comment").first();
    await expect(likeAlert).toBeVisible();
    await likeAlert.click();
    // The earlier intro screen can still be mounted (hidden) in the stack,
    // so pick the highlighted comment by its text.
    const likedComment = newcomer.page
      .getByLabel("Highlighted comment")
      .filter({ hasText: followUpText });
    await expect(likedComment).toBeVisible();
    await expect(likedComment.getByText("Your comment", { exact: true })).toBeVisible();
  } finally {
    // Un-react (User A) and delete the intro (User B, cascading the rest).
    await cleanUpRunComments(memberToken, welcomePostId, runId).catch(() => undefined);
    await cleanUpRunComments(newcomerToken, welcomePostId, runId).catch(() => undefined);
    await leaveWelcomeLounges(newcomerToken).catch(() => undefined);
    await Promise.all([member.context.close(), newcomer.context.close()]);
  }
});
