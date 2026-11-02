import { expect, test } from '@playwright/test';
import { newSignedInPage, USER_A_EMAIL } from './support/auth';

test('tabs keep the selected Commons through account navigation and reload', async ({ browser }) => {
  const member = await newSignedInPage(browser, USER_A_EMAIL);
  const page = member.page;
  try {
    await page.goto('/?coopId=e2e-private-shared');
    await expect(page.getByRole('tab', { name: 'Board', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Board', exact: true }).click();
    await expect(page.getByText('Community board · E2E Shared Private Commons', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'You', exact: true }).click();
    await page.reload();
    await page.getByRole('button', { name: 'Community Board', exact: true }).click();
    await expect(page.getByText('Community board · E2E Shared Private Commons', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Commons', exact: true }).click();
    await expect(page).toHaveURL(/coopId=e2e-private-shared/);
    await expect(page.getByText('General', { exact: true }).first()).toBeVisible();
  } finally {
    await member.context.close();
  }
});

test('welcome cards stay still and can be changed with comfortable controls', async ({ page }) => {
  await page.goto('/');
  const first = page.getByRole('button', { name: 'Show Post on your community feeds', exact: true });
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  // This is the behavior under test: the previous welcome advanced every 4.5 seconds.
  await page.waitForTimeout(5000);
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  const next = page.getByRole('button', { name: 'Show Join commons', exact: true });
  const bounds = await next.boundingBox();
  expect(bounds?.width).toBeGreaterThanOrEqual(44);
  expect(bounds?.height).toBeGreaterThanOrEqual(44);
  await next.click();
  await expect(next).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByPlaceholder('name@email.com')).toBeVisible();
});


test('account Alerts keeps the originating Commons after returning and reloading', async ({ browser }) => {
  const member = await newSignedInPage(browser, USER_A_EMAIL);
  const { page } = member;
  try {
    await page.goto('/board?coopId=e2e-private-shared');
    const heading = page.getByText('Community board · E2E Shared Private Commons', { exact: true });
    await expect(heading).toBeVisible();
    await page.getByRole('tab', { name: 'You', exact: true }).click();
    await page.getByRole('button', { name: 'Alerts', exact: true }).click();
    await page.getByRole('tab', { name: 'Board', exact: true }).click();
    await page.reload();
    await expect(heading).toBeVisible();
    await expect(page).toHaveURL(/coopId=e2e-private-shared/);
  } finally { await member.context.close(); }
});

test('proposal feedback is visible on a phone and keeps unfinished answers', async ({ browser }) => {
  const member = await newSignedInPage(browser, USER_A_EMAIL);
  const { page } = member;
  let submissions = 0;
  await page.route('**/trpc/proposal.create**', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.continue();
    submissions += 1;
    await route.abort();
  });
  try {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/proposals?coopId=cahootz');
    await page.getByText('Start a proposal', { exact: true }).click();
    const idea = page.getByLabel('What do you want to do?', { exact: true });
    await page.getByRole('button', { name: 'Send proposal', exact: true }).click();
    await expect(page.getByRole('alert')).toBeInViewport({ ratio: 1 });
    await expect(idea).toBeFocused();
    await idea.fill('E2E unfinished garden proposal');
    await page.getByRole('button', { name: 'Send proposal', exact: true }).click();
    await expect(page.getByRole('alert')).toBeInViewport({ ratio: 1 });
    await expect(idea).toHaveValue('E2E unfinished garden proposal');
    expect(submissions).toBe(0);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
  } finally { await member.context.close(); }
});
