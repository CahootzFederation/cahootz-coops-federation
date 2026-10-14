import { execFileSync } from "node:child_process";
import path from "node:path";

import { expect, test, type Page, type Route } from "@playwright/test";
import { newSignedInPage, openGeneralFeed, USER_A_EMAIL } from "./support/auth";

const API_BASE_URL = process.env.E2E_API_BASE_URL || "http://localhost:3001";
const REPO_ROOT = path.resolve(__dirname, "../../..");

async function sessionTokenFor(page: Page) {
  return page.evaluate(() => window.localStorage.getItem("cahootz.sessionToken"));
}

async function trpcPost(procedure: string, sessionToken: string, body: unknown) {
  const response = await fetch(`${API_BASE_URL}/trpc/${procedure}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-session-token": sessionToken },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${procedure} failed: ${response.status} ${await response.text()}`);
  return response.json();
}

/** Fixture lookup and cleanup only (see apps/api/scripts/e2e-feedback.ts). */
function feedbackFixture(...args: string[]) {
  const output = execFileSync(
    "pnpm",
    ["--silent", "-F", "@cahootz/api", "exec", "tsx", "--import", "./dotenv.config.js", "scripts/e2e-feedback.ts", ...args],
    { cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000 },
  );
  const line = output.split("\n").reverse().find((entry) => entry.startsWith("E2E_RESULT "));
  if (!line) throw new Error(`Feedback fixture printed no result:\n${output}`);
  return JSON.parse(line.slice("E2E_RESULT ".length));
}

