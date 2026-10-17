import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { newSignedInPage, USER_A_EMAIL, USER_B_EMAIL } from "./support/auth";
import { withExclusiveAccountSetting } from "./support/exclusive";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const COOP_ID = "cahootz";

function fixture(...args: string[]) {
  const output = execFileSync("pnpm", ["--silent", "-F", "@cahootz/api", "exec", "tsx", "--import", "./dotenv.config.js", "scripts/e2e-sage-proactive.ts", ...args], {
    cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000,
  });
  const line = output.split("\n").reverse().find((entry) => entry.startsWith("E2E_RESULT "));
  if (!line) throw new Error(`Proactive fixture printed no result:\n${output}`);
  return JSON.parse(line.slice("E2E_RESULT ".length));
}

async function openSage(page: Page) {
  await page.goto("/messages");
  await page.getByLabel("Conversation with Sage").click();
}

async function expectFromSage(page: Page, text: string | RegExp) {
  await expect(async () => {
    await openSage(page);
    await expect(page.getByText(text).last()).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
}

async function reply(page: Page, text: string) {
  await page.getByLabel(/^Message Sage/).locator("visible=true").first().fill(text);
  await page.getByLabel("Send message").click();
}

// Sage reaching out on its own: a promised check-back arrives; a need nobody answered is brought to a
// member whose profile fits; and after an introduction, "did it help?" leads to a private thank-you
// and, with the helper's yes, a public shout-out that names only them.
test("Sage keeps a promise, brings a quiet need to a likely helper, and thanks a helper", async ({ browser }) =>
  withExclusiveAccountSetting("sage-introductions", () => withExclusiveAccountSetting("user-a-sage-conversation", () =>
    withExclusiveAccountSetting("user-b-sage-conversation", async () => {
      test.setTimeout(300_000);
      const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const since = new Date(Date.now() - 1_000).toISOString();
      const memberA = await newSignedInPage(browser, USER_A_EMAIL);
      const memberB = await newSignedInPage(browser, USER_B_EMAIL);
      try {
        // 1. A promise Sage made comes due.
        const promised = fixture("promise", USER_A_EMAIL, runId);
        await expectFromSage(memberA.page, promised.expected);

        // 2. B's Need post had no answers for 49 hours; A's profile fits, so Sage asks A privately.
        const need = fixture("need", USER_A_EMAIL, USER_B_EMAIL, runId);
        expect(need.asked).toBe(1);
        await expectFromSage(memberA.page, new RegExp(`asks for help with “${need.title}”`));
        await expect(memberA.page.getByText(/Could you take a look and reply there/).last()).toBeVisible();

        // 3. Five days after an introduction, A says it helped; B is thanked and agrees to a shout-out.
        const intro = fixture("intro", USER_A_EMAIL, USER_B_EMAIL, runId);
        await expectFromSage(memberA.page, /Did the person I introduced you to help/);
        await reply(memberA.page, "yes");
        await expect(memberA.page.getByText("Thank you for telling me. I'll pass on your thanks.").last()).toBeVisible({ timeout: 60_000 });

        await expectFromSage(memberB.page, /Can I share a short shout-out/);
        await reply(memberB.page, "yes");
        await expect(memberB.page.getByText("Thank you. I'll share it in the Commons.").last()).toBeVisible({ timeout: 60_000 });

        let shout: { postId: string | null; title: string | null } = { postId: null, title: null };
        await expect.poll(() => (shout = fixture("shoutout", runId, since)).postId, { timeout: 60_000 }).toBeTruthy();
        await memberA.page.goto(`/${COOP_ID}/posts/${shout.postId}`);
        // The post page shows the body, not the title.
        await expect(memberA.page.getByText(`Big thanks to ${intro.helperName} for stepping up for another member`, { exact: false }).first()).toBeVisible({ timeout: 60_000 });
        await expect(memberA.page.getByText(/ride to the clinic/)).toHaveCount(0);
      } finally {
        fixture("cleanup", USER_A_EMAIL, USER_B_EMAIL, runId, since);
        await memberA.context.close();
        await memberB.context.close();
      }
    }))));
