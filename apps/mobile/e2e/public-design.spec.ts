import { expect, test } from '@playwright/test';

const publicWebUrl = process.env.E2E_PUBLIC_WEB_URL;

test('public page reveals business and funding details on request', async ({ page }) => {
  test.skip(!publicWebUrl, 'Set E2E_PUBLIC_WEB_URL to the running local public site.');
  await page.goto(publicWebUrl!);
  const business = page.locator('#business-form');
  await expect(business).not.toHaveAttribute('open', '');
  await business.locator('summary').click();
  await expect(business).toHaveAttribute('open', '');
  await expect(business.getByRole('textbox').first()).toBeVisible();
  const funding = page.locator('.treasury-disclosure');
  await expect(funding).not.toHaveAttribute('open', '');
  await funding.locator('summary').click();
  await expect(funding).toHaveAttribute('open', '');
  await expect(funding.locator('input').first()).toBeVisible();
  await funding.locator('summary').click();
  await expect(funding).not.toHaveAttribute('open', '');
  await expect(page.locator('.sticky-app-bar')).toHaveCount(0);
});

test('an unavailable application list offers retry instead of continuing', async ({ page }) => {
  test.skip(!publicWebUrl, 'Set E2E_PUBLIC_WEB_URL to the running local public site.');
  let attempts = 0;
  // Simulate loss of connectivity, not an invented API response.
  await page.route('**/coopConfig.listAvailableCoops*', async (route) => {
    attempts += 1;
    await route.abort('failed');
  });
  await page.goto(publicWebUrl!);
  await expect(page.getByText('We couldn’t load the commons', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
  const beforeRetry = attempts;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect.poll(() => attempts).toBeGreaterThan(beforeRetry);
  await expect(page.getByText('We couldn’t load the commons', { exact: true })).toBeVisible();
});
