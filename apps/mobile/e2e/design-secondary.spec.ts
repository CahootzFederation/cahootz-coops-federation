import { expect, test } from '@playwright/test';
import { newSignedInPage, USER_A_EMAIL } from './support/auth';

test('directory search recovers from no results and preserves membership actions', async ({ browser }) => {
  const { page, context } = await newSignedInPage(browser, USER_A_EMAIL);
  try {
    await page.goto('/commons');
    await expect(page.getByText('Your commons', { exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: 'Search commons' }).fill('E2E no matching commons 938472');
    await expect(page.getByText('No commons found', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(page.getByRole('button', { name: 'Start a family', exact: true })).toBeVisible();
    for (const width of [320, 375, 414, 768]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.getByRole('button', { name: 'Open E2E Market Commons circles', exact: true }).click();
    await expect(page).toHaveURL(/coopId=e2e-market/);
  } finally { await context.close(); }
});

test('Sage settings recovers from failure and keeps its explanation available', async ({ browser }) => {
  const { page, context } = await newSignedInPage(browser, USER_A_EMAIL);
  const path = '**/trpc/sage.trailSettings*';
  try {
    await page.route(path, async route => {
      if (route.request().method() === 'OPTIONS') return route.continue();
      const response = await route.fetch();
      await route.fulfill({ response, status: 500, body: JSON.stringify({ error: { message: 'E2E failure' } }) });
    });
    await page.goto('/sage-settings');
    await expect(page.getByText('Sage settings couldn’t load')).toBeVisible();
    await expect(page.getByRole('switch')).toHaveCount(0);
    await page.unroute(path);
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('switch', { name: 'Show how Sage decides' })).toBeVisible();
    await expect(page.getByText('What Sage remembers', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'How Sage works', exact: true }).click();
    await expect(page.getByText('What Sage remembers', { exact: true })).toBeVisible();
    await expect(page.getByText('What always waits for a person', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Hide how Sage works' }).click();
    await page.reload();
    await expect(page.getByRole('switch', { name: 'Show how Sage decides' })).toBeVisible();
    for (const width of [320, 375, 414, 768]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  } finally { await context.close(); }
});

test('Alerts keeps category controls and clears empty filters', async ({ browser }) => {
  const { page, context } = await newSignedInPage(browser, USER_A_EMAIL);
  try {
    // A deterministic empty response exercises the real filter controls.
    await page.route('**/trpc/notification.getNotifications*', async route => {
      if (route.request().method() === 'OPTIONS') return route.continue();
      const response = await route.fetch();
      const body = await response.json();
      body.result.data.notifications = [];
      body.result.data.nextCursor = null;
      await route.fulfill({ response, json: body });
    });
    await page.getByRole('tab', { name: 'Alerts', exact: true }).click();
    await page.getByRole('button', { name: 'Payments', exact: true }).click();
    await expect(page.getByText('No matching alerts')).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('No alerts yet')).toBeVisible();
    await page.getByRole('button', { name: 'Show unread only' }).click();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    for (const width of [320, 375, 414, 768]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.getByRole('button', { name: 'Notification settings' }).click();
    await expect(page.getByRole('switch', { name: 'Push notifications', exact: true })).toBeVisible();
  } finally { await context.close(); }
});

test('event form retains optional controls and fits narrow screens', async ({ browser }) => {
  const { page, context } = await newSignedInPage(browser, USER_A_EMAIL);
  try {
    await page.goto('/cahootz/events/create');
    await page.getByLabel('Event name', { exact: true }).fill('E2E unsaved form layout');
    await page.getByRole('button', { name: 'Weekly', exact: true }).click();
    await page.getByLabel('Repeat interval').fill('2');
    await page.getByLabel('Number of occurrences').fill('4');
    await page.getByRole('button', { name: 'In person', exact: true }).click();
    await page.getByLabel('Address', { exact: true }).fill('E2E local test venue');
    await page.getByLabel('Description', { exact: true }).fill('E2E unsaved form test');
    for (const width of [320, 375, 414, 768]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.getByLabel('Event name', { exact: true })).toHaveValue('E2E unsaved form layout');
      await expect(page.getByRole('button', { name: 'Publish event' })).toBeEnabled();
    }
    await page.getByRole('button', { name: 'Online', exact: true }).click();
    await expect(page.getByLabel('Meeting link')).toBeVisible();
    await page.getByRole('button', { name: 'Go back' }).click();
    await expect(page).not.toHaveURL(/events\/create/);
  } finally { await context.close(); }
});
