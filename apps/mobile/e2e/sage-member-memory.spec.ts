import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { newSignedInPage, USER_A_EMAIL } from "./support/auth";
import { withExclusiveAccountSetting } from "./support/exclusive";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function fixture(command: "seed" | "cleanup") {
  const output = execFileSync("pnpm", ["--silent", "-F", "@cahootz/api", "exec", "tsx", "--import", "./dotenv.config.js", "scripts/e2e-sage-weekly-outreach.ts", command, USER_A_EMAIL], {
    cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000,
  });
  const line = output.split("\n").reverse().find((entry) => entry.startsWith("E2E_RESULT "));
  if (!line) throw new Error(`Weekly outreach fixture printed no result:\n${output}`);
  return JSON.parse(line.slice("E2E_RESULT ".length)) as { content?: string | null };
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

// Shares A's Sage conversation with sage-weekly-outreach.spec.ts and sage-member-post.spec.ts.
test("a member sees what Sage remembers about them and makes it forget", async ({ browser }) => withExclusiveAccountSetting("user-a-sage-conversation", async () => {
  const member = await newSignedInPage(browser, USER_A_EMAIL);
  try {
    const seeded = fixture("seed");
    await member.page.goto("/messages");
    await member.page.getByLabel("Conversation with Sage").click();
    await expect(member.page.getByText(seeded.content!).last()).toBeVisible();

    // Asking Sage to remember a need in a check-in reply is the consent; Sage keeps the theme, not the words.
    await send(member.page, `E2E ${Date.now()}: please remember that I need a ride to the Saturday market`);

    await send(member.page, "What do you remember about me?");
    const list = member.page.getByText("Here's what you've asked me to remember:", { exact: false }).last();
    await expect(list).toBeVisible({ timeout: 60_000 });
    await expect(list).toContainText("a need around transportation access");
    await expect(list).not.toContainText("Saturday market");

    // It's a real record: a reload shows the same answer.
    await member.page.reload();
    await member.page.getByLabel("Conversation with Sage").click();
    await expect(member.page.getByText("a need around transportation access", { exact: false }).last()).toBeVisible();

    await send(member.page, "forget that");
    await expect(member.page.getByText("I've forgotten that you mentioned transportation access", { exact: false }).last()).toBeVisible({ timeout: 30_000 });

    await send(member.page, "What do you remember about me?");
    const after = member.page.getByText(/^(Here's what you've asked me to remember|I'm not keeping anything about you right now)/).last();
    await expect(after).toBeVisible({ timeout: 30_000 });
    await expect(after).not.toContainText("transportation access");
  } finally {
    fixture("cleanup");
    await member.context.close();
  }
}));
