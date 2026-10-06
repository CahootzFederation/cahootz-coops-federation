import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { enterFeed } from "./support/auth";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const TEST_CODE = process.env.E2E_LOGIN_CODE || "000000";
const CREATE_WALLET = "**/trpc/user.createWallet**";

// Every signed-in member gets a wallet before the screens that need one:
// at sign-in, and again (if that failed) before Proposals & Votes or You.
// Each test uses its own throwaway member who starts with no wallet, so the
// shared releaseclick fixtures are never changed.

/** Fixture setup and cleanup only (apps/api/scripts/e2e-wallet.ts). */
function walletFixture(command: "create" | "lookup" | "cleanup", email: string) {
  const output = execFileSync(
    "pnpm",
    ["--silent", "-F", "@cahootz/api", "exec", "tsx", "--import", "./dotenv.config.js", "scripts/e2e-wallet.ts", command, email],
    { cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000 },
  );
  const line = output.split("\n").reverse().find((entry) => entry.startsWith("E2E_RESULT "));
  if (!line) throw new Error(`Wallet fixture printed no result:\n${output}`);
  return JSON.parse(line.slice("E2E_RESULT ".length));
}

function throwawayEmail(label: string) {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `e2e-wallet-${label}-${runId}@test.cahootz.local`;
}

function shown(page: Page, text: string | RegExp, options?: { exact?: boolean }) {
  return page.getByText(text, options).filter({ visible: true });
}

async function signInAs(page: Page, email: string) {
  await enterFeed(page);
  await page.getByLabel("Open menu").click();
  await page.getByText("Sign In", { exact: true }).click();
  await page.getByPlaceholder("name@email.com").fill(email);
  await page.getByRole("button", { name: "Log in with code" }).click();
  await page.getByPlaceholder("Enter 6-digit code").fill(TEST_CODE);
  await page.getByRole("button", { name: "Verify & Sign In" }).click();
  await expect(page).toHaveURL(/profile-onboarding/);
  const later = page.getByRole("button", { name: "Do this later" });
  if (await later.isVisible().catch(() => false)) await later.click();
  const skip = page.getByRole("button", { name: "Skip for now" });
  await expect(skip).toBeVisible();
  await skip.click();
  await expect(page.getByLabel("Open menu").filter({ visible: true })).toBeVisible();
}

async function openProposals(page: Page) {
  await page.getByLabel("Open menu").filter({ visible: true }).click();
  await page.getByLabel(/^Open .+ proposals and votes$/).filter({ visible: true }).click();
  await expect(page).toHaveURL(/\/proposals\?coopId=/);
}

test.describe("automatic wallet creation", () => {
  test("signing in creates a wallet for a member who has none", async ({ browser }) => {
    const email = throwawayEmail("signin");
    walletFixture("create", email);
    const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
    const page = await context.newPage();
    try {
      expect(walletFixture("lookup", email)).toMatchObject({ walletAddress: null, wallets: 0 });

      await signInAs(page, email);

      const after = walletFixture("lookup", email);
      expect(after.walletAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(after).toMatchObject({ hasKey: true, wallets: 1 });

      await openProposals(page);
      await expect(shown(page, "Setting up your wallet...")).toHaveCount(0);
      await expect(shown(page, "Start a proposal", { exact: true })).toBeVisible();

      // Reloading keeps the same wallet; nothing new is minted.
      await page.reload();
      await expect(shown(page, "Start a proposal", { exact: true })).toBeVisible();
      expect(walletFixture("lookup", email)).toMatchObject({ walletAddress: after.walletAddress, wallets: 1 });
    } finally {
      await context.close();
      walletFixture("cleanup", email);
    }
  });

  test("Proposals & Votes creates the wallet first when sign-in couldn't", async ({ browser }) => {
    const email = throwawayEmail("proposals");
    walletFixture("create", email);
    const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
    const page = await context.newPage();
    try {
      await page.route(CREATE_WALLET, (route) => route.abort());
      await signInAs(page, email);
      expect(walletFixture("lookup", email)).toMatchObject({ walletAddress: null, wallets: 0 });

      await page.unroute(CREATE_WALLET);
      await openProposals(page);
      await expect(shown(page, "Proposals & Votes", { exact: true }).first()).toBeVisible();
      await expect(shown(page, "Start a proposal", { exact: true })).toBeVisible();

      const after = walletFixture("lookup", email);
      expect(after.walletAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(after).toMatchObject({ hasKey: true, wallets: 1 });
    } finally {
      await context.close();
      walletFixture("cleanup", email);
    }
  });

  test("the You page creates the wallet first, with a retry if that fails", async ({ browser }) => {
    const email = throwawayEmail("you");
    walletFixture("create", email);
    const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
    const page = await context.newPage();
    try {
      await page.route(CREATE_WALLET, (route) => route.abort());
      await signInAs(page, email);

      await page.getByRole("tab", { name: "You" }).click();
      await expect(shown(page, "Wallet setup failed", { exact: true })).toBeVisible();
      await expect(shown(page, `Sign Out (@${email.split("@")[0]!.replace(/[^a-z0-9]/g, "")})`)).toHaveCount(0);
      expect(walletFixture("lookup", email)).toMatchObject({ walletAddress: null, wallets: 0 });

      await page.unroute(CREATE_WALLET);
      await page.getByRole("button", { name: "Try again" }).filter({ visible: true }).click();
      await expect(shown(page, "Wallet setup failed", { exact: true })).toHaveCount(0);
      await expect(shown(page, "Wallet", { exact: true })).toBeVisible();

      const after = walletFixture("lookup", email);
      expect(after.walletAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(after).toMatchObject({ hasKey: true, wallets: 1 });
    } finally {
      await context.close();
      walletFixture("cleanup", email);
    }
  });
});
