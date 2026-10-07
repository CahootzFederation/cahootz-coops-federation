import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { newSignedInPage, USER_A_EMAIL, USER_B_EMAIL } from "./support/auth";

// The proposal outcome loop: a funded proposal's goals get outcome checks, Sage privately asks the
// author for the result when it's due, the author reports it on the proposal page, every member sees
// it, and a later similar proposal shows that result from Sage's memory. Fixtures run the real service
// code (apps/api/scripts/e2e-proposal-outcome.ts); nothing here calls a live model.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function fixture(...args: string[]) {
  const output = execFileSync(
    "pnpm",
    ["--silent", "-F", "@cahootz/api", "exec", "tsx", "--import", "./dotenv.config.js", "scripts/e2e-proposal-outcome.ts", ...args],
    { cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000 },
  );
  const line = output.split("\n").reverse().find((entry) => entry.startsWith("E2E_RESULT "));
  if (!line) throw new Error(`e2e-proposal-outcome.ts printed no result:\n${output}`);
  return JSON.parse(line.slice("E2E_RESULT ".length));
}

/** Visible text only: Expo Router keeps earlier screens of a stack mounted but hidden. */
function shown(page: Page, text: string | RegExp, options?: { exact?: boolean }) {
  return page.getByText(text, options).filter({ visible: true });
}

async function openFollowing(page: Page) {
  await page.goto("/sage");
  await page.getByRole("tab", { name: "Following" }).locator("visible=true").first().click();
}

async function openProposal(page: Page, proposalId: string) {
  await page.goto(`/proposal-detail?id=${proposalId}&coopId=cahootz`);
  await expect(shown(page, "Goals and results", { exact: true }).or(shown(page, "How similar proposals went", { exact: true })).first()).toBeVisible({ timeout: 30_000 });
}

test("a funded proposal's author reports a result Sage asked for, and a later similar proposal cites it", async ({ browser }) => {
  test.setTimeout(300_000);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const seeded = fixture("seed", runId, USER_A_EMAIL);
  const proposalIds: string[] = [seeded.proposalId];
  const meals = seeded.kpis.find((kpi: { name: string }) => kpi.name === "E2E meals served");
  const volunteers = seeded.kpis.find((kpi: { name: string }) => kpi.name === "E2E volunteers");
  const author = await newSignedInPage(browser, USER_A_EMAIL);
  const member = await newSignedInPage(browser, USER_B_EMAIL);

  try {
    // 1. Before a decision, the goals are listed with when they'll be checked.
    await openProposal(author.page, seeded.proposalId);
    await expect(shown(author.page, "If this proposal is approved, Sage will ask the author how each goal turned out.")).toBeVisible();
    await expect(author.page.getByTestId(`kpi-${meals.id}`).getByText("Goal: At least 500")).toBeVisible();
    await expect(author.page.getByTestId(`kpi-${meals.id}`).getByText("Checked 30 days after the proposal is approved.")).toBeVisible();

    // 2. Funded: each goal gets a measure date and an outcome check owned by the author.
    expect(fixture("fund", seeded.proposalId)).toEqual({ started: 2 });
    await author.page.reload();
    await expect(author.page.getByTestId(`kpi-${meals.id}`).getByText(/^Sage asks the author for the result on /)).toBeVisible();
    await expect(author.page.getByLabel("Result for E2E meals served", { exact: true })).toHaveCount(0);

    // 3. On the date, Sage asks the author privately: an alert that opens the proposal. The check is
    //    also listed under Sage → Following.
    expect(fixture("due", seeded.proposalId)).toMatchObject({ kpis: 2, tasks: 2 });
    fixture("wake");
    const mealsWaiting = `Waiting for you to report how "E2E meals served" went for "${seeded.title}" (goal: at least 500).`;
    await openFollowing(author.page);
    await expect(shown(author.page, mealsWaiting)).toBeVisible();
    await author.page.goto("/");
    await author.page.getByLabel("Alerts", { exact: true }).locator("visible=true").first().click();
    const ask = shown(author.page, `How did it go? E2E meals served · ${seeded.title}`);
    await expect(ask).toHaveCount(1);
    await ask.click();
    await expect(author.page).toHaveURL(new RegExp(`proposal-detail.*${seeded.proposalId}`));

    // 4. The author reports a number; code decides it was partly met. It survives a reload.
    const mealsRow = author.page.getByTestId(`kpi-${meals.id}`).filter({ visible: true });
    await mealsRow.getByLabel("Result for E2E meals served", { exact: true }).fill("300");
    await mealsRow.getByLabel("Note about E2E meals served", { exact: true }).fill(`E2E ${runId}: the fridge broke in week 3`);
    await mealsRow.getByRole("button", { name: "Save result for E2E meals served" }).click();
    await expect(mealsRow.getByText("Partly met", { exact: true })).toBeVisible();
    await expect(mealsRow.getByText("Result: 300 of 500")).toBeVisible();
    await author.page.reload();
    await expect(author.page.getByTestId(`kpi-${meals.id}`).getByText("Partly met", { exact: true })).toBeVisible();
    await expect(author.page.getByLabel("Result for E2E meals served", { exact: true })).toHaveCount(0);
    // Answering closed that check; the other goal's check is still open.
    await openFollowing(author.page);
    await expect(shown(author.page, `Waiting for you to report how "E2E volunteers" went for "${seeded.title}" (goal: at least 10).`)).toBeVisible();
    await expect(shown(author.page, mealsWaiting)).toHaveCount(0);

    // 5. Another member sees the result, labelled as the author's report, and can't report anything.
    await openProposal(member.page, seeded.proposalId);
    const memberMeals = member.page.getByTestId(`kpi-${meals.id}`).filter({ visible: true });
    await expect(memberMeals.getByText("Partly met", { exact: true })).toBeVisible();
    await expect(memberMeals.getByText("Reported by the proposal’s author. Not checked by anyone else.")).toBeVisible();
    await expect(memberMeals.getByText(`“E2E ${runId}: the fridge broke in week 3”`)).toBeVisible();
    await expect(member.page.getByTestId(`kpi-${volunteers.id}`).getByText("Waiting for the author to report the result.")).toBeVisible();
    await expect(member.page.getByLabel("Result for E2E volunteers", { exact: true })).toHaveCount(0);

    // 6. A later, similar proposal's review cites the earlier result from Sage's memory.
    const later = fixture("related", runId, USER_B_EMAIL, seeded.proposalId);
    proposalIds.push(later.proposalId);
    expect(later.priorOutcomes.length, JSON.stringify(later)).toBeGreaterThan(0);
    await openProposal(member.page, later.proposalId);
    await expect(shown(member.page, "How similar proposals went", { exact: true })).toBeVisible();
    await expect(shown(member.page, new RegExp(`"${seeded.title}" \\(\\$1,200, funded\\) · E2E meals served: 300 of 500 target, partly met`))).toBeVisible();
  } finally {
    await author.context.close();
    await member.context.close();
    fixture("cleanup", ...proposalIds);
  }
});
