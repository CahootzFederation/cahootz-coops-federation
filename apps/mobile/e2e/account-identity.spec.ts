import { expect, test } from '@playwright/test';

import { newSignedInPage } from './support/auth';
import { withExclusiveAccountSetting } from './support/exclusive';

const API_BASE_URL = process.env.E2E_API_BASE_URL || 'http://localhost:3001';
const USER_A_EMAIL = process.env.E2E_USER_A_EMAIL || 'releaseclick1@test.cahootz.local';
const USER_B_EMAIL = process.env.E2E_USER_B_EMAIL || 'releaseclick2@test.cahootz.local';

test('a member changes their name, unique @, and nickname', async ({ browser }) => {
  await withExclusiveAccountSetting('account-identity', async () => {
    const runId = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`.slice(-12);
    const nextHandle = `e2e_${runId}`;
    const nextName = `E2E Name ${runId}`;
    const nextNickname = `E2E Nick ${runId}`;
    const userA = await newSignedInPage(browser, USER_A_EMAIL);
    const userB = await newSignedInPage(browser, USER_B_EMAIL);
    const original = await userA.page.evaluate(() => JSON.parse(window.localStorage.getItem('cahootz.user') || '{}'));
    const userBHandle = await userB.page.evaluate(() => JSON.parse(window.localStorage.getItem('cahootz.user') || '{}').handle);

    try {
      await userA.page.goto('/(tabs)/wallet');
      await userA.page.getByRole('button', { name: 'Edit name, nickname, and @' }).click();

      await userA.page.getByRole('textbox', { name: 'Name', exact: true }).fill(nextName);
      await userA.page.getByRole('textbox', { name: 'Nickname', exact: true }).fill(nextNickname);
      await userA.page.getByRole('textbox', { name: 'Handle', exact: true }).fill(userBHandle);
      await userA.page.getByRole('button', { name: 'Save identity' }).click();
      await expect(userA.page.getByText('That @ is already taken.', { exact: true })).toBeVisible();

      await userA.page.getByRole('textbox', { name: 'Handle', exact: true }).fill(nextHandle);
      await userA.page.getByRole('button', { name: 'Save identity' }).click();
      await expect(userA.page.getByRole('button', { name: 'Save identity' })).toBeHidden();
      await expect(userA.page.getByText(nextNickname, { exact: true })).toBeVisible();
      await expect(userA.page.getByText(nextName, { exact: true })).toBeVisible();
      await expect(userA.page.getByText(`@${nextHandle} · member`, { exact: true })).toBeVisible();

      await userA.page.reload();
      await expect(userA.page.getByText(nextNickname, { exact: true })).toBeVisible();

      await userB.page.goto(`/people/${nextHandle}`);
      await expect(userB.page.getByText(nextNickname, { exact: true })).toBeVisible();
      await expect(userB.page.getByText(nextName, { exact: true })).toBeVisible();
      await expect(userB.page.getByText(`@${nextHandle}`, { exact: true }).first()).toBeVisible();
    } finally {
      const sessionToken = await userA.page.evaluate(() => window.localStorage.getItem('cahootz.sessionToken'));
      if (sessionToken && original.name && original.handle) {
        const response = await fetch(`${API_BASE_URL}/trpc/user.updateIdentity`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-session-token': sessionToken },
          body: JSON.stringify({
            name: original.name,
            nickname: original.nickname ?? null,
            handle: original.handle,
          }),
        });
        expect(response.ok).toBe(true);
      }
      await userA.context.close();
      await userB.context.close();
    }
  });
});
