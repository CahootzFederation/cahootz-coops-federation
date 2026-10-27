import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { newSignedInPage, openGeneralFeed, USER_A_EMAIL, USER_B_EMAIL } from './support/auth';

type PackResult = { storeReady: boolean; packs: Array<{ productId: string; messages: number; priceUSD: number }> };

function fixture<T>(command: 'reset' | 'use-all', runId: string, email: string): T {
  const output = execFileSync('pnpm', ['--silent', '-F', '@cahootz/api', 'exec', 'tsx', '--import', './dotenv.config.js', 'scripts/e2e-sage-chat.ts', command, runId, email], {
    cwd: path.resolve(__dirname, '../../..'), encoding: 'utf8', timeout: 120000,
  });
  const line = output.split('\n').find(candidate => candidate.startsWith('E2E_RESULT '));
  if (!line) throw new Error('Sage chat fixture returned no result');
  return JSON.parse(line.slice('E2E_RESULT '.length));
}

async function openAskSage(page: Page) {
  await openGeneralFeed(page);
  await page.getByLabel('Ask Sage about this Commons').click();
  // The post board stays mounted under the chat, so wait on the chat's own allowance bar.
  await expect(page.getByTestId('sage-allowance')).toBeVisible();
}

const newRunId = () => `E2E-sage-chat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

test('a member chats with Sage privately and runs out of free messages', async ({ browser }) => {
  const runId = newRunId();
  fixture('reset', runId, USER_A_EMAIL);
  fixture('reset', runId, USER_B_EMAIL);
  const a = await newSignedInPage(browser, USER_A_EMAIL);
  const b = await newSignedInPage(browser, USER_B_EMAIL);
  try {
    await openAskSage(a.page);
    const allowance = a.page.getByTestId('sage-allowance');
    await expect(allowance).toContainText('20 messages left');

    // Code never reaches a model: Sage sends a fixed reply and the message is free.
    const codeMessage = `const ${runId.replaceAll('-', '_')} = 1; function f() { return 2; }`;
    await a.page.getByLabel('Message Sage').fill(codeMessage);
    await a.page.getByRole('button', { name: 'Send' }).click();
    await expect(a.page.getByTestId('sage-chat-reply').last()).toContainText('That looks like code');
    await expect(allowance).toContainText('20 messages left');

    await a.page.reload();
    await expect(a.page.getByText(codeMessage)).toBeVisible();
    await expect(a.page.getByTestId('sage-chat-reply')).toHaveCount(1);

    // The chat is private: the other member's Ask Sage is empty and has its own allowance.
    await openAskSage(b.page);
    await expect(b.page.getByTestId('sage-allowance')).toContainText('20 messages left');
    await expect(b.page.getByText(codeMessage)).toHaveCount(0);

    const store = fixture<PackResult>('use-all', runId, USER_A_EMAIL);
    await a.page.reload();
    const out = a.page.getByTestId('sage-out-of-messages');
    await expect(out).toContainText("You're out of Sage messages for now");
    await expect(out).toContainText('free messages come back on');
    await expect(a.page.getByLabel('Message Sage')).toHaveCount(0);
    if (store.storeReady && store.packs.length) {
      await out.getByRole('button', { name: 'Get 50 messages for $5' }).click();
      await expect(a.page.getByText('50 Sage messages').first()).toBeVisible();
    } else {
      await expect(out).toContainText("isn't set up to sell more messages yet");
    }
  } finally {
    fixture('reset', runId, USER_A_EMAIL);
    fixture('reset', runId, USER_B_EMAIL);
    await Promise.all([a.context.close(), b.context.close()]);
  }
});

test('Sage answers a question about the Commons and uses one message @sage', async ({ browser }) => {
  test.setTimeout(180_000);
  const runId = newRunId();
  fixture('reset', runId, USER_A_EMAIL);
  const a = await newSignedInPage(browser, USER_A_EMAIL);
  try {
    await openAskSage(a.page);
    await a.page.getByRole('button', { name: "What's going on in our Commons this week?" }).click();
    const reply = a.page.getByTestId('sage-chat-reply');
    await expect(reply).toHaveCount(1, { timeout: 90_000 });
    await expect(reply).not.toHaveText('');
    await expect(a.page.getByTestId('sage-allowance')).toContainText('19 messages left');
    await a.page.reload();
    await expect(a.page.getByTestId('sage-chat-reply')).toHaveCount(1);
    await expect(a.page.getByTestId('sage-allowance')).toContainText('19 messages left');
  } finally {
    fixture('reset', runId, USER_A_EMAIL);
    await a.context.close();
  }
});
