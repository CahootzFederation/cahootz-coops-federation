import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { newSignedInPage, USER_A_EMAIL } from "./support/auth";
import { withExclusiveAccountSetting } from "./support/exclusive";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const API_BASE_URL = process.env.E2E_API_BASE_URL || "http://localhost:3001";
const NOTICE = "I'll remember this for our check-ins: ";

function fixture(command: "seed" | "cleanup") {
  const output = execFileSync("pnpm", ["--silent", "-F", "@cahootz/api", "exec", "tsx", "--import", "./dotenv.config.js", "scripts/e2e-sage-weekly-outreach.ts", command, USER_A_EMAIL], {
    cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000,
  });
  const line = output.split("\n").reverse().find((entry) => entry.startsWith("E2E_RESULT "));
  if (!line) throw new Error(`Weekly outreach fixture printed no result:\n${output}`);
  return JSON.parse(line.slice("E2E_RESULT ".length)) as { content?: string | null };
}

/** Fixture setup only: turns decision trails on or off for the signed-in account. */
async function setTrails(page: Page, on: boolean) {
  const token = await page.evaluate(() => window.localStorage.getItem("cahootz.sessionToken"));
  if (!token) throw new Error("Missing session token after sign-in");
  const response = await fetch(`${API_BASE_URL}/trpc/sage.setTrailSettings`, {
    method: "POST", headers: { "content-type": "application/json", "x-session-token": token },
    body: JSON.stringify({ showSageDecisionTrails: on }),
  });
  expect(response.ok, await response.text()).toBe(true);
}

function shown(page: Page, text: string | RegExp) {
  return page.getByText(text).locator("visible=true");
}

// Sending waits for Sage's reply in the same request, and the box clears only then. Wait for that
// before typing again, or the next message is typed into the box and wiped.
async function send(page: Page, text: string) {
  const box = page.getByLabel(/^Message Sage/).locator("visible=true").first();
  await box.fill(text);
  await page.getByLabel("Send message").click();
  await expect(box).toHaveValue("", { timeout: 90_000 });
  await expect(page.getByText(text, { exact: true }).last()).toBeVisible();
}

// Sage's messages render as markdown, so each line is its own element and the list's heading alone
// doesn't hold its items. Check the whole answer: the deepest element with both its heading and footer.
function memoryAnswer(page: Page) {
  return page.locator("div")
    .filter({ has: page.getByText(/^(Here's what I remember from our check-ins:|I'm not keeping anything about you right now)/) })
    .filter({ hasText: /Say "forget 1"|I'm not keeping anything about you right now/ })
    .locator("visible=true").last();
}

async function openSage(page: Page) {
  await page.goto("/messages");
  await page.getByLabel("Conversation with Sage").click();
}

// A member mentions a need in a check-in reply. Sage saves it without asking and says so, uses it in
// the next check-in follow-up, lists it on request, and forgets it when told to.
// Shares A's Sage conversation with sage-weekly-outreach.spec.ts and sage-member-post.spec.ts, and
// flips A's decision-trail setting like agent-decision-trails.spec.ts, so it takes both locks.
test("Sage remembers a need from a check-in, uses it, and forgets it when asked", { tag: "@sage" }, async ({ browser }) =>
  withExclusiveAccountSetting("sage-decision-trails", () => withExclusiveAccountSetting("user-a-sage-conversation", async () => {
    const runId = `E2E ${Date.now()}`;
    const member = await newSignedInPage(browser, USER_A_EMAIL);
    try {
      await setTrails(member.page, true);
      const seeded = fixture("seed");
      await openSage(member.page);
      await expect(member.page.getByText(seeded.content!).last()).toBeVisible();

      // 1. A need in a check-in reply is saved without a consent question, and Sage says what it kept.
      await send(member.page, `${runId}: I need a ride to work most weekdays`);
      const notice = member.page.getByText(NOTICE, { exact: false }).last();
      await expect(notice).toBeVisible({ timeout: 60_000 });
      await expect(member.page.getByText("Would you like me to remember", { exact: false })).toHaveCount(0);
      const noticeText = (await notice.textContent()) ?? "";
      const summary = noticeText.slice(noticeText.indexOf(NOTICE) + NOTICE.length).split(". Say \"forget that\"")[0]!.trim();
      expect(summary.length).toBeGreaterThan(0);
      expect(summary).not.toContain(runId);

      // 2. The next check-in follow-up is given that note: its decision trail shows it.
      await send(member.page, `${runId}: Otherwise the week was fine`);
      const trails = member.page.getByRole("button", { name: /Show Sage decision: Replied in the direct message/ }).locator("visible=true");
      await expect.poll(() => trails.count(), { timeout: 90_000 }).toBeGreaterThanOrEqual(2);
      // Trails are listed newest first (sage.listTrails), so the follow-up's trail is the first one.
      await trails.first().click();
      await expect(shown(member.page, "1 need remembered from the member's check-ins").first()).toBeVisible();
      await expect(shown(member.page, new RegExp(`[A-Z][a-z]{2} \\d{1,2}: ${summary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)).first()).toBeVisible();

      // 3. The member asks what Sage remembers (answered in code), and the answer survives a reload.
      await send(member.page, "What do you remember about me?");
      const list = memoryAnswer(member.page);
      await expect(list).toContainText("Here's what I remember from our check-ins:", { timeout: 30_000 });
      await expect(list).toContainText(summary);
      await expect(list).not.toContainText(runId);
      await expect(list).not.toContainText(NOTICE);
      await member.page.reload();
      await openSage(member.page);
      await expect(memoryAnswer(member.page)).toContainText(summary);

      // 4. "forget that" dismisses it, and it's gone from the list.
      await send(member.page, "forget that");
      await expect(member.page.getByText(`I've forgotten "${summary}"`, { exact: false }).last()).toBeVisible({ timeout: 30_000 });
      // (A shared fixture account may still have notes from other runs, so check this one is gone.)
      await send(member.page, "What do you remember about me?");
      // The newest answer must not list the forgotten note; the earlier list still does, so this
      // only passes once the new answer is the last one.
      await expect(memoryAnswer(member.page)).not.toContainText(summary, { timeout: 30_000 });
      await expect(memoryAnswer(member.page)).not.toContainText(NOTICE);
    } finally {
      fixture("cleanup");
      await setTrails(member.page, false).catch(() => {});
      await member.context.close();
    }
  })));
