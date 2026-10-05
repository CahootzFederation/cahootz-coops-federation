import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { newSignedInPage, USER_A_EMAIL } from "./support/auth";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const DAY = 24 * 60 * 60 * 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Runs an `apps/api/scripts` fixture and returns its `E2E_RESULT` JSON. Setup and cleanup only. */
function fixture(script: string, ...args: string[]) {
  const output = execFileSync(
    "pnpm",
    ["--silent", "-F", "@cahootz/api", "exec", "tsx", "--import", "./dotenv.config.js", `scripts/${script}`, ...args],
    { cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000 },
  );
  const line = output
    .split("\n")
    .reverse()
    .find((entry) => entry.startsWith("E2E_RESULT "));
  if (!line) throw new Error(`${script} printed no result:\n${output}`);
  return JSON.parse(line.slice("E2E_RESULT ".length));
}

/** Visible text only: Expo Router keeps earlier screens of a stack mounted but hidden. */
function shown(page: Page, text: string | RegExp, options?: { exact?: boolean }) {
  return page.getByText(text, options).filter({ visible: true });
}

/** The hub card for one proposal. */
function hubCard(page: Page, title: string) {
  return page
    .locator('[tabindex="0"]')
    .filter({ has: page.getByText(title, { exact: true }) })
    .filter({ visible: true })
    .last();
}

/** A local date `days` from today at the given hour (the browser shares this machine's time zone). */
function localDate(days: number, hour: number) {
  const date = new Date(Date.now() + days * DAY);
  date.setHours(hour, 0, 0, 0);
  return date;
}

const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

test("members see when voting on a proposal closes", async ({ browser }) => {
  test.setTimeout(240_000);
  const opensUntil = localDate(3, 17);
  const closedOn = localDate(-2, 10);
  const open = fixture("e2e-governance-vote.ts", "seed", `${runId}-open`, USER_A_EMAIL, "cahootz", opensUntil.toISOString());
  const closed = fixture("e2e-governance-vote.ts", "seed", `${runId}-closed`, USER_A_EMAIL, "cahootz", closedOn.toISOString());
  const member = await newSignedInPage(browser, USER_A_EMAIL);
  const { page } = member;

  try {
    const closingLine = `Voting closes ${WEEKDAYS[opensUntil.getDay()]}, ${MONTHS[opensUntil.getMonth()]} ${opensUntil.getDate()}${
      opensUntil.getFullYear() === new Date().getFullYear() ? "" : `, ${opensUntil.getFullYear()}`
    } at 5:00 PM (in 3 days)`;
    const closedLine = `Voting closed ${MONTHS[closedOn.getMonth()]} ${closedOn.getDate()}${
      closedOn.getFullYear() === new Date().getFullYear() ? "" : `, ${closedOn.getFullYear()}`
    }`;

    // The hub card for an open proposal counts down; a closed one says so.
    await page.goto("/proposals?coopId=cahootz");
    await expect(hubCard(page, open.title)).toContainText("Closes in 3 days");
    await expect(hubCard(page, closed.title)).toContainText("Voting closed");
    await expect(hubCard(page, closed.title)).not.toContainText("Closes in");

    // The detail page says exactly when voting closes, and still does after a reload.
    await shown(page, open.title, { exact: true }).click();
    await expect(page).toHaveURL(/proposal-detail/);
    await expect(shown(page, closingLine, { exact: true })).toBeVisible();
    await page.reload();
    await expect(shown(page, closingLine, { exact: true })).toBeVisible();

    // A proposal whose end date has passed says voting closed, with the date.
    await page.goto("/proposals?coopId=cahootz");
    await shown(page, closed.title, { exact: true }).click();
    await expect(page).toHaveURL(/proposal-detail/);
    await expect(shown(page, closedLine, { exact: true })).toBeVisible();
    await expect(shown(page, /^Voting closes /)).toHaveCount(0);
  } finally {
    await member.context.close();
    fixture("e2e-governance-vote.ts", "cleanup", open.proposalId, closed.proposalId);
  }
});
