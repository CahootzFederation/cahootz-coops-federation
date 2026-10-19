import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { newSignedInPage, USER_A_EMAIL, USER_B_EMAIL } from "./support/auth";
import { withExclusiveAccountSetting } from "./support/exclusive";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const API_BASE_URL = process.env.E2E_API_BASE_URL || "http://localhost:3001";

/** Fixture setup and cleanup only (see apps/api/scripts/e2e-sage-avatar.ts). */
function avatarFixture(...args: string[]) {
  const output = execFileSync(
    "pnpm",
    ["--silent", "-F", "@cahootz/api", "exec", "tsx", "--import", "./dotenv.config.js", "scripts/e2e-sage-avatar.ts", ...args],
    { cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000 },
  );
  const line = output.split("\n").reverse().find((entry) => entry.startsWith("E2E_RESULT "));
  if (!line) throw new Error(`Sage avatar fixture printed no result:\n${output}`);
  return JSON.parse(line.slice("E2E_RESULT ".length));
}

async function sageDmGroupId(page: Page, sageUserId: string) {
  const sessionToken = await page.evaluate(() => window.localStorage.getItem("cahootz.sessionToken"));
  const response = await fetch(`${API_BASE_URL}/trpc/groups.listDirect`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-session-token": sessionToken! },
    body: "{}",
  });
  const threads = (await response.json())?.result?.data?.threads ?? [];
  return threads.find((thread: { person: { id: string } }) => thread.person.id === sageUserId)?.groupId as
    | string
    | undefined;
}

let sageUserId: string;

test.beforeAll(() => {
  // Sage's account is created lazily, so a fresh database may not have it yet.
  sageUserId = avatarFixture("seed").sageUserId;
});

// Sage has a face (a peach blob with round glasses) instead of initials or a
// sparkle icon. It shows on Sage's page and the Sage suggestions screen, and
// never on a person's own page.
test("Sage shows its own face instead of initials", async ({ browser }) => {
  const member = await newSignedInPage(browser, USER_A_EMAIL);

  try {
    await member.page.goto("/people/sage");
    // The profile card (not just the route header) has loaded.
    await expect(member.page.getByText("Sage", { exact: true }).first()).toBeVisible();
    await expect(member.page.getByTestId("sage-avatar").first()).toBeVisible();

    await member.page.goto("/sage");
    await expect(member.page.getByText("Sage suggestions").first()).toBeVisible();
    await expect(member.page.getByTestId("sage-avatar").first()).toBeVisible();

    await member.page.reload();
    await expect(member.page.getByTestId("sage-avatar").first()).toBeVisible();

    const raw = await member.page.evaluate(() => window.localStorage.getItem("cahootz.user"));
    const { handle } = JSON.parse(raw || "{}");
    expect(handle).toBeTruthy();
    await member.page.goto(`/people/${handle}`);
    await expect(member.page.getByText("Personal Page").first()).toBeVisible();
    await expect(member.page.getByTestId("sage-avatar")).toHaveCount(0);
  } finally {
    await member.context.close();
  }
});

// Sage writes its reply inside the send request, so while a message to Sage
// is in flight the member sees their message (faded) and Sage thinking. The
// request is held for a moment so the thinking state is reliably on screen;
// it doesn't depend on a model answering.
test("Sage shows it is thinking while it writes a reply in Messages", async ({ browser }) => {
  await withExclusiveAccountSetting("user-b-sage-conversation", async () => {
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const note = `E2E Sage thinking check ${runId}`;
    const member = await newSignedInPage(browser, USER_B_EMAIL);

    try {
      await member.page.goto(`/messages?userId=${sageUserId}&name=Sage`);
      const composer = member.page.getByRole("textbox", { name: "Message Sage" });
      await expect(composer).toBeVisible();
      await expect(member.page.getByTestId("sage-avatar").first()).toBeVisible();

      await member.page.route("**/trpc/groups.sendDirect*", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await route.continue();
      });
      await composer.fill(note);
      await member.page.getByLabel("Send message").click();

      await expect(member.page.getByText("Sage is thinking…")).toBeVisible();
      await expect(member.page.getByTestId("sage-avatar-thinking")).toBeVisible();
      await expect(member.page.getByText(note)).toBeVisible();

      await expect(member.page.getByText("Sage is thinking…")).toBeHidden({ timeout: 120_000 });
      // Exact, so the conversation list's "You: …" preview doesn't count: one bubble, not two.
      await expect(member.page.getByText(note, { exact: true })).toHaveCount(1);

      await member.page.unroute("**/trpc/groups.sendDirect*");
      await member.page.reload();
      await expect(member.page.getByText(note)).toBeVisible();
      await expect(member.page.getByTestId("sage-avatar-thinking")).toHaveCount(0);
    } finally {
      const groupId = await sageDmGroupId(member.page, sageUserId).catch(() => undefined);
      if (groupId) avatarFixture("cleanup", groupId);
      await member.context.close();
    }
  });
});
