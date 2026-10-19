import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { newSignedInPage, USER_A_EMAIL, USER_B_EMAIL } from './support/auth';

const API_BASE_URL = process.env.E2E_API_BASE_URL || 'http://localhost:3001';

async function sessionTokenFor(page: Page) {
  return page.evaluate(() => window.localStorage.getItem('cahootz.sessionToken'));
}

async function openNeeds(page: Page) {
  await page.goto('/board?coopId=e2e-private-shared&lane=needs');
  await expect(page.getByText('Needs & questions', { exact: true })).toBeVisible();
  await expect(page.getByText('Community board · E2E Shared Private Commons', { exact: true })).toBeVisible();
}

async function deletePost(sessionToken: string | null, postId: string | undefined) {
  if (!sessionToken || !postId) return;
  const response = await fetch(`${API_BASE_URL}/trpc/commons.deletePost`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-session-token': sessionToken,
    },
    body: JSON.stringify({ postId }),
  });
  expect(response.ok).toBe(true);
}

test('Board has no Commons switcher and keeps its source after reload', async ({ browser }) => {
  const member = await newSignedInPage(browser, USER_A_EMAIL);
  try {
    await member.page.goto('/board?coopId=e2e-market');
    await expect(member.page.getByText('Community board · E2E Market Commons', { exact: true })).toBeVisible();
    await expect(member.page.getByRole('button', { name: /^Board / })).toHaveCount(0);
    await member.page.reload();
    await expect(member.page.getByText('Community board · E2E Market Commons', { exact: true })).toBeVisible();
    await expect(member.page.getByRole('button', { name: /^Board / })).toHaveCount(0);
    await member.page.getByLabel('Open Needs & questions').click();
    await expect(member.page.getByText('Needs & questions', { exact: true })).toBeVisible();
    await expect(member.page.getByRole('button', { name: /^Board / })).toHaveCount(0);
  } finally {
    await member.context.close();
  }
});

test('the board only lists its selected existing community features', { tag: '@smoke' }, async ({ browser }) => {
  const member = await newSignedInPage(browser, USER_A_EMAIL);

  try {
    await member.page.goto('/board?coopId=cahootz');
    await expect(member.page.getByText('Find your way around', { exact: true })).toBeVisible();
    await expect(member.page.getByText('Browse the board', { exact: true })).toBeVisible();
    await expect(member.page.getByLabel('Open All board posts')).toBeVisible();
    await expect(member.page.getByLabel('Open Needs & questions')).toBeVisible();
    await expect(member.page.getByLabel('Open Offers')).toBeVisible();
    await expect(member.page.getByLabel('Open Events')).toBeVisible();
    await expect(member.page.getByLabel('Open Members')).toHaveCount(0);
    await expect(member.page.getByLabel('Open Circles')).toHaveCount(0);
    await expect(member.page.getByText('Community exchange', { exact: true })).toBeVisible();
    await expect(member.page.getByLabel('Open Marketplace')).toBeVisible();
    await expect(member.page.getByLabel('Marketplace preview')).toBeVisible();
    await expect(member.page.getByText('From member shops', { exact: true })).toBeVisible();
    await expect(member.page.getByLabel('View Seed Supporter')).toBeVisible();
    await expect(member.page.getByLabel('Open Verified resources')).toBeVisible();
    await expect(member.page.getByLabel('Open Proposals & votes')).toHaveCount(0);
    await expect(member.page.getByLabel('Open Projects & working groups')).toHaveCount(0);
    await expect(member.page.getByLabel('Open Notices & local news')).toHaveCount(0);
    await expect(member.page.getByLabel('Open Decisions & governance')).toHaveCount(0);

    await member.page.getByLabel('Add to board').click();
    await expect(member.page.getByLabel('Raise a proposal')).toHaveCount(0);
    await expect(member.page.getByLabel('Sell through a shop')).toHaveCount(0);
    await member.page.getByLabel('Close board composer').click();

    await member.page.getByLabel('Open Verified resources').click();
    await expect(member.page).toHaveURL(/\/commons-resources\?coopId=cahootz/);
    await expect(member.page.getByText('Commons resources', { exact: true })).toBeVisible();
    await member.page.goto('/board?coopId=cahootz');
    await expect(member.page.getByText('Find your way around', { exact: true })).toBeVisible();

    await member.page.getByLabel('View Seed Supporter').click();
    await expect(member.page).toHaveURL(/\/product-detail\?id=/);
    await expect(member.page.getByText('Availability', { exact: true })).toBeVisible();
    await expect(member.page.getByText('Delivery', { exact: true })).toBeVisible();
    await member.page.goBack();
    await expect(member.page.getByText('Find your way around', { exact: true })).toBeVisible();

    await member.page.getByLabel('See all marketplace products').click();
    await expect(member.page.getByText('Shop together', { exact: true })).toBeVisible();
    await expect(member.page.getByLabel('Open a shop')).toBeVisible();
    await expect(member.page.getByLabel('Add Seed Supporter to cart')).toBeVisible();
    await member.page.getByLabel('Open a shop').click();
    await expect(member.page).toHaveURL(/apply-store/);
    await member.page.goBack();
    await expect(member.page.getByText('Shop together', { exact: true })).toBeVisible();
  } finally {
    await member.context.close();
  }
});

