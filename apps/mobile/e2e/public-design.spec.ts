import { expect, test } from '@playwright/test';

const publicWebUrl = process.env.E2E_PUBLIC_WEB_URL;

test('public page reveals business and funding details on request', async ({ page }) => {
  test.skip(!publicWebUrl, 'Set E2E_PUBLIC_WEB_URL to the running local public site.');
  await page.goto(new URL("/?homepage=community", publicWebUrl!).toString());
  await expect(page.locator('#waitlist')).toHaveCount(1);
  await expect(page.locator('#commons-waitlist')).toHaveCount(0);
  // The page says what's live in the app today, and invited people can get the app.
  // The header links are hidden at phone width, so scroll to the section.
  const inside = page.locator('#inside');
  await inside.scrollIntoViewIfNeeded();
  await expect(inside.getByRole('heading', { name: 'What you can do today.' })).toBeInViewport();
  await expect(inside.getByText('Buy together, pay less.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Have an invite? Get the iPhone app' })).toHaveAttribute(
    'href',
    'https://apps.apple.com/us/app/cahootz-commons/id6772781102',
  );
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