test("a post leaves the composer at once, keeps a new draft intact, and can be retried after a failure", async ({
  browser,
}) => {
  const runId = `${Date.now()}`;
  const firstPost = `E2E optimistic post ${runId}`;
  const nextDraft = `E2E next draft ${runId}`;
  const { context, page } = await newSignedInPage(browser, USER_A_EMAIL);
  const createdPostIds: string[] = [];
  // Records the id of the next post the server saves, for cleanup.
  const nextSavedPost = () =>
    page
      .waitForResponse((response) => response.url().includes("/trpc/commons.createPost") && response.ok())
      .then(async (response) => {
        const id = (await response.json())?.result?.data?.post?.id;
        if (id) createdPostIds.push(id);
      });

  try {
    await openGeneralFeed(page);
    const composer = page.getByRole("textbox", { name: "Share what's happening..." });

    // Hold the save so the in-between state can be checked.
    let releaseSave: () => void = () => {};
    const saveHeld = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    await page.route("**/trpc/commons.createPost**", async (route: Route) => {
      await saveHeld;
      await route.continue();
    });

    await composer.fill(firstPost);
    await page.getByLabel("Post", { exact: true }).click();

    // The composer is free immediately; the post shows as a pending card.
    await expect(composer).toHaveValue("");
    await expect(page.getByText(/^Posting to /)).toBeVisible();
    await expect(page.getByText(firstPost, { exact: true })).toBeVisible();

    // Typing while the first post is still saving goes into a new draft...
    await composer.fill(nextDraft);
    const firstSaved = nextSavedPost();
    releaseSave();
    await firstSaved;
    await expect(page.getByText(/^Posting to /)).toHaveCount(0);
    await expect(page.getByText(firstPost, { exact: true })).toBeVisible();
    // ...which the finished save must not wipe.
    await expect(composer).toHaveValue(nextDraft);
    await page.unroute("**/trpc/commons.createPost**");

    // A failed save keeps the card with Retry and Discard.
    await page.route("**/trpc/commons.createPost**", (route: Route) => route.abort("failed"));
    await page.getByLabel("Post", { exact: true }).click();
    await expect(composer).toHaveValue("");
    await expect(page.getByText(/^Not posted to /)).toBeVisible();
    await expect(page.getByText(nextDraft, { exact: true })).toBeVisible();
    await expect(page.getByLabel("Discard post")).toBeVisible();

    await page.unroute("**/trpc/commons.createPost**");
    const retrySaved = nextSavedPost();
    await page.getByLabel("Retry post").click();
    await retrySaved;
    await expect(page.getByText(/^Not posted to /)).toHaveCount(0);
    await expect(page.getByLabel("Retry post")).toHaveCount(0);
    await expect(page.getByText(nextDraft, { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByText(firstPost, { exact: true })).toBeVisible();
    await expect(page.getByText(nextDraft, { exact: true })).toBeVisible();
    expect(createdPostIds).toHaveLength(2);
  } finally {
    const sessionToken = await sessionTokenFor(page).catch(() => null);
    if (sessionToken) {
      for (const postId of createdPostIds) {
        await trpcPost("commons.deletePost", sessionToken, { postId }).catch(() => {});
      }
    }
    await context.close();
  }
});

test("Return on a new circle's purpose closes the keyboard so Create circle stays reachable", async ({
  browser,
}) => {
  const runId = `${Date.now()}`;
  const circleName = `E2E Return Circle ${runId}`;
  const { context, page } = await newSignedInPage(browser, USER_A_EMAIL);
  let groupId: string | null = null;

  try {
    await page.goto("/spaces?coopId=cahootz&mode=create");
    const nameInput = page.getByPlaceholder("Example: South LA Gardeners");
    const purposeInput = page.getByLabel("Circle purpose");

    await nameInput.fill(circleName);
    await nameInput.press("Enter");
    await expect(purposeInput).toBeFocused();

    await purposeInput.pressSequentially("Neighbors trading seeds");
    await purposeInput.press("Enter");
    // Return finished the field instead of adding a line.
    await expect(purposeInput).not.toBeFocused();
    await expect(purposeInput).toHaveValue("Neighbors trading seeds");

    await page.getByText("Create circle", { exact: true }).click();
    await expect(page).toHaveURL(/circleId=/);
    groupId = new URL(page.url()).searchParams.get("circleId");
    await expect(page.getByText(circleName).first()).toBeVisible();
  } finally {
    const sessionToken = await sessionTokenFor(page).catch(() => null);
    if (sessionToken && groupId) {
      await trpcPost("groups.leave", sessionToken, { groupId }).catch(() => {});
    }
    await context.close();
  }
});

test("a member reports a problem from the menu and it is saved for the team", async ({ browser }) => {
  const runId = `${Date.now()}`;
  const message = `E2E feedback ${runId}: the post button spins forever`;
  const { context, page } = await newSignedInPage(browser, USER_A_EMAIL);

  try {
    await page.getByLabel("Open menu").filter({ visible: true }).click();
    await page.getByText("Report a Problem or Idea", { exact: true }).filter({ visible: true }).click();
    await expect(page.getByText("Report a problem", { exact: true })).toBeVisible();

    // An empty report isn't sent.
    await page.getByLabel("Send feedback").click();
    await expect(page.getByText("Tell us what happened.", { exact: true })).toBeVisible();

    await page.getByRole("radio", { name: "Complaint" }).click();
    await page.getByLabel("What happened?").fill(message);

    // Screenshots can be attached and removed before sending.
    const chooser = page.waitForEvent("filechooser");
    await page.getByLabel("Add screenshots").click();
    await (await chooser).setFiles({
      name: "screenshot.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
    });
    await expect(page.getByLabel("Remove screenshot")).toHaveCount(1);
    await page.getByLabel("Remove screenshot").click();
    await expect(page.getByLabel("Remove screenshot")).toHaveCount(0);

    await page.getByLabel("Send feedback").click();
    await expect(page.getByText("Thanks, the team has it", { exact: true })).toBeVisible();

    const saved = feedbackFixture("find", runId);
    expect(saved).toMatchObject({ category: "COMPLAINT", message, email: USER_A_EMAIL, platform: "web" });

    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByLabel("Open menu").filter({ visible: true })).toBeVisible();
  } finally {
    feedbackFixture("cleanup", runId);
    await context.close();
  }
});
