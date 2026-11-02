import { expect, test, type Page } from '@playwright/test';

import { newSignedInPage, USER_A_EMAIL } from './support/auth';

async function openGeneralFeed(page: Page, coopId: string, commonsName: string) {
  await page.goto(`/?coopId=${coopId}`);
  await expect(
    page
      .getByLabel(`Switch commons. Currently ${commonsName}`, { exact: true })
      .filter({ visible: true }),
  ).toBeVisible();
  await page.getByText('General', { exact: true }).filter({ visible: true }).click();
  const composer = page.getByRole('textbox', {
    name: "Share what's happening...",
  });
  await expect(composer).toBeVisible();
  return composer;
}

async function typeMention(page: Page, value: string) {
  const composer = page.getByRole('textbox', {
    name: "Share what's happening...",
  });
  await composer.fill('');
  await composer.click();
  const response = page.waitForResponse(
    (candidate) =>
      candidate.url().includes('/trpc/commons.listMentionMembers') &&
      candidate.request().method() === 'GET',
  );
  await composer.pressSequentially(value);
  expect((await response).ok()).toBe(true);
}

test('mention suggestions stay inside the selected Commons', async ({ browser }) => {
  const member = await newSignedInPage(browser, USER_A_EMAIL);

  try {
    await openGeneralFeed(
      member.page,
      'e2e-private-shared',
      'E2E Shared Private Commons',
    );
    await typeMention(member.page, '@releaseclick2');
    await expect(
      member.page.getByTestId('mention-suggestion-releaseclick2'),
    ).toBeVisible();

    await openGeneralFeed(
      member.page,
      'e2e-private-solo',
      'E2E Solo Private Commons',
    );
    await typeMention(member.page, '@releaseclick2');
    await expect(
      member.page.getByTestId('mention-suggestion-releaseclick2'),
    ).toHaveCount(0);

    await typeMention(member.page, '@sage');
    await expect(
      member.page.getByTestId('mention-suggestion-sage-e2e-private-solo'),
    ).toBeVisible();
    await expect(
      member.page.getByTestId('mention-suggestion-sage-e2e-private-shared'),
    ).toHaveCount(0);
    await expect(member.page.getByTestId('mention-suggestion-sage')).toHaveCount(0);
  } finally {
    await member.context.close();
  }
});
