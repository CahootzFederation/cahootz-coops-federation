import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { newSignedInPage, USER_A_EMAIL, USER_B_EMAIL } from "./support/auth";
import { withExclusiveAccountSetting } from "./support/exclusive";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const COOP_ID = "cahootz";

function fixture(...args: string[]) {
  const output = execFileSync("pnpm", ["--silent", "-F", "@cahootz/api", "exec", "tsx", "--import", "./dotenv.config.js", "scripts/e2e-sage-member-post.ts", ...args], {
    cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000,
  });
  const line = output.split("\n").reverse().find((entry) => entry.startsWith("E2E_RESULT "));
  if (!line) throw new Error(`Member post fixture printed no result:\n${output}`);
  return JSON.parse(line.slice("E2E_RESULT ".length));
}

// Sage proposed an anonymous post for User A in their private conversation (the fixture stands in for
// the model's propose_post call). A says yes in the chat, Sage posts it without A's name, User B replies
// on the post, and Sage relays B's reply to A privately with an offer to introduce them.
// Takes turns with the other specs that use A's Sage conversation, and with those that introduce A and B
// (an introduction between the same pair is suppressed for 30 days).
test("Sage posts anonymously for a member after their yes and relays a reply privately", async ({ browser }) =>
  withExclusiveAccountSetting("sage-introductions", () => withExclusiveAccountSetting("user-a-sage-conversation", async () => {
  test.setTimeout(240_000);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const memberA = await newSignedInPage(browser, USER_A_EMAIL);
  const memberB = await newSignedInPage(browser, USER_B_EMAIL);
  let seededAt: string | undefined;
  try {
    ({ seededAt } = fixture("seed", USER_A_EMAIL, runId));

    await memberA.page.goto("/messages");
    await memberA.page.getByLabel("Conversation with Sage").click();
    await expect(memberA.page.getByText(/Want me to post it\? Reply yes/).last()).toBeVisible();
    await memberA.page.getByLabel(/^Message Sage/).locator("visible=true").first().fill("yes");
    await memberA.page.getByLabel("Send message").click();
    await expect(memberA.page.getByText(/It's posted, without your name/).last()).toBeVisible({ timeout: 60_000 });

    // B opens the post in the Commons: it's from Sage and doesn't name A.
    const { postId } = fixture("post", USER_A_EMAIL, runId);
    expect(postId).toBeTruthy();
    await memberB.page.goto(`/${COOP_ID}/posts/${postId}`);
    // The post page shows the body (not the title), from Sage, with no name.
    await expect(memberB.page.getByText(`E2E ${runId}: A member with hospitality experience`, { exact: false }).first()).toBeVisible({ timeout: 60_000 });
    await memberB.page.getByPlaceholder("Write a comment...").locator("visible=true").first().fill(`E2E ${runId}: my restaurant is hiring weekend shifts`);
    await memberB.page.getByLabel("Send comment").locator("visible=true").first().click();

    // A hears about the reply privately, with an offer to be introduced.
    await expect(async () => {
      await memberA.page.reload();
      await memberA.page.getByLabel("Conversation with Sage").click();
      await expect(memberA.page.getByText(/Someone replied to your post/).last()).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 60_000 });
    await expect(memberA.page.getByText(`my restaurant is hiring weekend shifts`, { exact: false }).last()).toBeVisible();
    await expect(memberA.page.getByText(/Want me to introduce you\?/).last()).toBeVisible();
  } finally {
    if (seededAt) fixture("cleanup", USER_A_EMAIL, runId, seededAt);
    await memberA.context.close();
    await memberB.context.close();
  }
})));
