import { expect, test, type Page } from "@playwright/test";
import { newSignedInPage, USER_A_EMAIL, USER_B_EMAIL } from "./support/auth";

const API_BASE_URL = process.env.E2E_API_BASE_URL || "http://localhost:3001";

type StoredUser = { id: string; name?: string | null; email: string; handle: string };

async function storedUser(page: Page): Promise<StoredUser> {
  const raw = await page.evaluate(() => window.localStorage.getItem("cahootz.user"));
  const user = JSON.parse(raw || "{}");
  expect(user.id).toBeTruthy();
  expect(user.handle).toBeTruthy();
  return user;
}

// Mirrors the API's displayName(): a person's name, else their email prefix.
function displayName(user: StoredUser) {
  return user.name || user.email.split("@")[0];
}

async function trpc(page: Page, path: string, input: Record<string, unknown>) {
  const sessionToken = await page.evaluate(() =>
    window.localStorage.getItem("cahootz.sessionToken"),
  );
  const response = await fetch(`${API_BASE_URL}/trpc/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-session-token": sessionToken! },
    body: JSON.stringify(input),
  });
  return response.json();
}

// A DM is a private circle shared by exactly two people: A starts it from
// B's profile, B sees it as unread, opens it, and replies; A sees the reply
// without reloading, and the conversation survives a reload. The DM circle
// never shows up in Circle View's list of circles.
test("two members exchange direct messages in a private two-person circle", async ({
  browser,
}) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const firstMessage = `E2E DM hello ${runId}`;
  const reply = `E2E DM reply ${runId}`;

  const userA = await newSignedInPage(browser, USER_A_EMAIL);
  const userB = await newSignedInPage(browser, USER_B_EMAIL);
  let groupId: string | undefined;

  try {
    const personA = await storedUser(userA.page);
    const personB = await storedUser(userB.page);

    // A opens B's public page and taps Message.
    await userA.page.goto(`/people/${personB.handle}`);
    await userA.page.getByLabel(`Message ${displayName(personB)}`).click();
    const composerA = userA.page.getByRole("textbox", {
      name: `Message ${displayName(personB)}`,
    });
    await expect(composerA).toBeVisible();
    await expect(userA.page.getByText("Private circle · only you two")).toBeVisible();

    await composerA.fill(firstMessage);
    await userA.page.getByLabel("Send message").click();
    await expect(userA.page.getByText(firstMessage)).toBeVisible();
    await expect(composerA).toHaveValue("");

    // B opens Messages and sees an unread conversation from A.
    await userB.page.goto("/messages");
    const threadWithA = userB.page.getByLabel(`Conversation with ${displayName(personA)}`);
    await expect(threadWithA).toBeVisible();
    await expect(threadWithA).toContainText(firstMessage);
    await expect(threadWithA.getByLabel(/\d+ unread/)).toBeVisible();

    await threadWithA.click();
    await expect(userB.page.getByText(firstMessage).last()).toBeVisible();
    // Opening it marks it read for B only.
    await expect(threadWithA.getByLabel(/\d+ unread/)).toHaveCount(0);

    await userB.page
      .getByRole("textbox", { name: `Message ${displayName(personA)}` })
      .fill(reply);
    await userB.page.getByLabel("Send message").click();
    await expect(userB.page.getByText(reply).last()).toBeVisible();

    // A's open conversation picks up the reply without a reload.
    await expect(userA.page.getByText(reply).last()).toBeVisible({ timeout: 20_000 });

    // The conversation persists across a reload for both people.
    await userB.page.reload();
    await userB.page.getByLabel(`Conversation with ${displayName(personA)}`).click();
    await expect(userB.page.getByText(firstMessage).last()).toBeVisible();
    await expect(userB.page.getByText(reply).last()).toBeVisible();

    // Look up the DM circle for cleanup (fixture only; the journey above is all UI).
    const threads = await fetch(`${API_BASE_URL}/trpc/groups.listDirect`, {
      headers: {
        "x-session-token": (await userA.page.evaluate(() =>
          window.localStorage.getItem("cahootz.sessionToken"),
        ))!,
      },
    }).then((res) => res.json());
    groupId = threads?.result?.data?.threads?.find(
      (thread: { person: { id: string } }) => thread.person.id === personB.id,
    )?.groupId;
    expect(groupId).toBeTruthy();

    // A DM is a circle, but never listed as one.
    await userA.page.goto("/");
    await expect(userA.page.getByText("General", { exact: true })).toBeVisible();
    await expect(userA.page.getByText("Direct message", { exact: true })).toHaveCount(0);
  } finally {
    // Both people leaving deletes the DM circle and its messages.
    if (groupId) {
      await trpc(userA.page, "groups.leave", { groupId });
      await trpc(userB.page, "groups.leave", { groupId });
    }
    await Promise.all([userA.context.close(), userB.context.close()]);
  }
});

// Regression: the message box used to sit at the end of the scrolling
// conversation, so in a long thread (or with the keyboard up) Send was out of
// reach. It is now pinned below the conversation and stays on screen.
test("the message box and Send stay on screen in a long conversation", async ({ browser }) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const userA = await newSignedInPage(browser, USER_A_EMAIL);
  const userB = await newSignedInPage(browser, USER_B_EMAIL);
  let groupId: string | undefined;

  try {
    const personB = await storedUser(userB.page);

    // Fixture: a conversation long enough to fill the screen.
    const opened = await trpc(userA.page, "groups.openDirect", { userId: personB.id });
    groupId = opened?.result?.data?.groupId;
    expect(groupId).toBeTruthy();
    for (let index = 1; index <= 12; index += 1) {
      await trpc(userA.page, "groups.sendDirect", {
        groupId,
        content: `E2E DM filler ${index} ${runId}`,
      });
    }

    await userA.page.goto(`/people/${personB.handle}`);
    await userA.page.getByLabel(`Message ${displayName(personB)}`).click();
    await expect(userA.page.getByText(`E2E DM filler 12 ${runId}`).last()).toBeAttached();

    const composer = userA.page.getByRole("textbox", { name: `Message ${displayName(personB)}` });
    const send = userA.page.getByLabel("Send message");
    await expect(composer).toBeInViewport();
    await expect(send).toBeInViewport();

    // Typing and sending works without scrolling to find the button.
    const message = `E2E DM pinned send ${runId}`;
    await composer.fill(message);
    await send.click();
    await expect(userA.page.getByText(message).last()).toBeAttached();
    await expect(composer).toHaveValue("");
    await expect(send).toBeInViewport();
  } finally {
    if (groupId) {
      await trpc(userA.page, "groups.leave", { groupId });
      await trpc(userB.page, "groups.leave", { groupId });
    }
    await Promise.all([userA.context.close(), userB.context.close()]);
  }
});
