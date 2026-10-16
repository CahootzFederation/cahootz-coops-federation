import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn, USER_B_EMAIL } from "./support/auth";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const COOP_ID = "cahootz";

/**
 * Fixture only: `apps/api/scripts/e2e-sage-activation.ts` creates a throwaway new member (any post, reply
 * or RSVP since joining counts as activated, so the shared accounts' history can't be used), moves their
 * join date forward a step at a time, and runs the real activation sweep or wake handler.
 */
function fixture(...args: string[]) {
  const output = execFileSync(
    "pnpm",
    ["--silent", "-F", "@cahootz/api", "exec", "tsx", "--import", "./dotenv.config.js", "scripts/e2e-sage-activation.ts", ...args],
    { cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000, env: { ...process.env, E2E_DATABASE_URL_OVERRIDE: process.env.DATABASE_URL } },
  );
  const line = output.split("\n").reverse().find((entry) => entry.startsWith("E2E_RESULT "));
  if (!line) throw new Error(`Activation fixture printed no result:\n${output}`);
  return JSON.parse(line.slice("E2E_RESULT ".length));
}

async function openSage(page: Page) {
  await page.goto("/messages");
  await page.getByLabel("Conversation with Sage").click();
}

async function expectFromSage(page: Page, text: string | RegExp) {
  await expect(async () => {
    await openSage(page);
    await expect(page.getByText(text).last()).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
}

async function openFollowing(page: Page) {
  await page.goto("/sage");
  // A brand-new member sees the Meet Sage card first; it says what Sage does on its own, including this journey.
  const gotIt = page.getByRole("button", { name: "Got it" });
  if (await gotIt.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await expect(page.getByText(/welcome you when you join a commons/)).toBeVisible();
    await gotIt.click();
  }
  await page.getByRole("tab", { name: "Following" }).locator("visible=true").first().click();
}

function newRun() {
  const runId = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  return { runId, email: `e2eactivation${runId}@test.cahootz.local` };
}

// A new member is welcomed in the Commons' own words, gets one small way to pitch in that fits their
// profile, does it in the app, and Sage records the journey as a success from the reply on record.
test("Sage welcomes a new member, suggests a first contribution, and verifies it from the app", async ({ browser }) => {
  // Three journey stages, each a fixture run plus a few screens: longer than most journeys by design.
  test.setTimeout(420_000);
  const { runId, email } = newRun();
  const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
  const page = await context.newPage();
  try {
    // Hour 1: the welcome.
    const created = fixture("create", email, runId);
    expect(created.summary.sent, JSON.stringify(created.summary)).toBe(1);
    await signIn(page, email);
    await expectFromSage(page, `Welcome to ${created.commonsName}! I'm Sage, the AI helper here (not a person).`);
    await expect(page.getByText(/one person or circle to meet and one small way to pitch in/).last()).toBeVisible();

    // The journey is visible, with why Sage follows it and how to stop it.
    await openFollowing(page);
    await expect(page.getByText(`Getting started in ${created.commonsName}`, { exact: true })).toBeVisible();
    await expect(page.getByText(/Waiting for you to connect with someone or pitch in/)).toBeVisible();
    await expect(page.getByLabel(`Dismiss follow-up Getting started in ${created.commonsName}`)).toBeVisible();

    // Day 7: a member's unanswered Need matches the newcomer's skill.
    const need = fixture("contribute", email, USER_B_EMAIL, runId);
    expect(need.summary.sent, JSON.stringify(need.summary)).toBe(1);
    await expectFromSage(page, new RegExp(`a member posted “${need.title}” in ${created.commonsName}, and nobody has answered yet`));

    // The newcomer answers it in the feed.
    await page.goto(`/${COOP_ID}/posts/${need.postId}`);
    await expect(page.getByText(new RegExp(`E2E ${runId}: Is anyone able to help`)).first()).toBeVisible({ timeout: 60_000 });
    await page.getByPlaceholder("Write a comment...").fill(`E2E ${runId}: I can help with that on Saturday.`);
    await page.getByLabel("Send comment").click();
    await page.reload();
    await expect(page.getByText(`E2E ${runId}: I can help with that on Saturday.`).first()).toBeVisible({ timeout: 60_000 });

    // Day 14: Sage checks the records, not the member's word, and closes the journey as a success.
    const checked = fixture("check", email, "14");
    expect(checked.woke).toBe("DONE");
    expect(checked.task).toMatchObject({ status: "DONE", outcome: "[NEED_REPLY] Replied to another member's need" });
    expect(checked.stats.activated).toBeGreaterThanOrEqual(1);
    await openFollowing(page);
    await expect(page.getByText(/Replied to another member's need/)).toBeVisible();
    await expect(page.getByText(/\[NEED_REPLY\]/)).toHaveCount(0);
    await expect(page.getByText(/Sage isn't following up on anything with you/)).toBeVisible();
  } finally {
    await context.close().catch(() => {});
    fixture("cleanup", email, runId);
  }
});

// A new member who hasn't connected after two weeks is asked privately what got in the way; the answer
// is remembered through the check-in memory path, and the journey closes at day 30 as not activated.
test("Sage asks a quiet new member what got in the way and remembers the answer", { tag: "@sage" }, async ({ browser }) => {
  test.setTimeout(300_000);
  const { runId, email } = newRun();
  const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
  const page = await context.newPage();
  try {
    const created = fixture("create", email, runId);
    await signIn(page, email);

    const asked = fixture("check", email, "14");
    expect(asked.woke).toBe("REMINDED");
    await expectFromSage(page, /What got in the way\? A few words is plenty/);

    await page.getByLabel(/^Message Sage/).locator("visible=true").first().fill("I don't have a car, so I can't get to the meetups.");
    await page.getByLabel("Send message").click();
    await expect(page.getByText(/I'll remember this for our check-ins:/).last()).toBeVisible({ timeout: 90_000 });

    const closed = fixture("check", email, "30");
    expect(closed.woke).toBe("ABANDONED");
    expect(closed.task.outcome).toMatch(/^\[NONE\]/);
    await openFollowing(page);
    await expect(page.getByText(`Getting started in ${created.commonsName}`, { exact: true })).toBeVisible();
    await expect(page.getByText(/No verified connection or contribution in the first 30 days/)).toBeVisible();
  } finally {
    await context.close().catch(() => {});
    fixture("cleanup", email, runId);
  }
});
