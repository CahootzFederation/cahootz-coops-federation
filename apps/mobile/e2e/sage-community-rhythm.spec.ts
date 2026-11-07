import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { newSignedInPage, USER_A_EMAIL, USER_B_EMAIL } from "./support/auth";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function fixture(...args: string[]) {
  const output = execFileSync("pnpm", ["--silent", "-F", "@cahootz/api", "exec", "tsx", "--import", "./dotenv.config.js", "scripts/e2e-sage-community-rhythm.ts", ...args], {
    cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000,
  });
  const line = output.split("\n").reverse().find((entry) => entry.startsWith("E2E_RESULT "));
  if (!line) throw new Error(`Community rhythm fixture printed no result:\n${output}`);
  return JSON.parse(line.slice("E2E_RESULT ".length));
}

/** Expo Router keeps earlier screens mounted (hidden), so match visible elements only. */
function shown(page: Page, text: string | RegExp) {
  return page.getByText(text).locator("visible=true").first();
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Sage posts in each Commons' General circle. */
function generalFeed(coopId: string) {
  return `/${coopId}/posts?circleId=${encodeURIComponent(`general:${coopId}`)}`;
}

// Sage's weekly rhythm: posts built from records and published in General. Monday is a short note (its
// fixed template here, so no model call), not a numbered list of goals. The posts and their alerts use
// the existing Community notification category. B offers to help on Monday through the real comment box;
// midweek carries that offer forward and creates a follow-up without naming B.
test("Sage's rhythm posts in General and close the Monday loop", async ({ browser }) => {
  test.setTimeout(300_000);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const memberA = await newSignedInPage(browser, USER_A_EMAIL);
  const memberB = await newSignedInPage(browser, USER_B_EMAIL);
  const listedNeed = `• 'E2E ${runId} need a ladder for gutters'`;
  try {
    const seeded = fixture("seed", runId, USER_A_EMAIL, USER_B_EMAIL);
    const { page } = memberA;

    // 1. Sage posts Monday's note: what's coming up and an easy invitation, with no numbered priorities.
    //    B offers to help in General through the real comment box.
    const monday = fixture("publish", runId, "weekly_priorities", "0", USER_A_EMAIL);
    await memberB.page.goto(`/${seeded.coopId}/posts/${monday.postId}`);
    await expect(shown(memberB.page, /requests? in the feed (is|are) still waiting for a reply/)).toBeVisible({ timeout: 60_000 });
    await expect(shown(memberB.page, /This week's (three )?priorities|Take one step toward our goal|Reply with the priority number/)).toHaveCount(0);
    const commitment = `I'll answer the ladder request for E2E ${runId}.`;
    await memberB.page.getByPlaceholder("Write a comment...").locator("visible=true").first().fill(commitment);
    await memberB.page.getByLabel("Send comment").locator("visible=true").first().click();
    await expect(shown(memberB.page, commitment)).toBeVisible({ timeout: 60_000 });

    // 2. Midweek revisits Monday's thread and records B's explicit offer; Friday carries open work forward.
    const midweek = fixture("publish", runId, "midweek_open_work", "1", USER_A_EMAIL);
    const friday = fixture("publish", runId, "friday_appreciation", "2", USER_A_EMAIL);
    expect(friday.alertedA).toBe(true);
    expect(midweek.alertedA).toBe(true);
    expect(midweek.tasksCreated).toBe(1);

    // Post titles aren't shown in the app, so match the body. Appreciation uses verified counts and is labeled as Sage's.
    // Contributors are named by default: A hosted the event. B asked for the ladder, so B is never named.
    await page.goto(`/${seeded.coopId}/posts/${friday.postId}`);
    await expect(shown(page, /Here's what members did for each other this week/)).toBeVisible({ timeout: 60_000 });
    await expect(shown(page, new RegExp(`Thank you, .*${escapeRegExp(seeded.nameA)}.*and everyone else who showed up\\.`))).toBeVisible();
    await expect(shown(page, new RegExp(escapeRegExp(seeded.nameB)))).toHaveCount(0);
    await expect(shown(page, /\d+ events? hosted/)).toBeVisible();
    await expect(page.getByLabel("AI helper, not a person").filter({ visible: true }).first()).toBeVisible();

    // The midweek list names the request but not who asked.
    await page.goto(`/${seeded.coopId}/posts/${midweek.postId}`);
    await expect(shown(page, listedNeed)).toBeVisible({ timeout: 60_000 });
    await expect(shown(page, "These requests haven't had a reply yet:")).toBeVisible();
    await expect(shown(page, "From Monday's post:")).toBeVisible();
    await expect(shown(page, /1 member offered to take something on\./)).toBeVisible();
    await expect(shown(page, new RegExp(`${seeded.nameB}`))).toHaveCount(0);

    // A's alert for the appreciation is in the inbox.
    await page.goto("/notifications");
    await expect(async () => {
      await page.reload();
      await expect(shown(page, "Sage: This week's appreciation")).toBeVisible();
    }).toPass({ timeout: 30_000 });

    // 3. Both members see the posts in General; there is no per-category hiding.
    await page.goto(generalFeed(seeded.coopId));
    await expect(shown(page, listedNeed)).toBeVisible({ timeout: 60_000 });
    await memberB.page.goto(generalFeed(seeded.coopId));
    await expect(shown(memberB.page, listedNeed)).toBeVisible({ timeout: 60_000 });
  } finally {
    fixture("cleanup", runId, USER_A_EMAIL, USER_B_EMAIL);
    await memberA.context.close();
    await memberB.context.close();
  }
});
