import { expect, test } from '@playwright/test';

const publicWebUrl = process.env.E2E_PUBLIC_WEB_URL;

test('public page reveals business and funding details on request', async ({ page }) => {
  test.skip(!publicWebUrl, 'Set E2E_PUBLIC_WEB_URL to the running local public site.');
  await page.goto(new URL("/?homepage=community", publicWebUrl!).toString());
  await expect(page.locator('#waitlist')).toHaveCount(1);
  await expect(page.locator('#commons-waitlist')).toHaveCount(0);
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
