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

function runFixture(script: string, args: string[]) {
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

/** The short reference the app shows: last 8 id characters, "XXXX-XXXX". */
function shortReference(id: string) {
  const tail = id.replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase();
  return `${tail.slice(0, 4)}-${tail.slice(4)}`;
}

/** The receipt's date, formatted in the browser's own time zone. */
function receiptDate(page: Page, iso: string) {
  return page.evaluate(
    (value) => new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    iso,
  );
}

function receiptRow(page: Page, label: string, value: string | RegExp) {
  const pattern =
    typeof value === "string"
      ? new RegExp(`^${label}: ${value.replace(/[.*+?^${}()|[\]\\$]/g, "\\$&")}$`)
      : new RegExp(`^${label}: ${value.source}$`);
  return page.getByLabel(pattern).filter({ visible: true }).first();
}

test("a past payment opens a receipt from History, and the receipt survives a reload", async ({ browser }) => {
  const member = await newSignedInPage(browser, USER_A_EMAIL);
  const { page } = member;
  const runId = `r${Date.now().toString(36)}`;
  let fixtureCreated = false;

  try {
    const coopId = await activeCoopId(page);
    // A completed store payment row only: no money moves.
    const payment = runFixture("e2e-receipts.ts", ["setup", coopId, runId]);
    fixtureCreated = true;
    const reference = shortReference(payment.id);
    const date = await receiptDate(page, payment.createdAt);

    // You -> Your payments.
    await page.getByRole("tab", { name: "You" }).click();
    const paymentsEntry = visibleButton(page, "Your payments");
    await expect(paymentsEntry).toBeVisible();
    expect((await paymentsEntry.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await paymentsEntry.click();
    await expect(page).toHaveURL(/\/history$/);
    await expect(shown(page, "Tap a payment to see its receipt.", { exact: true })).toBeVisible();

    // The row is a labelled button at least 44pt tall.
    const row = page
      .getByRole("button", { name: /^Paid \$12\.34 to .+Opens the receipt\.$/ })
      .filter({ visible: true })
      .filter({ hasText: payment.note })
      .first();
    await expect(row).toBeVisible();
    expect((await row.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await row.click();

    await expect(page).toHaveURL(new RegExp(`/receipt\\?id=${payment.id}$`));
    const checkReceipt = async () => {
      await expect(shown(page, "Receipt", { exact: true })).toBeVisible();
      await expect(shown(page, `Paid to ${payment.storeName}`, { exact: true })).toBeVisible();
      await expect(receiptRow(page, "Store", payment.storeName)).toBeVisible();
      if (payment.recipientName) {
        await expect(receiptRow(page, "To", payment.recipientName)).toBeVisible();
      } else {
        await expect(receiptRow(page, "To", /.+/)).toBeVisible();
      }
      await expect(receiptRow(page, "Amount", "$12.34")).toBeVisible();
      await expect(receiptRow(page, "Fee", "$0.00")).toBeVisible();
      await expect(receiptRow(page, "Date and time", new RegExp(`${date.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} at 2:30 PM`))).toBeVisible();
      await expect(receiptRow(page, "Status", "Paid")).toBeVisible();
      await expect(receiptRow(page, "Reference", reference)).toBeVisible();
      await expect(shown(page, reference, { exact: true })).toBeVisible();
      await expect(shown(page, /couldn't|didn't load/i)).toHaveCount(0);
    };
    await checkReceipt();

    // Still there after a reload (the receipt loads from its link).
    await page.reload();
    await checkReceipt();

    // Done goes back.
    const done = visibleButton(page, "Done");
    expect((await done.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  } finally {
    try {
      if (fixtureCreated) {
        const result = runFixture("e2e-receipts.ts", ["cleanup", runId]);
        expect(result.deleted).toBe(1);
      }
    } finally {
      await member.context.close();
    }
  }
});

// The server answers NOT_FOUND both for a missing payment and for one the
// member wasn't part of (unit-tested in packages/trpc p2p-receipts.test.ts).
test("a receipt link for a payment that isn't yours shows a plain not-found message", async ({ browser }) => {
  const member = await newSignedInPage(browser, USER_A_EMAIL);
  const { page } = member;
  try {
    await page.goto("/receipt?id=e2e-not-a-real-payment");
    await expect(shown(page, "We couldn't find this payment.", { exact: true })).toBeVisible();
    await expect(shown(page, /NOT_FOUND|trpc|prisma/i)).toHaveCount(0);
    await expect(visibleButton(page, "Go back to your payments")).toBeVisible();
  } finally {
    await member.context.close();
  }
});

test("after paying a store, the member sees a receipt with a way to History", async ({ browser }) => {
  const member = await newSignedInPage(browser, USER_A_EMAIL);
  const { page } = member;
  const code = `E2EQP${Date.now().toString(36).slice(-6).toUpperCase()}`;
  const storeName = `E2E Quick Pay ${code}`;
  const transferId = `cme2ereceipt${Date.now().toString(36)}`;
  const paidAt = new Date().toISOString();
  let storeCreated = false;

  // The local database has no coin configured, so a real payment can't settle.
  // Answer the pay call with the server's success shape instead; no money moves.
  const payCalls: string[] = [];
  await page.route("**/trpc/storePay.payByStoreCode**", (route) => {
    payCalls.push(route.request().postData() ?? "");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: {
          data: {
            success: true,
            transferId,
            message: `Paid $4.75 to ${storeName}`,
            storeName,
            amount: 4.75,
            fee: 0,
            paidAt,
          },
        },
      }),
    });
  });

  try {
    const coopId = await activeCoopId(page);
    runFixture("e2e-store-code.ts", ["setup", coopId, code]);
    storeCreated = true;

    await page.goto(`/quick-pay?code=${code}`);
    await expect(shown(page, `Pay ${storeName}`, { exact: true })).toBeVisible();
    await page.getByLabel("Amount in dollars").filter({ visible: true }).fill("4.75");
    await visibleButton(page, "Pay $4.75").click();

    // The shared confirm sheet (components/payment-confirmation-modal.tsx) has no button roles.
    await expect(shown(page, "Confirm Payment", { exact: true })).toBeVisible();
    await shown(page, "Confirm", { exact: true }).last().click();

    await expect(shown(page, "Payment Sent!", { exact: true })).toBeVisible();
    expect(payCalls).toHaveLength(1);
    expect(JSON.parse(payCalls[0])).toMatchObject({ storeCode: code, amount: 4.75 });

    const date = await receiptDate(page, paidAt);
    await expect(receiptRow(page, "Store", storeName)).toBeVisible();
    await expect(receiptRow(page, "Amount", "$4.75")).toBeVisible();
    await expect(receiptRow(page, "Fee", "$0.00")).toBeVisible();
    await expect(receiptRow(page, "Date and time", new RegExp(`${date.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} at .+`))).toBeVisible();
    await expect(receiptRow(page, "Reference", shortReference(transferId))).toBeVisible();

    const done = visibleButton(page, "Done");
    const toHistory = visibleButton(page, "View in History");
    expect((await done.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect((await toHistory.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

    await toHistory.click();
    await expect(page).toHaveURL(/\/history$/);
    await expect(shown(page, "Your recent transactions", { exact: true })).toBeVisible();
  } finally {
    try {
      if (storeCreated) runFixture("e2e-store-code.ts", ["cleanup", code]);
    } finally {
      await member.context.close();
    }
  }
});
