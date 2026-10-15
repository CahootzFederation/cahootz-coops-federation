import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { newSignedInPage, USER_A_EMAIL, USER_B_EMAIL } from "./support/auth";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function fixture(...args: string[]) {
  const output = execFileSync("pnpm", ["--silent", "-F", "@cahootz/api", "exec", "tsx", "--import", "./dotenv.config.js", "scripts/e2e-sage-community-question.ts", ...args], {
    cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000,
  });
  const line = output.split("\n").reverse().find((entry) => entry.startsWith("E2E_RESULT "));
  if (!line) throw new Error(`Community question fixture printed no result:\n${output}`);
  return JSON.parse(line.slice("E2E_RESULT ".length));
}

// A community pattern is never shown to one person. When one qualifies (the fixture stands in for the
// daily sweep and runs the real posting code), Sage asks the whole Commons an open question in the feed,
// labeled as coming from an AI helper, with no counts or hint of private check-ins. Two members answer
// it, and their public answers are what Sage's impact review counts.
test("Sage asks the whole Commons an open question about a community pattern, and members answer it", async ({ browser }) => {
  test.setTimeout(240_000);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const memberA = await newSignedInPage(browser, USER_A_EMAIL);
  const memberB = await newSignedInPage(browser, USER_B_EMAIL);
  try {
    const { coopId, postId } = fixture("seed", runId);
    expect(postId).toBeTruthy();

    await memberA.page.goto(`/${coopId}/posts/${postId}`);
    const question = memberA.page.getByText("Would a shared tool library or lending list help?", { exact: false }).first();
    await expect(question).toBeVisible({ timeout: 60_000 });
    await expect(memberA.page.getByLabel("AI helper, not a person").filter({ visible: true }).first()).toBeVisible();
    await expect(memberA.page.getByText(/check-?in|members (said|reported|mentioned)/i)).toHaveCount(0);

    for (const [member, answer] of [[memberA, "I could lend a ladder and a drill"], [memberB, "I'd borrow a pressure washer"]] as const) {
      if (member !== memberA) await member.page.goto(`/${coopId}/posts/${postId}`);
      await expect(member.page.getByText("Would a shared tool library or lending list help?", { exact: false }).first()).toBeVisible({ timeout: 60_000 });
      await member.page.getByPlaceholder("Write a comment...").locator("visible=true").first().fill(`E2E ${runId}: ${answer}`);
      await member.page.getByLabel("Send comment").locator("visible=true").first().click();
      await expect(member.page.getByText(`E2E ${runId}: ${answer}`).first()).toBeVisible({ timeout: 30_000 });
    }

    // Both answers survive a reload and count toward the question's impact.
    await memberB.page.reload();
    await expect(memberB.page.getByText(`E2E ${runId}: I could lend a ladder and a drill`).first()).toBeVisible({ timeout: 60_000 });
    expect(fixture("responders", postId)).toEqual({ responders: 2 });
  } finally {
    fixture("cleanup", runId);
    await memberA.context.close();
    await memberB.context.close();
  }
});
