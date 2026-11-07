import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { newSignedInPage, USER_A_EMAIL, USER_B_EMAIL } from "./support/auth";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function fixture(...args: string[]) {
  const output = execFileSync("pnpm", ["--silent", "-F", "@cahootz/api", "exec", "tsx", "--import", "./dotenv.config.js", "scripts/e2e-sage-proposal-writer.ts", ...args], {
    cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000,
  });
  const line = output.split("\n").reverse().find((entry) => entry.startsWith("E2E_RESULT "));
  if (!line) throw new Error(`Goal ideas fixture printed no result:\n${output}`);
  return JSON.parse(line.slice("E2E_RESULT ".length));
}

function shown(page: Page, text: string | RegExp) {
  return page.getByText(text).locator("visible=true").first();
}

const PITCH = /Let's make a Monday check-in thread part of how we work/;

// Both journeys share one E2E-only Commons, so they run one after the other.
test.describe.configure({ mode: "serial" });

// Sage checks a Commons' charter goals twice a week. Eight weeks of steady talk followed by two quiet weeks
// is a real gap on "More communication" (the fixture runs the real proposal writer with a fixed model reply and
// a stand-in for the paid proposal review). Sage writes the proposal and puts it up for a vote itself, and
// members get a "New vote" alert (the real notification code; it goes to everyone for any proposal). Once
// members pass it (the fixture stands in for the vote count), only a steward can apply it, with one tap.
test("Sage writes a proposal for a quiet goal and puts it up for a vote, and a steward applies the change members passed", async ({ browser }) => {
  test.setTimeout(300_000);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const steward = await newSignedInPage(browser, USER_A_EMAIL);
  const member = await newSignedInPage(browser, USER_B_EMAIL);
  try {
    const { coopId, postId, proposalId, title, gap } = fixture("seed", runId, "vote");
    expect(proposalId).toBeTruthy();
    expect(gap).toMatch(/^Goal "More communication" looks behind\. .*Posts and comments members write: 0 in the last two weeks, down from about 5/);

    // 1. Members are told there's a new vote. The alert opens Sage's proposal.
    await member.page.goto("/notifications");
    await expect(member.page.getByText("Alerts", { exact: true }).first()).toBeVisible({ timeout: 60_000 });
    const alert = member.page.getByText(`New vote: ${title}`).locator("visible=true").first();
    await expect(alert).toBeVisible({ timeout: 30_000 });
    await expect(shown(member.page, /Sage put up a proposal\. Take a look and vote\. Voting closes/)).toBeVisible();
    await alert.click();
    await expect(shown(member.page, title)).toBeVisible({ timeout: 60_000 });
    await expect(shown(member.page, "AI helper")).toBeVisible();

    // 2. A member sees Sage's post: the idea, the goal in passing, and that it's up for a vote. No goal-gap numbers.
    await member.page.goto(`/${coopId}/posts/${postId}`);
    await expect(shown(member.page, PITCH)).toBeVisible({ timeout: 60_000 });
    await expect(shown(member.page, /for our goal "More communication", and I put it up for a vote\. Read it, comment, and vote\. It only happens if members say yes\./)).toBeVisible();
    await expect(shown(member.page, /Why now: our goal/)).toHaveCount(0);
    await expect(member.page.getByLabel("AI helper, not a person").filter({ visible: true }).first()).toBeVisible();
    await expect(shown(member.page, "Up for a vote")).toBeVisible();
    await expect(member.page.getByRole("button", { name: "Take this on" }).locator("visible=true")).toHaveCount(0);

    // 3. The post's button opens the same proposal, and it survives a reload.
    await member.page.getByRole("button", { name: "Read and vote" }).locator("visible=true").first().click();
    await expect(shown(member.page, title)).toBeVisible({ timeout: 60_000 });
    await expect(shown(member.page, "AI helper")).toBeVisible();
    await member.page.reload();
    await expect(shown(member.page, title)).toBeVisible({ timeout: 60_000 });

    // 4. Members pass it. Only the steward sees the passed change, and applies it with one tap.
    expect(fixture("approve", proposalId)).toMatchObject({ queued: true });
    const before = fixture("charter");
    await member.page.goto(`/commons/${coopId}`);
    await expect(shown(member.page, "What Sage counts")).toBeVisible({ timeout: 60_000 });
    await expect(shown(member.page, "Talking")).toBeVisible();
    await expect(member.page.getByText("Changes members passed").locator("visible=true")).toHaveCount(0);
    await expect(member.page.getByRole("button", { name: /Change what Sage counts/ }).locator("visible=true")).toHaveCount(0);

    await steward.page.goto(`/commons/${coopId}`);
    await expect(shown(steward.page, "Changes members passed")).toBeVisible({ timeout: 60_000 });
    await expect(shown(steward.page, `Members voted yes on "${title}".`)).toBeVisible();
    await steward.page.getByRole("button", { name: "Apply", exact: true }).locator("visible=true").first().click();
    await expect(shown(steward.page, "Done. It's live in our charter now.")).toBeVisible({ timeout: 30_000 });

    // The charter really changed, by one version, and the change survives a reload.
    expect(fixture("charter")).toEqual({ version: before.version + 1, charterText: expect.stringContaining("we start each week with a Monday check-in thread.") });
    await steward.page.reload();
    await shown(steward.page, "Read full charter →").click();
    await expect(shown(steward.page, /we start each week with a Monday check-in thread\./)).toBeVisible({ timeout: 30_000 });
    await expect(steward.page.getByText("Changes members passed").locator("visible=true")).toHaveCount(0);
  } finally {
    fixture("cleanup", runId);
    await steward.context.close();
    await member.context.close();
  }
});

