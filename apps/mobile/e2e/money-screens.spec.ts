import { expect, test, type Page } from '@playwright/test';
import { newSignedInPage, USER_A_EMAIL } from './support/auth';

// Expo Router keeps earlier screens mounted (hidden) on web, so text lookups
// are limited to what's actually on screen.
function shown(page: Page, text: string | RegExp, options?: { exact?: boolean }) {
  return page.getByText(text, options).filter({ visible: true });
}

// What a server-side crash looks like when it leaks into a tRPC error.
const RAW_SERVER_ERROR =
  'Invalid `prisma.p2PTransfer.findMany()` invocation: Error querying the database at /app/node_modules/@prisma/client/runtime/library.js:121';

const HISTORY_FALLBACK = "We couldn't load your transactions. Please try again.";

/** Opens Transaction History the way the app links to it (from the wallet hub). */
async function openHistory(page: Page) {
  await page.goto('/explore');
  await shown(page, 'Transaction History', { exact: true }).click();
  await expect(page).toHaveURL(/\/history$/);
  await expect(shown(page, 'Your recent transactions', { exact: true })).toBeVisible();
}

/** Either the empty state or at least one transaction row (a signed amount). */
function historyLoaded(page: Page) {
  return shown(page, 'No transactions yet', { exact: true }).or(shown(page, /^[+-]\$\d/)).first();
}

test('transaction history has no Send Money, and the old send-money screens are gone', async ({ browser }) => {
  const member = await newSignedInPage(browser, USER_A_EMAIL);
  const { page } = member;
  try {
    await openHistory(page);
    await expect(historyLoaded(page)).toBeVisible();
    await expect(shown(page, /send money/i)).toHaveCount(0);
    await expect(shown(page, /send or receive money/i)).toHaveCount(0);

    // The person-to-person Send Money screen and the hidden transfer tab were removed.
    for (const oldRoute of ['/pay', '/transfer']) {
      await page.goto(oldRoute);
      await expect(shown(page, /unmatched route|page could not be found|not found/i).first()).toBeVisible();
      await expect(shown(page, /send money/i)).toHaveCount(0);
      await expect(shown(page, /phone number or username/i)).toHaveCount(0);
    }
  } finally {
    await member.context.close();
  }
});

test('a failed history load says so in plain words, and Try again recovers', async ({ browser }) => {
  const member = await newSignedInPage(browser, USER_A_EMAIL);
  const { page } = member;
  const historyRoute = '**/trpc/p2p.getHistory**';
  try {
    await page.route(historyRoute, (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            message: RAW_SERVER_ERROR,
            code: -32603,
            data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500, path: 'p2p.getHistory' },
          },
        }),
      }),
    );

    await openHistory(page);

    await expect(shown(page, "Your history didn't load", { exact: true })).toBeVisible();
    await expect(shown(page, HISTORY_FALLBACK, { exact: true })).toBeVisible();
    // A failed load must never look like an empty history, or leak server text.
    await expect(shown(page, 'No transactions yet', { exact: true })).toHaveCount(0);
    await expect(shown(page, /prisma|invocation|INTERNAL_SERVER_ERROR|node_modules/i)).toHaveCount(0);

    const tryAgain = page.getByRole('button', { name: 'Try again' }).filter({ visible: true });
    await expect(tryAgain).toBeVisible();
    const box = await tryAgain.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

    // Once the server is healthy again, Try again loads the real history.
    await page.unroute(historyRoute);
    await tryAgain.click();
    await expect(historyLoaded(page)).toBeVisible();
    await expect(shown(page, "Your history didn't load", { exact: true })).toHaveCount(0);
    await expect(shown(page, HISTORY_FALLBACK, { exact: true })).toHaveCount(0);

    // And it stays loaded after a reload.
    await page.reload();
    await expect(shown(page, 'Your recent transactions', { exact: true })).toBeVisible();
    await expect(historyLoaded(page)).toBeVisible();
    await expect(shown(page, "Your history didn't load", { exact: true })).toHaveCount(0);
  } finally {
    await member.context.close();
  }
});

test("the wallet names the commons' own coin from platform config", async ({ browser }) => {
  const member = await newSignedInPage(browser, USER_A_EMAIL);
  const { page } = member;
  const configRoute = '**/trpc/platformConfig.getConfig**';
  const coinName = `E2E Ripple Coin ${Date.now().toString(36)}`;
  try {
    // Each commons names its own coin. Serve a distinctive name so the
    // assertion proves the screen reads config instead of a hardcoded name.
    await page.route(configRoute, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          result: {
            data: {
              coin: { symbol: 'ERC', name: coinName, description: `${coinName} (ERC) is an E2E test coin.` },
              platformName: 'Cahootz',
            },
          },
        }),
      }),
    );
    await page.reload();
    await expect(page.getByLabel('Open menu')).toBeVisible();

    await page.getByRole('tab', { name: 'You' }).click();
    await expect(shown(page, `${coinName} balance, wallet address, and saved cards`, { exact: true })).toBeVisible();
    await expect(shown(page, /SC balance/)).toHaveCount(0);

    await shown(page, 'Wallet', { exact: true }).click();
    await expect(page).toHaveURL(/\/payment-methods$/);
    await expect(shown(page, new RegExp(`^${coinName} balance$`, 'i'))).toBeVisible();
    await expect(shown(page, /soulaani/i)).toHaveCount(0);
  } finally {
    await page.unroute(configRoute).catch(() => undefined);
    await member.context.close();
  }
});
