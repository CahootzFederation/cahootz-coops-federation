import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { newSignedInPage, USER_A_EMAIL } from "./support/auth";

// The @mention list holds up to eight people but only shows about four at a time. Each row used to
// pick its person on touch-down, so any swipe that started on a row picked that person instead of
// scrolling, and only the people already on screen could be mentioned.
const API_BASE_URL = process.env.E2E_API_BASE_URL || "http://localhost:3001";
const COOP_ID = "cahootz";
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** Fixture setup and cleanup only (see apps/api/scripts/e2e-mention-members.ts). */
function mentionMembers(...args: string[]) {
  const output = execFileSync(
    "pnpm",
    ["--silent", "-F", "@cahootz/api", "exec", "tsx", "--import", "./dotenv.config.js", "scripts/e2e-mention-members.ts", ...args],
    { cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000 },
  );
  const line = output.split("\n").reverse().find((entry) => entry.startsWith("E2E_RESULT "));
  if (!line) throw new Error(`Mention members fixture printed no result:\n${output}`);
  return JSON.parse(line.slice("E2E_RESULT ".length));
}

async function sessionTokenFor(page: Page) {
  const token = await page.evaluate(() => window.localStorage.getItem("cahootz.sessionToken"));
  if (!token) throw new Error("Missing session token after sign-in");
  return token;
}

async function trpcPost(pathName: string, sessionToken: string, body: unknown) {
  const response = await fetch(`${API_BASE_URL}/trpc/${pathName}`, {
    method: "POST", headers: { "content-type": "application/json", "x-session-token": sessionToken }, body: JSON.stringify(body),
  });
  const text = await response.text();
  expect(response.ok, `${pathName} failed: ${text}`).toBe(true);
  return JSON.parse(text).result.data as any;
}

test("a swipe scrolls the @mention list without picking anyone", async ({ browser }) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // A fresh database has only the two fixture accounts, too few to need scrolling.
  mentionMembers("seed", runId);
  const { context, page } = await newSignedInPage(browser, USER_A_EMAIL);
  let postId: string | undefined;
  let token: string | undefined;

  try {
    token = await sessionTokenFor(page);
    const created = await trpcPost("commons.createPost", token, {
      coopId: COOP_ID, title: `E2E ${runId} mention scroll`, content: `E2E ${runId}: who's around this week?`, tag: "Social",
    });
    postId = (created.post?.id ?? created.id) as string;

    await page.goto(`/${COOP_ID}/posts/${postId}`);
    const composer = page.getByPlaceholder("Write a comment...").locator("visible=true").first();
    await composer.click();
    await composer.pressSequentially("@");

    const list = page.getByTestId("mention-suggestions").locator("visible=true").first();
    await expect(list).toBeVisible();
    // Wait for the member list to load, so it's taller than the box and has to scroll.
    await expect(async () => {
      const overflow = await list.evaluate((el) => el.scrollHeight - el.clientHeight);
      expect(overflow).toBeGreaterThan(40);
    }).toPass();

    // Swipe up with a real finger, starting on the second row.
    const box = (await list.boundingBox())!;
    const x = box.x + box.width / 2;
    const startY = box.y + box.height * 0.6;
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: startY }] });
    for (let step = 1; step <= 10; step += 1) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: startY - step * 15 }] });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });

    // The list scrolled, it's still open, and nobody got picked.
    await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await expect(composer).toHaveValue("@");
    await expect(list).toBeVisible();

    // The person at the bottom, who started off screen, can now be tapped and mentioned.
    await list.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    const lastCaption = list.getByText(/^@/).last();
    const handle = (await lastCaption.textContent())!.trim();
    await lastCaption.click();
    await expect(composer).toHaveValue(new RegExp(`^${handle}\\s?$`));
  } finally {
    if (postId && token) await trpcPost("commons.deletePost", token, { postId }).catch(() => {});
    await context.close();
    mentionMembers("cleanup", runId);
  }
});