// When the proposal review sends Sage's proposal back (it needs more information), Sage withdraws it and
// posts it as an open idea instead. The first member to tap "Take this on" owns the draft; the other
// member sees it's taken.
test("when the review sends Sage's proposal back, the first member to take it on owns the draft", async ({ browser }) => {
  test.setTimeout(300_000);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const steward = await newSignedInPage(browser, USER_A_EMAIL);
  const member = await newSignedInPage(browser, USER_B_EMAIL);
  try {
    const { coopId, postId, proposalId, title, userAName } = fixture("seed", runId, "sent-back");
    expect(proposalId).toBeNull();

    // Sage withdrew its proposal, so nobody is asked to vote on it.
    await member.page.goto("/notifications");
    await expect(member.page.getByText("Alerts", { exact: true }).first()).toBeVisible({ timeout: 60_000 });
    await expect(member.page.getByText(`New vote: ${title}`)).toHaveCount(0);

    await member.page.goto(`/${coopId}/posts/${postId}`);
    await expect(shown(member.page, PITCH)).toBeVisible({ timeout: 60_000 });
    await expect(shown(member.page, "Up for grabs")).toBeVisible();
    await expect(shown(member.page, /nothing goes to a vote until you send it/)).toBeVisible();

    await steward.page.goto(`/${coopId}/posts/${postId}`);
    await steward.page.getByRole("button", { name: "Take this on" }).locator("visible=true").first().click();
    await expect(shown(steward.page, "Sage's idea · charter change")).toBeVisible({ timeout: 30_000 });
    await expect(shown(steward.page, "Would become")).toBeVisible();
    await expect(shown(steward.page, "and we start each week with a Monday check-in thread.")).toBeVisible();
    const titleField = steward.page.getByLabel("Proposal title").locator("visible=true").first();
    await expect(titleField).toHaveValue(title);
    await titleField.fill(`${title} on Mondays`);
    await steward.page.getByRole("button", { name: "Save", exact: true }).locator("visible=true").first().click();
    await expect(shown(steward.page, "Draft saved.")).toBeVisible();
    await steward.page.reload();
    await expect(steward.page.getByLabel("Proposal title").locator("visible=true").first()).toHaveValue(`${title} on Mondays`);
    await expect(steward.page.getByRole("button", { name: "Send to a vote" }).locator("visible=true").first()).toBeVisible();

    await member.page.reload();
    await expect(shown(member.page, `${userAName} is taking this on`)).toBeVisible({ timeout: 30_000 });
    await expect(member.page.getByRole("button", { name: "Take this on" }).locator("visible=true")).toHaveCount(0);
  } finally {
    fixture("cleanup", runId);
    await steward.context.close();
    await member.context.close();
  }
});
