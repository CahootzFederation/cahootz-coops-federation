import { expect, test } from "@playwright/test";
import { newSignedInPage } from "./support/auth";

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

async function trpc(
  sessionToken: string,
  path: string,
  input: Record<string, unknown>,
) {
  const response = await fetch(`${API_BASE_URL}/trpc/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-session-token": sessionToken,
    },
    body: JSON.stringify(input),
  });
  return response.json();
}

// Circles are joined by direct invitation, not by sharing an invite code:
// the leader searches commons members from circle settings, and the invitee
// accepts from their Circles screen.
test("a circle leader searches for a commons member and invites them, and the invitee accepts", async ({
  browser,
}) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const circleName = `E2E Invite Circle ${runId}`;

  const userA = await newSignedInPage(browser, USER_A_EMAIL);
  const userB = await newSignedInPage(browser, USER_B_EMAIL);
  let groupId: string | undefined;

  try {
    const sessionTokenA = await sessionTokenFor(userA.page);
    const sessionTokenB = await sessionTokenFor(userB.page);
    expect(sessionTokenA).toBeTruthy();
    expect(sessionTokenB).toBeTruthy();

    // Fixture setup: a fresh private circle led by User A.
    const created = await trpc(sessionTokenA!, "groups.create", {
      name: circleName,
      privacy: "private",
    });
    groupId = created?.result?.data?.group?.id;
    expect(groupId).toBeTruthy();

    // User B's handle, so the search term is independent of their display name.
    const storedUserB = await userB.page.evaluate(() =>
      window.localStorage.getItem("cahootz.user"),
    );
    const handleB: string = JSON.parse(storedUserB || "{}").handle;
    expect(handleB).toBeTruthy();

    // User A opens circle settings from the circle feed and invites User B.
    await userA.page.goto(`/cahootz/posts?circleId=${groupId}`);
    await userA.page.getByLabel("Circle settings and members").click();
    await expect(userA.page.getByText("Invite people")).toBeVisible();
    await expect(userA.page.getByText("Invite Code")).toHaveCount(0);

    await userA.page.getByLabel("Search people to invite").fill(handleB);
    await expect(userA.page.getByText(`@${handleB}`)).toBeVisible({
      timeout: 20000,
    });
    await userA.page.getByLabel(/^Invite /).first().click();
    await expect(userA.page.getByText("Invited", { exact: true })).toBeVisible();
    await expect(
      userA.page.getByText("Pending invitations (1)"),
    ).toBeVisible();

    await userA.page.reload();
    await expect(
      userA.page.getByText("Pending invitations (1)"),
    ).toBeVisible({ timeout: 20000 });

    // User B sees the invitation on their Circles screen and accepts it.
    await userB.page.goto("/");
    await userB.page.getByLabel("Manage circles").click();
    await expect(userB.page.getByText(circleName).first()).toBeVisible({
      timeout: 20000,
    });
    await userB.page
      .getByLabel(`Accept invitation to ${circleName}`)
      .click();
    await expect(userB.page).toHaveURL(new RegExp(`circleId=${groupId}`), {
      timeout: 20000,
    });
    await expect(
      userB.page.getByRole("textbox", { name: "Share what's happening..." }),
    ).toBeVisible();

    // The leader now sees User B as a member and no pending invitation.
    await userA.page.reload();
    await expect(userA.page.getByText("Members (2)")).toBeVisible({
      timeout: 20000,
    });
    await expect(userA.page.getByText(/Pending invitations/)).toHaveCount(0);
  } finally {
    const sessionTokenA = await sessionTokenFor(userA.page);
    const sessionTokenB = await sessionTokenFor(userB.page);
    if (groupId && sessionTokenB) {
      await trpc(sessionTokenB, "groups.leave", { groupId });
    }
    if (groupId && sessionTokenA) {
      await trpc(sessionTokenA, "groups.leave", { groupId });
    }
    await Promise.all([userA.context.close(), userB.context.close()]);
  }
});
