import { expect, test, type Page } from '@playwright/test';
import { USER_A_EMAIL } from './support/auth';

async function login(page: Page) {
  await page.goto('/?entry=sign-in');
  await page.getByPlaceholder('name@email.com').fill(USER_A_EMAIL);
  await page.getByRole('button', { name: 'Continue with email' }).click();
  await page.getByPlaceholder('Enter 6-digit code').fill(process.env.E2E_LOGIN_CODE || '000000');
  await page.getByRole('button', { name: 'Verify and continue' }).click();
  await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible();
}
const api = process.env.E2E_API_BASE_URL || 'http://localhost:3001';

test('circle design preserves management, switching, search and wrapping names', async ({ page }) => {
  await login(page);
  const token = await page.evaluate(() => localStorage.getItem('cahootz.sessionToken'));
  const name = `E2E Design circle with a deliberately long readable name ${Date.now()}`;
  let id: string | undefined;
  const headers = { 'content-type': 'application/json', 'x-session-token': token! };
  try {
    const created = await fetch(`${api}/trpc/groups.create`, { method: 'POST', headers, body: JSON.stringify({ name, privacy: 'public', iconEmoji: '🌻' }) }).then(r => r.json());
    id = created.result?.data?.group?.id;
    expect(id).toBeTruthy();
    await page.reload();
    await expect(page.getByText('Your circles', { exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: 'Find a circle' }).fill(name);
    const card = page.getByRole('button').filter({ hasText: name });
    await expect(card).toBeVisible();
    for (const width of [320, 375, 414, 768]) {
      await page.setViewportSize({ width, height: 900 });
      const label = card.getByText(name, { exact: true });
      expect(await label.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      expect(await label.evaluate(el => getComputedStyle(el).whiteSpace)).not.toBe('nowrap');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.getByRole('button', { name: 'Manage circles' })).toBeVisible();
    }
    await page.getByRole('textbox', { name: 'Find a circle' }).fill('no-circle-matches-this');
    await expect(page.getByText('No circles match your search.')).toBeVisible();
    await page.getByRole('textbox', { name: 'Find a circle' }).fill('');
    await page.getByRole('button', { name: 'Manage circles' }).click();
    await expect(page).toHaveURL(/spaces/);
    await page.goBack();
    await page.getByLabel(/Switch commons. Currently/).click();
    await expect(page.getByText('Explore all commons', { exact: true })).toBeVisible();
    await page.getByLabel('Close commons switcher').last().click();
    await page.getByRole('button', { name: 'Open menu' }).click();
    await expect(page.getByText(/Sign Out \(@/)).toBeVisible();
    await page.getByLabel('Close menu').click();
    await page.getByRole('textbox', { name: 'Find a circle' }).fill(name);
    await card.click();
    await expect(page).toHaveURL(/posts/);
    await expect(page.getByRole('tab', { name: 'Commons', exact: true })).toHaveAttribute('aria-selected', 'true');
  } finally {
    if (id) await fetch(`${api}/trpc/groups.leave`, { method: 'POST', headers, body: JSON.stringify({ groupId: id }) });
  }
});

test('Wallet and product detail retain parent tabs and shopping controls', async ({ page }) => {
  await login(page);
  await page.getByRole('tab', { name: 'You', exact: true }).click();
  await page.getByRole('button', { name: 'Wallet', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'You', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Export Wallet', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to You' }).click();
  await expect(page).toHaveURL(/wallet/);
  await page.getByRole('tab', { name: 'Board', exact: true }).click();
  await page.goto('/board?coopId=cahootz');
  await page.getByRole('button', { name: 'Open Marketplace' }).click();
  await page.getByLabel('View Seed Supporter', { exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Board', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('product-icon-fallback')).toBeVisible();
  expect((await page.getByTestId('product-media').boundingBox())!.height).toBeLessThan(120);
  await page.getByRole('button', { name: 'Increase quantity' }).click();
  await expect(page.getByText('$100.00', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Decrease quantity' }).click();
  await expect(page.getByRole('button', { name: 'Buy Now', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Shopping cart' }).click();
  await expect(page).toHaveURL(/cart/);
  await expect(page.getByRole('tab', { name: 'Board', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('notification settings offers recovery and reloads real preferences', async ({ page }) => {
  await login(page);
  const match = '**/trpc/notification.getPreferences*';
  await page.route(match, async route => {
    if (route.request().method() === 'OPTIONS') return route.continue();
    const response = await route.fetch();
    await route.fulfill({ response, status: 500, contentType: 'application/json', body: JSON.stringify({ error: { message: 'E2E internal failure', code: -32603, data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 } } }) });
  });
  await page.getByRole('tab', { name: 'Alerts', exact: true }).click();
  await page.getByRole('button', { name: 'Notification settings', exact: true }).click();
  await expect(page.getByText('Settings couldn’t load', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Return to Alerts' })).toBeVisible();
  await expect(page.getByText('E2E internal failure')).toHaveCount(0);
  await page.unroute(match);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Push notifications', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('switch', { name: 'Push notifications', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to Alerts' }).click();
  await expect(page).toHaveURL(/notifications/);
});
