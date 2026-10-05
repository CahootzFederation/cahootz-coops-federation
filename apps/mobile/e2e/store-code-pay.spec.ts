import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { USER_A_EMAIL, newSignedInPage } from "./support/auth";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** Visible text only: Expo Router keeps earlier screens mounted (hidden). */
function shown(page: Page, text: string | RegExp, options?: { exact?: boolean }) {
  return page.getByText(text, options).filter({ visible: true });
}

function visibleButton(page: Page, name: string | RegExp) {
  return page.getByRole("button", { name }).filter({ visible: true }).first();
}

/** Throwaway quick-pay store (apps/api/scripts/e2e-store-code.ts). */
function storeCodeFixture(args: string[]) {
  const output = execFileSync(
    "pnpm",
    ["--silent", "-F", "@cahootz/api", "exec", "tsx", "--import", "./dotenv.config.js", "scripts/e2e-store-code.ts", ...args],
    { cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000 },
  );
  const line = output
    .split("\n")
    .reverse()
    .find((entry) => entry.startsWith("E2E_RESULT "));
  if (!line) throw new Error(`Store code fixture printed no result:\n${output}`);
  return JSON.parse(line.slice("E2E_RESULT ".length));
}

/** The member's active commons, as the signed-in app stored it. */
async function activeCoopId(page: Page): Promise<string> {
  const coopId = await page.evaluate(() => {
    try {
      const raw = window.localStorage.getItem("cahootz.user");
      return raw ? (JSON.parse(raw)?.coop?.id as string | undefined) ?? null : null;
    } catch {
      return null;
    }
  });
  if (!coopId) throw new Error("Signed-in member has no active commons in local storage");
  return coopId;
}

test("member pays a store by typing its code, up to the confirm step", async ({ browser }) => {
  const member = await newSignedInPage(browser, USER_A_EMAIL);
  const { page } = member;
  const code = `E2EQP${Date.now().toString(36).slice(-6).toUpperCase()}`;
  const storeName = `E2E Quick Pay ${code}`;

  // No real money moves in this journey: fail loudly if a payment is ever sent.
  const paymentCalls: string[] = [];
  page.on("request", (request) => {
    if (/storePay\.(payByStoreCode|payRequest)/.test(request.url())) paymentCalls.push(request.url());
  });

  try {
    const coopId = await activeCoopId(page);
    storeCodeFixture(["setup", coopId, code]);

    // You -> Pay a store -> Enter Code Manually.
    await page.getByRole("tab", { name: "You" }).click();
    await shown(page, "Pay a store", { exact: true }).click();
    await expect(page).toHaveURL(/\/scan-pay$/);
    await visibleButton(page, "Enter Code Manually").click();

    // A code that doesn't exist says so on screen.
    const codeBox = page.getByLabel("Store code").filter({ visible: true });
    await codeBox.fill("E2EQPNOSUCH");
    await visibleButton(page, "Look Up Store").click();
    await expect(shown(page, "We couldn't find a store with that code. Check the code and try again.")).toBeVisible();

    // The real code works even typed in lower case.
    await codeBox.fill(code.toLowerCase());
    await expect(codeBox).toHaveValue(code);
    await visibleButton(page, "Look Up Store").click();

    await expect(page).toHaveURL(new RegExp(`/quick-pay\\?code=${code}$`));
    await expect(shown(page, `Pay ${storeName}`, { exact: true })).toBeVisible();
    await expect(shown(page, `Code: ${code}`, { exact: true })).toBeVisible();
    await expect(shown(page, "Failed to load store")).toHaveCount(0);

    // A labelled amount box with a decimal keypad, not a bare "$".
    const amountBox = page.getByLabel("Amount in dollars").filter({ visible: true });
    await expect(amountBox).toBeVisible();
    await expect(amountBox).toHaveAttribute("inputmode", "decimal");
    const payButton = visibleButton(page, /^(Pay \$|Enter an amount to pay)/);
    await expect(payButton).toHaveText("Enter an amount to pay");
    await expect(payButton).toBeDisabled();

    await amountBox.fill("3.50");
    await expect(shown(page, "Review your payment", { exact: true })).toBeVisible();
    const review = page.getByLabel(`Review: you are paying ${storeName} $3.50`).filter({ visible: true });
    await expect(review).toBeVisible();
    await expect(payButton).toHaveText("Pay $3.50");
    await expect(shown(page, /charged for the difference|add money|add funds|top up/i)).toHaveCount(0);

    // Pay opens the existing confirmation; backing out sends nothing.
    await payButton.click();
    await expect(shown(page, "Confirm Payment", { exact: true })).toBeVisible();
    await expect(shown(page, "$3.50", { exact: true }).first()).toBeVisible();
    // The shared confirm sheet (components/payment-confirmation-modal.tsx) has no button roles.
    await shown(page, "Cancel", { exact: true }).last().click();
    await expect(shown(page, "Confirm Payment", { exact: true })).toHaveCount(0);
    await expect(shown(page, "Payment Sent!", { exact: true })).toHaveCount(0);
    await expect(review).toBeVisible();

    // The store-code link still loads after a reload (the lookup carries the commons).
    await page.reload();
    await expect(shown(page, `Pay ${storeName}`, { exact: true })).toBeVisible();
    await expect(page.getByLabel("Amount in dollars").filter({ visible: true })).toBeVisible();

    expect(paymentCalls).toEqual([]);
  } finally {
    try {
      storeCodeFixture(["cleanup", code]);
    } finally {
      await member.context.close();
    }
  }
});

test("there is no Add Money anywhere in the wallet, and the old screen is gone", async ({ browser }) => {
  const member = await newSignedInPage(browser, USER_A_EMAIL);
  const { page } = member;
  const addMoney = /add money|add funds|top up your wallet|fund your wallet|cards, and funding/i;
  try {
    await page.getByRole("tab", { name: "You" }).click();
    await expect(shown(page, "Wallet", { exact: true })).toBeVisible();
    await expect(shown(page, addMoney)).toHaveCount(0);

    await shown(page, "Wallet", { exact: true }).click();
    await expect(page).toHaveURL(/\/payment-methods$/);
    await expect(shown(page, "Wallet Address", { exact: true })).toBeVisible();
    await expect(shown(page, addMoney)).toHaveCount(0);

    await page.goto("/explore");
    await expect(shown(page, "Transaction History", { exact: true })).toBeVisible();
    await expect(shown(page, addMoney)).toHaveCount(0);

    await page.goto("/fund-wallet");
    await expect(shown(page, /unmatched route|page could not be found|not found/i).first()).toBeVisible();
    await expect(shown(page, addMoney)).toHaveCount(0);
  } finally {
    await member.context.close();
  }
});