test('two members use the existing Ask and comment workflow through the board', { tag: '@smoke' }, async ({ browser }) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const title = `E2E garden cart ${runId}`;
  const details = `E2E ${runId}: Can someone lend a garden cart for Saturday?`;
  const reply = `E2E ${runId}: I can bring mine at nine.`;
  const memberA = await newSignedInPage(browser, USER_A_EMAIL);
  const memberB = await newSignedInPage(browser, USER_B_EMAIL);
  let postId: string | undefined;

  try {
    await openNeeds(memberA.page);
    await memberA.page.getByLabel('Add to board').click();
    await memberA.page.getByLabel('Ask for help').click();
    await memberA.page.getByLabel('Board item title').fill(title);
    await memberA.page.getByLabel('Board item details').fill(details);
    const saved = memberA.page.waitForResponse((response) => response.url().includes('/trpc/commons.createPost') && response.ok());
    await memberA.page.getByLabel('Publish board item').click();
    const body = await (await saved).json();
    postId = body?.result?.data?.post?.id;
    await expect(memberA.page.getByText(title, { exact: true })).toBeVisible();

    await openNeeds(memberB.page);
    await memberB.page.getByLabel('Search community board').fill(title);
    await expect(memberB.page.getByText(title, { exact: true })).toBeVisible();
    await memberB.page.getByLabel(`Open ${title}`).click();
    await expect(memberB.page).toHaveURL(/\/posts\/[^/]+$/);
    await expect(memberB.page.getByRole('heading', { name: title })).toBeVisible();
    await expect(memberB.page.getByText('Ask', { exact: true }).last()).toBeVisible();
    await memberB.page.getByPlaceholder('Write a comment...').fill(reply);
    await memberB.page.getByLabel('Send comment').click();
    await expect(memberB.page.getByText(reply, { exact: true }).last()).toBeVisible();

    await memberA.page.reload();
    await expect(memberA.page.getByText(title, { exact: true })).toBeVisible();
    await memberA.page.getByLabel(`Open ${title}`).click();
    await expect(memberA.page.getByText(reply, { exact: true }).last()).toBeVisible();
  } finally {
    if (postId) {
      const token = await sessionTokenFor(memberA.page).catch(() => null);
      if (token) {
        await deletePost(token, postId).catch(() => {});
      }
    }
    await memberA.context.close();
    await memberB.context.close();
  }
});

test('a Board event opens the full event detail screen', { tag: '@smoke' }, async ({ browser }) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const title = `E2E Board seed swap ${runId}`;
  const member = await newSignedInPage(browser, USER_A_EMAIL);
  let eventId: string | undefined;
  let postId: string | undefined;

  try {
    await member.page.goto('/board?coopId=cahootz');
    await member.page.getByLabel('Quick post Event').click();
    await expect(member.page.getByText('Create event', { exact: true })).toBeVisible();

    const startsAt = new Date(Date.now() + 60 * 60 * 1000);
    await member.page.getByPlaceholder('New member welcome').fill(title);
    await member.page.getByLabel('Date', { exact: true }).fill(startsAt.toISOString().slice(0, 10));
    await member.page.getByLabel('Start time', { exact: true }).fill(
      `${String(startsAt.getHours()).padStart(2, '0')}:${String(startsAt.getMinutes()).padStart(2, '0')}`,
    );
    await member.page.getByLabel('Publish event').click();
    await expect(member.page).not.toHaveURL(/\/events\/create$/);
    await expect(member.page).toHaveURL(/\/events\/[^/]+$/, { timeout: 20000 });
    eventId = new URL(member.page.url()).pathname.split('/').pop();

    await member.page.goto('/board?coopId=cahootz&lane=events');
    await expect(member.page.getByText(title, { exact: true })).toBeVisible({ timeout: 20000 });
    await member.page.getByLabel(`Open ${title}`).click();
    await expect(member.page).toHaveURL(new RegExp(`/events/${eventId}$`));
    await expect(member.page.getByText(title, { exact: true }).last()).toBeVisible();
    await expect(member.page.getByText(/^Going \(/).first()).toBeVisible();
    await expect(member.page.getByText('Add to calendar', { exact: true })).toBeVisible();
  } finally {
    const token = await sessionTokenFor(member.page).catch(() => null);
    if (token && eventId) {
      const input = encodeURIComponent(JSON.stringify({ eventId }));
      const detail = await fetch(`${API_BASE_URL}/trpc/events.get?input=${input}`).then((response) => response.json());
      postId = detail?.result?.data?.post?.id;
      await deletePost(token, postId).catch(() => {});
    }
    await member.context.close();
  }
});
