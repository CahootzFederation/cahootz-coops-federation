import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { newSignedInPage, USER_A_EMAIL } from "./support/auth";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function fixture(command: "seed" | "cleanup") {
  const output = execFileSync("pnpm", ["--silent", "-F", "@cahootz/api", "exec", "tsx", "--import", "./dotenv.config.js", "scripts/e2e-sage-weekly-outreach.ts", command, USER_A_EMAIL], {
    cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000,
  });
  const line = output.split("\n").reverse().find((entry) => entry.startsWith("E2E_RESULT "));
  if (!line) throw new Error(`Weekly outreach fixture printed no result:\n${output}`);
  return JSON.parse(line.slice("E2E_RESULT ".length)) as { content?: string };
}

test("Sage's weekly check-in arrives through the existing private-message inbox", async ({ browser }) => {
  const member = await newSignedInPage(browser, USER_A_EMAIL);
  try {
    const seeded = fixture("seed");
    expect(seeded.content).toBeTruthy();

    await member.page.goto("/messages");
    const sage = member.page.getByLabel("Conversation with Sage");
    await expect(sage).toBeVisible();
    await expect(sage).toContainText(seeded.content!);
    await expect(sage.getByLabel(/\d+ unread/)).toBeVisible();

    await sage.click();
    await expect(member.page.getByText(seeded.content!).last()).toBeVisible();
    await member.page.reload();
    await member.page.getByLabel("Conversation with Sage").click();
    await expect(member.page.getByText(seeded.content!).last()).toBeVisible();
  } finally {
    fixture("cleanup");
    await member.context.close();
  }
});
