import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { newSignedInPage, USER_A_EMAIL } from "./support/auth";
import { withExclusiveAccountSetting } from "./support/exclusive";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function fixture(command: "seed" | "cleanup" | "followup") {
  const output = execFileSync("pnpm", ["--silent", "-F", "@cahootz/api", "exec", "tsx", "--import", "./dotenv.config.js", "scripts/e2e-sage-weekly-outreach.ts", command, USER_A_EMAIL], {
    cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000,
  });
  const line = output.split("\n").reverse().find((entry) => entry.startsWith("E2E_RESULT "));
  if (!line) throw new Error(`Weekly outreach fixture printed no result:\n${output}`);
  return JSON.parse(line.slice("E2E_RESULT ".length)) as { content?: string | null };
}

// Takes turns with sage-member-post.spec.ts, which also uses A's Sage conversation.
test("Sage's weekly check-in arrives through the existing private-message inbox", async ({ browser }) => withExclusiveAccountSetting("user-a-sage-conversation", async () => {
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

    // Answering the check-in gets a short follow-up from Sage in the same conversation.
    const answer = `E2E ${Date.now()}: Pretty good week, thanks for asking.`;
    await member.page.getByLabel(/^Message Sage/).locator("visible=true").first().fill(answer);
    await member.page.getByLabel("Send message").click();
    await expect(member.page.getByText(answer).last()).toBeVisible();
    let followup: string | null | undefined;
    await expect.poll(() => (followup = fixture("followup").content), { timeout: 60_000 }).toBeTruthy();
    await member.page.reload();
    await member.page.getByLabel("Conversation with Sage").click();
    await expect(member.page.getByText(answer).last()).toBeVisible();
    await expect(member.page.getByText(followup!.split("\n")[0]!).last()).toBeVisible();

    // Code sent to Sage gets the fixed guardrail reply instead of a model answer.
    await member.page.getByLabel(/^Message Sage/).locator("visible=true").first().fill("function hack() { return document.cookie; }");
    await member.page.getByLabel("Send message").click();
    await expect(member.page.getByText("That looks like code, and that's not really my thing.", { exact: false }).last()).toBeVisible({ timeout: 30_000 });

    // An urgent disclosure in a check-in reply always gets the fixed safety reply, with no model call.
    await member.page.getByLabel(/^Message Sage/).locator("visible=true").first().fill("E2E: honestly I've been thinking about suicide");
    await member.page.getByLabel("Send message").click();
    await expect(member.page.getByText("If you're in danger right now, please call your local emergency number.", { exact: false }).last()).toBeVisible({ timeout: 30_000 });
  } finally {
    fixture("cleanup");
    await member.context.close();
  }
}));
