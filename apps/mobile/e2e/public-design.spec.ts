import { expect, test } from '@playwright/test';

const publicWebUrl = process.env.E2E_PUBLIC_WEB_URL;
const APP_STORE_URL = 'https://apps.apple.com/us/app/cahootz-commons/id6772781102';

test('homepage leads with the app and folds the business and savings details', async ({ page }) => {
  test.skip(!publicWebUrl, 'Set E2E_PUBLIC_WEB_URL to the running local public site.');
  await page.goto(new URL('/', publicWebUrl!).toString());
  await expect(page.locator('#waitlist')).toHaveCount(1);
  await expect(page.locator('#commons-waitlist')).toHaveCount(0);

  // The first thing people see is the street, with a way in for both kinds of visitor.
  const hero = page.locator('.street-hero');
  await expect(hero.getByRole('heading', { name: 'Your people, all on one street.' })).toBeVisible();
  const street = hero.getByRole('img', { name: /walkable street/ });
  await street.scrollIntoViewIfNeeded();
  await expect(street).toBeVisible();
  await expect(hero.getByRole('link', { name: 'Join the waitlist' })).toHaveAttribute('href', '#join');
  await expect(hero.getByRole('link', { name: 'Have an invite? Get the iPhone app' })).toHaveAttribute(
    'href',
    APP_STORE_URL,
  );

  // Each feature row pairs one real screen with one claim.
  const features = page.locator('#what-you-can-do');
  const deals = features.getByRole('heading', { name: 'Buy together. Pay less.' });
  await deals.scrollIntoViewIfNeeded();
  await expect(deals).toBeInViewport();
  await expect(page.locator('#group-deals').getByRole('img', { name: /group deal for a 2 lb bag of coffee/ })).toBeVisible();
  const sage = features.getByRole('heading', { name: 'Ask once. Sage finds who can help.' });
  await sage.scrollIntoViewIfNeeded();
  await expect(sage).toBeInViewport();
  await expect(page.locator('#sage').getByRole('img', { name: /Sage introduces/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const business = page.locator('#business-form');
  await expect(business).not.toHaveAttribute('open', '');
  await business.locator('summary').click();
  await expect(business).toHaveAttribute('open', '');
  await expect(business.getByRole('textbox').first()).toBeVisible();
  const savings = page.locator('#deal-math');
  await expect(savings).not.toHaveAttribute('open', '');
  await savings.locator('summary').click();
  await expect(savings).toHaveAttribute('open', '');
  await expect(savings.getByLabel('Total amount bought together')).toBeVisible();
  await savings.locator('summary').click();
  await expect(savings).not.toHaveAttribute('open', '');
  await expect(page.locator('.sticky-app-bar')).toHaveCount(0);
});

test('old homepage links land on the one homepage', async ({ page }) => {
  test.skip(!publicWebUrl, 'Set E2E_PUBLIC_WEB_URL to the running local public site.');
  for (const path of ['/landing', '/?homepage=group-buy', '/?homepage=community']) {
    await page.goto(new URL(path, publicWebUrl!).toString());
    expect(new URL(page.url()).pathname).toBe('/');
    await expect(page.getByRole('heading', { name: 'Your people, all on one street.' })).toBeVisible();
  }
  const cookies = await page.context().cookies();
  expect(cookies.some((cookie) => cookie.name === 'cahootz_homepage_experiment_preview')).toBe(false);
});
