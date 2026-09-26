import { expect, test, type Page } from "@playwright/test";
import { newSignedInPage } from "./support/auth";

const API_BASE_URL = process.env.E2E_API_BASE_URL || "http://localhost:3001";
const USER_A_EMAIL =
  process.env.E2E_USER_A_EMAIL || "releaseclick1@test.cahootz.local";
const USER_B_EMAIL =
  process.env.E2E_USER_B_EMAIL || "releaseclick2@test.cahootz.local";
const USER_B_HANDLE = USER_B_EMAIL.split("@")[0];

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

// When a newcomer joins a welcome lounge, Sage replies on the lounge's
// welcome post with an @everyone shout-out highlighting them, and every
// other lounge member gets an alert that opens that thread.
test("a newcomer joining a welcome lounge triggers Sage's @everyone alert for the rest of the lounge", async ({
  browser,
}) => {
  const [member, newcomer] = await Promise.all([
    newSignedInPage(browser, USER_A_EMAIL),
    newSignedInPage(browser, USER_B_EMAIL),
  ]);

  try {
    const memberToken = await sessionTokenFor(member.page);
    const newcomerToken = await sessionTokenFor(newcomer.page);

    // Fixture setup: the shared accounts are reused across runs and the join
    // is idempotent, so unseat both, then seat User A in the currently open
    // lounge so User B's fresh join lands alongside them.
    await leaveWelcomeLounges(newcomerToken);
    await leaveWelcomeLounges(memberToken);
    const memberLounge = await trpc(
      "POST",
      "groups.assignWelcomeTable",
      memberToken,
      { coopId: "cahootz" },
    );
    await trpc("POST", "notification.markAllAsRead", memberToken, {});

    // User B joins through the real UI.
    await newcomer.page.reload();
    await newcomer.page
      .getByText("Join a welcome lounge", { exact: true })
      .click();
    await expect(
      newcomer.page.getByRole("textbox", { name: "Share what's happening..." }),
    ).toBeVisible();
    await expect(
      newcomer.page.getByText(memberLounge.name, { exact: true }).first(),
    ).toBeVisible();

    // User A sees the alert and it opens Sage's shout-out on the welcome post.
    await member.page.getByLabel("Alerts", { exact: true }).click();
    const alert = member.page
      .getByLabel(`Unread: 👋 New member in ${memberLounge.name}`)
      .first();
    await expect(alert).toBeVisible();
    await expect(
      member.page.getByText(/Sage: Everyone, please welcome .+! Come say hi\./).first(),
    ).toBeVisible();
    await alert.click();

    await expect(
      member.page.getByText(`Welcome to ${memberLounge.name}`).first(),
    ).toBeVisible();
    await expect(member.page.getByText("@everyone").last()).toBeVisible();
    await expect(
      member.page.getByText(`@${USER_B_HANDLE}`).last(),
    ).toBeVisible();
    await expect(
      member.page.getByText(/please welcome/).last(),
    ).toBeVisible();

    // The shout-out persists for a reload.
    await member.page.reload();
    await expect(member.page.getByText("@everyone").last()).toBeVisible();
  } finally {
    await Promise.all([member.context.close(), newcomer.context.close()]);
  }
});
