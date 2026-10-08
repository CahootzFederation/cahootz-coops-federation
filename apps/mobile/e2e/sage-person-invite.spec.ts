import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { newSignedInPage, USER_A_EMAIL, USER_B_EMAIL } from "./support/auth";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** Runs an `apps/api/scripts` fixture and returns its `E2E_RESULT` JSON. Setup and cleanup only. */
function fixture(script: string, ...args: string[]) {
  const output = execFileSync(
    "pnpm",
    ["--silent", "-F", "@cahootz/api", "exec", "tsx", "--import", "./dotenv.config.js", `scripts/${script}`, ...args],
    { cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000 },
  );
  const line = output.split("\n").reverse().find((entry) => entry.startsWith("E2E_RESULT "));
  if (!line) throw new Error(`${script} printed no result:\n${output}`);
  return JSON.parse(line.slice("E2E_RESULT ".length));
}

function shown(page: Page, text: string | RegExp, options?: { exact?: boolean }) {
  return page.getByText(text, options).filter({ visible: true });
}

async function openAlerts(page: Page) {
  await page.goto("/");
  await page.getByLabel("Alerts", { exact: true }).locator("visible=true").first().click();
}

const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
// Letters only: Sage ignores names with digits. Unique per run so earlier runs never collide.
const surname = `Q${Array.from({ length: 6 }, () => "abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 26)]).join("")}`;
const person = `Aunt Odessa ${surname}`;

test("Sage asks a family member about someone who keeps coming up, and a steward sends the invitation with one tap", async ({ browser }) => {
  test.setTimeout(300_000);
  // `e2e-family-commons.ts cleanup` only deletes commons named "E2E Family …", with Sage's suggestions there.
  const familyName = `E2E Family Mention ${runId}`;
  const invitee = `e2e-mention-${runId}@test.cahootz.local`;
  const steward = await newSignedInPage(browser, USER_A_EMAIL);
  const member = await newSignedInPage(browser, USER_B_EMAIL);

  try {
    // User A starts a family (A is its steward) and invites User B, who joins as an ordinary member.
    await steward.page.goto("/commons");
    await steward.page.getByRole("button", { name: "Start a family" }).click();
    await steward.page.getByLabel("Family name").fill(familyName);
    await shown(steward.page, "Skip for now and create the family", { exact: true }).click();
    await expect(steward.page).toHaveURL(/commons-invites\?coopId=family-/);
    await steward.page.getByLabel("Their name").fill("E2E Mention Cousin");
    await steward.page.getByLabel("Their email").fill(USER_B_EMAIL);
    await shown(steward.page, "Send invitation", { exact: true }).click();
    await expect(shown(steward.page, "Invitation sent.")).toBeVisible();

    await member.page.goto("/");
    await member.page.getByLabel(`Open invitation to ${familyName}`).click();
    await member.page.getByRole("checkbox", { name: `I agree to ${familyName}'s rules` }).click();
    await shown(member.page, `Join ${familyName}`, { exact: true }).click();
    await expect(member.page).toHaveURL(/\/family-[^/]+\/posts\//);

    // B has mentioned the aunt in three family posts; Sage's real rules decide to ask B (the one who mentions her).
    const asked = fixture("e2e-sage-person-invite.ts", "mentions", familyName, USER_B_EMAIL, person, runId);
    expect(asked).toMatchObject({ created: true });

    // 1. B gets the question in Alerts and opens it.
    await openAlerts(member.page);
    await shown(member.page, `Should we invite ${person}?`).first().click();
    await expect(member.page).toHaveURL(/\/sage\//);
    await expect(shown(member.page, "Someone keeps coming up")).toBeVisible();
    await expect(shown(member.page, /came up 3 times in .*posts and comments in the last 30 days, and isn't a member\./)).toBeVisible();
    await expect(shown(member.page, /a steward can send the invitation with one tap/)).toBeVisible();
    await expect(member.page.getByLabel("Their name")).toHaveValue(person);
    await expect(member.page.getByRole("button", { name: "Ask an admin" })).toHaveCount(0);

    // 2. Sending without a phone or email says what's missing and changes nothing.
    await member.page.getByRole("button", { name: "Send invite" }).click();
    await expect(shown(member.page, "Add a phone number or email so the invitation can reach them.")).toBeVisible();

    // 3. B adds an email and sends it; as a member, it goes to a steward.
    await member.page.getByLabel("Their email").fill(invitee);
    await member.page.getByRole("button", { name: "Send invite" }).click();
    await expect(shown(member.page, "Sent to a steward. They can send the invitation with one tap.")).toBeVisible();
    await member.page.reload();
    await expect(shown(member.page, "Sent to a steward to approve")).toBeVisible();
    await expect(member.page.getByRole("button", { name: "Send invite" })).toHaveCount(0);

    // 4. The steward's alert says why, and opens the review list where one tap sends it.
    await openAlerts(steward.page);
    const alert = shown(steward.page, new RegExp(`wants to invite ${person}`)).first();
    await expect(alert).toBeVisible();
    await expect(shown(steward.page, new RegExp(`Sage noticed ${person} came up 3 times in the family feed\\.`)).first()).toBeVisible();
    await alert.click();
    await expect(steward.page).toHaveURL(/commons-invites\?coopId=family-/);
    await expect(shown(steward.page, "Recommendations to review")).toBeVisible();
    await expect(shown(steward.page, person, { exact: true })).toBeVisible();
    await steward.page.getByText("Approve and send", { exact: true }).filter({ visible: true }).click();

    // 5. It's now a sent invitation, also after a reload.
    await steward.page.reload();
    await expect(shown(steward.page, "Recommendations to review")).toHaveCount(0);
    const pending = shown(steward.page, person, { exact: true });
    await expect(pending).toBeVisible();
    await expect(shown(steward.page, new RegExp(`${invitee.replace(/[.]/g, "\\.")} · Invited by`))).toBeVisible();

    // 6. Sage doesn't ask about the same person again.
    expect(fixture("e2e-sage-person-invite.ts", "mentions", familyName, USER_B_EMAIL, person, `${runId}-again`))
      .toMatchObject({ created: false, reason: "Sage already asked about this person recently" });
  } finally {
    await steward.context.close();
    await member.context.close();
    fixture("e2e-family-commons.ts", "cleanup", familyName);
  }
});
