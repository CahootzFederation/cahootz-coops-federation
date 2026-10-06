import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { newSignedInPage, USER_A_EMAIL, USER_B_EMAIL } from "./support/auth";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const STEWARD_SENTENCE =
  "Stewards look after this commons. They approve or decline people who ask to join, manage invitations, and can make others stewards or remove members.";

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

/**
 * Visible text only. Expo Router keeps earlier screens of a stack mounted
 * (hidden), so the same text can exist on a screen underneath.
 */
function shown(page: Page, text: string | RegExp, options?: { exact?: boolean }) {
  return page.getByText(text, options).filter({ visible: true });
}

function button(page: Page, name: string | RegExp) {
  return page.getByRole("button", { name, exact: typeof name === "string" }).filter({ visible: true });
}

async function expectTapTarget(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box, "the control is on screen").not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);
}

/** Opens a proposal from the commons' proposal hub, the way a member would. */
async function openProposal(page: Page, title: string) {
  await page.goto("/proposals?coopId=cahootz");
  await shown(page, title, { exact: true }).click();
  await expect(page).toHaveURL(/proposal-detail/);
  await expect(shown(page, "Proposal Details", { exact: true })).toBeVisible();
}

const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

test.describe("governance confirmations", () => {
  test("a steward learns what a steward is and confirms before making someone a steward", async ({ browser }) => {
    test.setTimeout(240_000);
    // `e2e-family-commons.ts cleanup` only deletes commons named "E2E Family …".
    const familyName = `E2E Family Gov ${runId}`;
    const steward = await newSignedInPage(browser, USER_A_EMAIL);
    const member = await newSignedInPage(browser, USER_B_EMAIL);

    try {
      // User A starts a family and lands on its steward tools.
      await steward.page.goto("/commons");
      await steward.page.getByRole("button", { name: "Start a family" }).click();
      await steward.page.getByLabel("Family name").fill(familyName);
      // Skips the optional goals and agreement: they stay blank, to set up later.
      await shown(steward.page, "Skip for now and create the family", { exact: true }).click();
      await expect(steward.page).toHaveURL(/commons-invites\?coopId=family-/);
      await expect(shown(steward.page, "Steward tools")).toBeVisible();
      await expect(shown(steward.page, /^Not set up yet\. Add what the family is building toward/)).toBeVisible();
      await expect(steward.page.getByRole("button", { name: "Set up goals and agreement" })).toBeVisible();

      // "What's a steward?" is a large tap target that opens a plain sentence.
      const help = button(steward.page, "What's a steward?");
      await expect(help).toBeVisible();
      await expectTapTarget(help);
      await expect(shown(steward.page, STEWARD_SENTENCE)).toHaveCount(0);
      await help.click();
      await expect(shown(steward.page, STEWARD_SENTENCE)).toBeVisible();
      await help.click();
      await expect(shown(steward.page, STEWARD_SENTENCE)).toHaveCount(0);

      // A invites B by email, and B joins from the invitation.
      await steward.page.getByLabel("Their name").fill("E2E Gov Cousin");
      await steward.page.getByLabel("Their email").fill(USER_B_EMAIL);
      await shown(steward.page, "Send invitation", { exact: true }).click();
      await expect(shown(steward.page, "Invitation sent.")).toBeVisible();

      await member.page.goto("/");
      await member.page.getByLabel(`Open invitation to ${familyName}`).click();
      await member.page.getByRole("checkbox", { name: `I agree to ${familyName}'s rules` }).click();
      await shown(member.page, `Join ${familyName}`, { exact: true }).click();
      await expect(member.page).toHaveURL(/\/family-[^/]+\/posts\//);

      // Making B a steward asks first and says what B will be able to do.
      await steward.page.reload();
      await expect(shown(steward.page, "Members", { exact: true })).toBeVisible();
      await expect(button(steward.page, "Remove as steward")).toHaveCount(0);
      await button(steward.page, "Make steward").click();
      await expect(shown(steward.page, /^Make .+ a steward\?$/)).toBeVisible();
      await expect(
        shown(steward.page, /will be able to approve or decline people who ask to join, manage invitations, make others stewards, and remove members\./),
      ).toBeVisible();
      await expectTapTarget(button(steward.page, "Yes, make steward"));
      await expectTapTarget(button(steward.page, "Go back"));

      // "Go back" changes nothing.
      await button(steward.page, "Go back").click();
      await expect(shown(steward.page, /^Make .+ a steward\?$/)).toHaveCount(0);
      await steward.page.reload();
      await expect(button(steward.page, "Make steward")).toBeVisible();
      await expect(button(steward.page, "Remove as steward")).toHaveCount(0);

      // Confirming does it, and it sticks after a reload.
      await button(steward.page, "Make steward").click();
      await button(steward.page, "Yes, make steward").click();
      await expect(button(steward.page, "Remove as steward")).toBeVisible();
      await steward.page.reload();
      await expect(button(steward.page, "Remove as steward")).toBeVisible();
      await expect(button(steward.page, "Make steward")).toHaveCount(0);
    } finally {
      await steward.context.close();
      await member.context.close();
      fixture("e2e-family-commons.ts", "cleanup", familyName);
    }
  });

  test("a steward makes a member a guide, whose family invitations then go out directly", async ({ browser }) => {
    test.setTimeout(480_000);
    const familyName = `E2E Family Guide ${runId}`;
    // A throwaway address that never signs in; cleanup deletes the family's invitations.
    const guideInvitee = `e2e-guide-${runId}@test.cahootz.local`;
    const steward = await newSignedInPage(browser, USER_A_EMAIL);
    const member = await newSignedInPage(browser, USER_B_EMAIL);

    try {
      await steward.page.goto("/commons");
      await steward.page.getByRole("button", { name: "Start a family" }).click();
      await steward.page.getByLabel("Family name").fill(familyName);
      await shown(steward.page, "Skip for now and create the family", { exact: true }).click();
      await expect(steward.page).toHaveURL(/commons-invites\?coopId=family-/);
      const coopId = new URL(steward.page.url()).searchParams.get("coopId")!;

      await steward.page.getByLabel("Their name").fill("E2E Guide Cousin");
      await steward.page.getByLabel("Their email").fill(USER_B_EMAIL);
      await shown(steward.page, "Send invitation", { exact: true }).click();
      await expect(shown(steward.page, "Invitation sent.")).toBeVisible();

      await member.page.goto("/");
      await member.page.getByLabel(`Open invitation to ${familyName}`).click();
      await member.page.getByRole("checkbox", { name: `I agree to ${familyName}'s rules` }).click();
      await shown(member.page, `Join ${familyName}`, { exact: true }).click();
      await expect(member.page).toHaveURL(/\/family-[^/]+\/posts\//);

      // Before: an ordinary family member can only recommend someone.
      await member.page.goto(`/commons-invites?coopId=${coopId}`);
      await expect(shown(member.page, "Recommend someone", { exact: true })).toBeVisible();
      await expect(shown(member.page, /^You're a guide here\./)).toHaveCount(0);

      // "Make guide" asks first and says what B will and won't be able to do.
      await steward.page.reload();
      await expect(shown(steward.page, "Members", { exact: true })).toBeVisible();
      await button(steward.page, "Make guide").click();
      await expect(shown(steward.page, /^Make .+ a guide\?$/)).toBeVisible();
      await expect(
        shown(steward.page, /will be able to invite people directly, without waiting for a steward\. They won't be able to approve requests, change anyone's role, or remove members\./),
      ).toBeVisible();
      await expectTapTarget(button(steward.page, "Yes, make guide"));
      await button(steward.page, "Yes, make guide").click();
      await expect(button(steward.page, "Remove as guide")).toBeVisible();
      await steward.page.reload();
      await expect(button(steward.page, "Remove as guide")).toBeVisible();
      await expect(shown(steward.page, "Guide", { exact: true })).toBeVisible();

      // B, now a guide, opens the invite screen from the family's page.
      await member.page.goto(`/commons/${coopId}`);
      await shown(member.page, "Invite", { exact: true }).click();
      await expect(member.page).toHaveURL(/commons-invites/);
      await expect(shown(member.page, "Invite family", { exact: true })).toBeVisible();
      await expect(shown(member.page, /^You're a guide here\./)).toBeVisible();
      // Guides get no steward tools.
      await expect(shown(member.page, "Members", { exact: true })).toHaveCount(0);
      await expect(button(member.page, "Make steward")).toHaveCount(0);
      await expect(shown(member.page, "Shareable link", { exact: true })).toHaveCount(0);

      // B's invitation is sent, not held as a recommendation.
      await member.page.getByLabel("Their name").fill("E2E Guide Invitee");
      await member.page.getByLabel("Their email").fill(guideInvitee);
      await shown(member.page, "Send invitation", { exact: true }).click();
      await expect(shown(member.page, "Invitation sent.")).toBeVisible();
      await member.page.reload();
      await expect(shown(member.page, "E2E Guide Invitee", { exact: true })).toBeVisible();
      await expect(shown(member.page, "Waiting for a steward", { exact: true })).toHaveCount(0);

      // The steward sees it as a sent invitation with nothing to approve.
      await steward.page.reload();
      await expect(shown(steward.page, "E2E Guide Invitee", { exact: true })).toBeVisible();
      await expect(shown(steward.page, "Recommendations to review", { exact: true })).toHaveCount(0);

      // Removing the role puts B back to recommending.
      await button(steward.page, "Remove as guide").click();
      await expect(shown(steward.page, /^Remove .+ as a guide\?$/)).toBeVisible();
      await button(steward.page, "Yes, remove as guide").click();
      await expect(button(steward.page, "Make guide")).toBeVisible();
      await member.page.reload();
      await expect(shown(member.page, "Recommend someone", { exact: true })).toBeVisible();
    } finally {
      await steward.context.close();
      await member.context.close();
      fixture("e2e-family-commons.ts", "cleanup", familyName);
    }
  });

  test("a council vote asks for confirmation before it is cast", async ({ browser }) => {
    test.setTimeout(180_000);
    const { proposalId, title } = fixture("e2e-governance-vote.ts", "seed", `${runId}-vote`, USER_A_EMAIL);
    let voter: Awaited<ReturnType<typeof newSignedInPage>> | undefined;

    try {
      voter = await newSignedInPage(browser, USER_A_EMAIL);
      const { page } = voter;
      // The council panel shows for accounts with the admin role, and
      // `proposal.councilVote` checks that role on chain, which a local test
      // account can't have. This test gives only its own browser session the
      // role and answers the vote call itself, so it checks that the
      // confirmation decides whether a vote is sent and with which value.
      await page.evaluate(() => {
        const user = JSON.parse(window.localStorage.getItem("cahootz.user") ?? "{}");
        user.roles = [...new Set([...(user.roles ?? []), "admin"])];
        window.localStorage.setItem("cahootz.user", JSON.stringify(user));
      });
      const sentVotes: string[] = [];
      await page.route("**/trpc/proposal.councilVote**", async (route) => {
        const body = route.request().postDataJSON() as { proposalId: string; vote: string };
        expect(body.proposalId).toBe(proposalId);
        sentVotes.push(body.vote);
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            result: {
              data: {
                vote: body.vote,
                forCount: body.vote === "FOR" ? 1 : 0,
                againstCount: body.vote === "AGAINST" ? 1 : 0,
                abstainCount: body.vote === "ABSTAIN" ? 1 : 0,
                newStatus: null,
              },
            },
          }),
        });
      });

      await openProposal(page, title);

      // Plain labels in place of FOR / AGAINST / ABSTAIN.
      for (const label of ["Yes, approve", "No, reject", "No opinion"]) {
        await expect(button(page, label)).toBeVisible();
        await expectTapTarget(button(page, label));
      }
      await expect(button(page, "FOR")).toHaveCount(0);

      // Tapping a choice only opens the confirmation.
      await button(page, "Yes, approve").click();
      await expect(shown(page, "Cast your vote?")).toBeVisible();
      await expect(shown(page, /^Your vote: Yes, approve$/)).toBeVisible();
      await expect(shown(page, `Proposal: ${title}`)).toBeVisible();
      await expect(
        shown(page, "You can change your vote while voting is still open. Once enough of the council has voted, the result is final."),
      ).toBeVisible();
      await expectTapTarget(button(page, "Cast my vote"));
      await expectTapTarget(button(page, "Go back"));
      expect(sentVotes).toEqual([]);

      // "Go back" casts nothing.
      await button(page, "Go back").click();
      await expect(shown(page, "Cast your vote?")).toHaveCount(0);
      await expect(shown(page, /^Your vote was counted/)).toHaveCount(0);
      expect(sentVotes).toEqual([]);

      // "Cast my vote" sends the chosen value once and shows the result.
      await button(page, "No, reject").click();
      await expect(shown(page, /^Your vote: No, reject$/)).toBeVisible();
      await button(page, "Cast my vote").click();
      await expect(shown(page, "Your vote was counted: No, reject.")).toBeVisible();
      await expect(shown(page, "So far: 0 yes · 1 no · 0 no opinion")).toBeVisible();
      await expect(shown(page, "Cast your vote?")).toHaveCount(0);
      expect(sentVotes).toEqual(["AGAINST"]);
    } finally {
      await voter?.context.close();
      fixture("e2e-governance-vote.ts", "cleanup", proposalId);
    }
  });

  test("withdrawing a proposal asks first, and only confirming withdraws it", async ({ browser }) => {
    test.setTimeout(180_000);
    const { proposalId, title } = fixture("e2e-governance-vote.ts", "seed", `${runId}-withdraw`, USER_A_EMAIL);
    let proposer: Awaited<ReturnType<typeof newSignedInPage>> | undefined;

    try {
      proposer = await newSignedInPage(browser, USER_A_EMAIL);
      const { page } = proposer;
      await openProposal(page, title);

      await button(page, "Withdraw proposal").click();
      await expect(shown(page, "Withdraw this proposal?")).toBeVisible();
      await expect(shown(page, /will be taken down, and no one can vote on it\. You can't undo this\./)).toBeVisible();
      await expectTapTarget(button(page, "Yes, withdraw it"));
      await expectTapTarget(button(page, "Go back"));

      // "Go back" leaves it open.
      await button(page, "Go back").click();
      await expect(shown(page, "Withdraw this proposal?")).toHaveCount(0);
      expect(fixture("e2e-governance-vote.ts", "status", proposalId).status).toBe("VOTABLE");

      // Confirming withdraws it; the button is gone, also after a reload.
      await button(page, "Withdraw proposal").click();
      await button(page, "Yes, withdraw it").click();
      await expect(shown(page, "Withdraw this proposal?")).toHaveCount(0);
      await expect(button(page, "Withdraw proposal")).toHaveCount(0);
      expect(fixture("e2e-governance-vote.ts", "status", proposalId).status).toBe("WITHDRAWN");
      await page.reload();
      await expect(shown(page, "Proposal Details", { exact: true })).toBeVisible();
      await expect(shown(page, title, { exact: true }).first()).toBeVisible();
      await expect(button(page, "Withdraw proposal")).toHaveCount(0);
    } finally {
      await proposer?.context.close();
      fixture("e2e-governance-vote.ts", "cleanup", proposalId);
    }
  });
});
