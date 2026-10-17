import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { newSignedInPage, USER_A_EMAIL, USER_B_EMAIL } from "./support/auth";
import { withExclusiveAccountSetting } from "./support/exclusive";

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

/** Sage posts in each Commons' General circle. */
function generalFeed(coopId: string) {
  return `/${coopId}/posts?circleId=${encodeURIComponent(`general:${coopId}`)}`;
}

async function openSageSettings(page: Page) {
  await page.goto("/sage-settings");
  await expect(shown(page, "Sage's community rhythm")).toBeVisible({ timeout: 60_000 });
}

// Sage's weekly rhythm: templated posts built from records, one per category per period. Member A opts in
// to being named and to alerts for the Friday appreciation and the midweek list, sees both posts and alerts,
// then mutes the midweek list: it disappears from A's feed and stops alerting A, while member B
// (separate context, default settings) still sees it. B volunteers on Monday through the real comment box;
// midweek carries that commitment forward and creates a follow-up without naming B.
test("Sage's rhythm posts follow each member's settings, and a muted category leaves only that member's feed", async ({ browser }) => withExclusiveAccountSetting("sage-rhythm-settings", async () => {
  test.setTimeout(300_000);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const memberA = await newSignedInPage(browser, USER_A_EMAIL);
  const memberB = await newSignedInPage(browser, USER_B_EMAIL);
  const listedNeed = `• 'E2E ${runId} need a ladder for gutters'`;
  try {
    const seeded = fixture("seed", runId, USER_A_EMAIL, USER_B_EMAIL);
    const { page } = memberA;

    // 1. A turns on naming and alerts for the Friday appreciation, through the real settings screen.
    await openSageSettings(page);
    const naming = page.getByRole("switch", { name: "Name me in Sage's Friday appreciation" });
    await expect(naming).toHaveAttribute("aria-checked", "false");
    await naming.click();
    await expect(naming).toHaveAttribute("aria-checked", "true");
    const fridayNotify = page.getByRole("radio", { name: "Friday appreciation: Notify me" });
    await expect(page.getByRole("radio", { name: "Friday appreciation: In feed" })).toBeChecked();
    await fridayNotify.click();
    await expect(fridayNotify).toBeChecked();
    const midweekNotify = page.getByRole("radio", { name: "Midweek open requests: Notify me" });
    await midweekNotify.click();
    await expect(midweekNotify).toBeChecked();
    await page.reload();
    await expect(page.getByRole("radio", { name: "Friday appreciation: Notify me" })).toBeChecked({ timeout: 60_000 });
    await expect(page.getByRole("switch", { name: "Name me in Sage's Friday appreciation" })).toHaveAttribute("aria-checked", "true");

    // 2. Sage posts Monday's priorities. B explicitly volunteers in General through the real comment box.
    const monday = fixture("publish", runId, "weekly_priorities", "0", USER_A_EMAIL);
    await memberB.page.goto(`/${seeded.coopId}/posts/${monday.postId}`);
    const commitment = `Priority 1: I'll take the first step for E2E ${runId}.`;
    await memberB.page.getByPlaceholder("Write a comment...").locator("visible=true").first().fill(commitment);
    await memberB.page.getByLabel("Send comment").locator("visible=true").first().click();
    await expect(shown(memberB.page, commitment)).toBeVisible({ timeout: 60_000 });

    // 3. Midweek revisits Monday's thread and records B's explicit offer; Friday carries open work forward.
    const midweek = fixture("publish", runId, "midweek_open_work", "1", USER_A_EMAIL);
    const friday = fixture("publish", runId, "friday_appreciation", "2", USER_A_EMAIL);
    expect(friday.alertedA).toBe(true);
    expect(midweek.alertedA).toBe(true);
    expect(midweek.tasksCreated).toBe(1);

    // Post titles aren't shown in the app, so match the body. The appreciation names A (who opted in) for hosting, from records, and is labeled as Sage's.
    await page.goto(`/${seeded.coopId}/posts/${friday.postId}`);
    await expect(shown(page, /Here's what members did for each other this week/)).toBeVisible({ timeout: 60_000 });
    await expect(shown(page, new RegExp(`Thank you, .*${seeded.nameA}`))).toBeVisible();
    await expect(shown(page, /\d+ events? hosted/)).toBeVisible();
    await expect(page.getByLabel("AI helper, not a person").filter({ visible: true }).first()).toBeVisible();

    // The midweek list names the request but not who asked.
    await page.goto(`/${seeded.coopId}/posts/${midweek.postId}`);
    await expect(shown(page, listedNeed)).toBeVisible({ timeout: 60_000 });
    await expect(shown(page, "These requests haven't had a reply yet:")).toBeVisible();
    await expect(shown(page, "From Monday's priorities:")).toBeVisible();
    await expect(shown(page, /Priority 1 has a volunteer/)).toBeVisible();
    await expect(shown(page, new RegExp(`${seeded.nameB}`))).toHaveCount(0);

    // A's alert for the appreciation is in the inbox.
    await page.goto("/notifications");
    await expect(async () => {
      await page.reload();
      await expect(shown(page, "Sage: This week's appreciation")).toBeVisible();
    }).toPass({ timeout: 30_000 });

    // 4. Both posts are in A's Commons feed (General).
    await page.goto(generalFeed(seeded.coopId));
    await expect(shown(page, listedNeed)).toBeVisible({ timeout: 60_000 });

    // 5. A mutes the midweek list. The choice persists, and the post leaves A's feed.
    await openSageSettings(page);
    const muteMidweek = page.getByRole("radio", { name: "Midweek open requests: Mute" });
    await muteMidweek.click();
    await expect(muteMidweek).toBeChecked();
    await page.reload();
    await expect(page.getByRole("radio", { name: "Midweek open requests: Mute" })).toBeChecked({ timeout: 60_000 });
    await page.goto(generalFeed(seeded.coopId));
    await expect(shown(page, new RegExp(`Thank you, .*${seeded.nameA}`))).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(listedNeed)).toHaveCount(0);

    // 6. Muting is A's alone: B still sees the midweek list in their feed.
    await memberB.page.goto(generalFeed(seeded.coopId));
    await expect(shown(memberB.page, listedNeed)).toBeVisible({ timeout: 60_000 });

    // 7. Muted also means no alert: the next midweek post doesn't alert A.
    const later = fixture("publish", runId, "midweek_open_work", "3", USER_A_EMAIL);
    expect(later.alertedA).toBe(false);
  } finally {
    fixture("cleanup", runId, USER_A_EMAIL, USER_B_EMAIL);
    await memberA.context.close();
    await memberB.context.close();
  }
}));
