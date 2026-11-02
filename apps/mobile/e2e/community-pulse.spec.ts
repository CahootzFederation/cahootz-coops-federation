import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { USER_A_EMAIL, USER_B_EMAIL } from './support/auth';

function fixture(command: string, runId: string) {
  const output = execFileSync('pnpm', ['--silent', '-F', '@cahootz/api', 'exec', 'tsx', '--import', './dotenv.config.js', 'scripts/e2e-human-ai-feedback.ts', command, runId, USER_A_EMAIL, USER_B_EMAIL], {
    cwd: path.resolve(__dirname, '../../..'), encoding: 'utf8', timeout: 120000,
  });
  const line = output.split('\n').find(line => line.startsWith('E2E_RESULT '));
  if (!line) throw new Error('Pulse fixture returned no result');
  return JSON.parse(line.slice('E2E_RESULT '.length));
}

async function openPulse(page: Page, email: string) {
  // Fresh real UI sign-ins avoid stale saved identities left by other local runs.
  await page.goto('/?entry=sign-in');
  await page.getByPlaceholder('name@email.com').fill(email);
  await page.getByRole('button', { name: 'Continue with email' }).click();
  await page.getByPlaceholder('Enter 6-digit code').fill(process.env.E2E_LOGIN_CODE || '000000');
  await page.getByRole('button', { name: 'Verify and continue' }).click();
  await expect(page.getByLabel('Manage circles')).toBeVisible();
  await page.getByLabel('Open menu').click();
  await page.getByLabel(/Open .* page/).first().click();
  await page.getByText('Community', { exact: true }).click();
}

test('two members save and edit independent Pulse responses that survive reloads', async ({ browser }) => {
  const runId = `E2E-pulse-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const a = await browser.newContext({ viewport: { width: 414, height: 932 } });
  const b = await browser.newContext({ viewport: { width: 414, height: 932 } });
  const pageA = await a.newPage();
  const pageB = await b.newPage();
  const renderErrors: string[] = [];
  pageA.on('console', message => {
    if (message.text().includes('Unexpected text node')) renderErrors.push(message.text());
  });
  try {
    // Exercise the real API on an isolated local stack when requested.
    if (process.env.E2E_API_BASE_URL) {
      for (const context of [a, b]) await context.route('**/trpc/**', route => {
        const target = new URL(route.request().url());
        const base = new URL(process.env.E2E_API_BASE_URL!);
        target.host = base.host;
        target.protocol = base.protocol;
        return route.continue({ url: target.toString() });
      });
    }
    const { id } = fixture('seed', runId);
    await Promise.all([openPulse(pageA, USER_A_EMAIL), openPulse(pageB, USER_B_EMAIL)]);
    const cardA = pageA.getByTestId(`pulse-observation-${id}`);
    await expect(cardA).toBeVisible();
    await expect(pageA.getByText(`${runId} PRIVATE MUST NOT APPEAR`)).toHaveCount(0);
    // Both existing sections must precede Pulse in the actual layout.
    const pulseBox = await pageA.getByTestId('community-pulse').boundingBox();
    for (const label of ['People', 'Circles']) {
      const box = await pageA.getByText(label, { exact: true }).first().boundingBox();
      expect(box!.y).toBeLessThan(pulseBox!.y);
    }
    await cardA.getByRole('button', { name: 'What led to this?' }).click();
    await expect(cardA.getByText('What we don’t know')).toBeVisible();
    await cardA.getByRole('radio', { name: 'Partly', exact: true }).click();
    await expect(cardA.getByText(/Your response is saved/)).toBeVisible();
    const note = `${runId}: weekday lunches would work better.`;
    await cardA.getByLabel('Your perspective on the community').fill(note);
    await cardA.getByRole('button', { name: 'Save explanation' }).click();
    await expect(cardA.getByText(/Your response is saved/)).toBeVisible();
    await expect(cardA.getByRole('button', { name: 'Save explanation' })).toBeDisabled();
    const cardB = pageB.getByTestId(`pulse-observation-${id}`);
    await expect(cardB).toBeVisible();
    await expect(cardB.getByLabel('Your perspective on the community')).toHaveCount(0);
    await expect(pageB.getByText(note, { exact: true })).toHaveCount(0);
    await cardB.getByRole('radio', { name: 'Yes', exact: true }).click();
    await expect(cardB.getByText(/Your response is saved/)).toBeVisible();

    await cardA.getByRole('radio', { name: 'Different take' }).click();
    await expect(cardA.getByRole('radio', { name: 'Different take' })).toHaveAttribute('aria-checked', 'true');
    await Promise.all([pageA.reload(), pageB.reload()]);
    await Promise.all([
      pageA.getByText('Community', { exact: true }).click(),
      pageB.getByText('Community', { exact: true }).click(),
    ]);
    await expect(cardA.getByRole('radio', { name: 'Different take' })).toHaveAttribute('aria-checked', 'true');
    await expect(cardA.getByLabel('Your perspective on the community')).toHaveValue(note);
    await expect(cardB.getByRole('radio', { name: 'Yes', exact: true })).toHaveAttribute('aria-checked', 'true');
    await expect(cardB.getByLabel('Your perspective on the community')).toHaveValue('');
    expect(renderErrors).toEqual([]);
    expect(fixture('verify', runId)).toEqual({ count: 2, a: 'DIFFERENT_TAKE', b: 'YES', immutable: true });
    for (const width of [320, 375, 414, 768]) {
      await pageB.setViewportSize({ width, height: 932 });
      const box = await cardB.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      for (const choice of ['Yes', 'Partly', 'Different take']) {
        const control = await cardB.getByRole('radio', { name: choice, exact: true }).boundingBox();
        expect(control!.x + control!.width).toBeLessThanOrEqual(box!.x + box!.width);
      }
    }
    await pageB.setViewportSize({ width: 414, height: 932 });
    await cardB.scrollIntoViewIfNeeded();
    await pageB.screenshot({ path: '../../output/playwright/community-pulse-feedback.png' });
  } finally {
    await a.close();
    await b.close();
    fixture('cleanup', runId);
  }
});


test('a failed Pulse save retains the answer and an explanation can be removed', async ({ browser }) => {
  const runId = `E2E-pulse-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const context = await browser.newContext({ viewport: { width: 414, height: 932 } });
  const page = await context.newPage();
  try {
    if (process.env.E2E_API_BASE_URL) await context.route('**/trpc/**', route => {
      const target = new URL(route.request().url());
      const base = new URL(process.env.E2E_API_BASE_URL!);
      target.host = base.host;
      target.protocol = base.protocol;
      return route.continue({ url: target.toString() });
    });
    const { id } = fixture('seed', runId);
    await openPulse(page, USER_A_EMAIL);
    const card = page.getByTestId(`pulse-observation-${id}`);
    await card.getByRole('radio', { name: 'Partly', exact: true }).click();
    await expect(card.getByText(/Your response is saved/)).toBeVisible();
    await card.getByLabel('Your perspective on the community').fill(`${runId} timing matters`);
    await card.getByRole('button', { name: 'Save explanation' }).click();
    await expect(card.getByText(/Your response is saved/)).toBeVisible();
    await page.route('**/trpc/communityPulse.saveFeedback', route => route.fulfill({ status: 500, body: '{}' }));
    await card.getByRole('radio', { name: 'Different take' }).click();
    await expect(card.getByRole('alert')).toContainText("Your response didn't save");
    await expect(card.getByRole('radio', { name: 'Partly', exact: true })).toHaveAttribute('aria-checked', 'true');
    await page.unroute('**/trpc/communityPulse.saveFeedback');
    await card.getByRole('radio', { name: 'Different take' }).click();
    await expect(card.getByRole('radio', { name: 'Different take' })).toHaveAttribute('aria-checked', 'true');
    await card.getByLabel('Your perspective on the community').fill('');
    await card.getByRole('button', { name: 'Save explanation' }).click();
    await expect(card.getByText(/Your response is saved/)).toBeVisible();
    await page.reload();
    await page.getByText('Community', { exact: true }).click();
    await expect(card.getByRole('radio', { name: 'Different take' })).toHaveAttribute('aria-checked', 'true');
    await expect(card.getByLabel('Your perspective on the community')).toHaveValue('');
  } finally {
    await context.close();
    fixture('cleanup', runId);
  }
});


test('Sage publishes a real observation that a member can read and respond to', async ({ browser }) => {
  const runId = `E2E-pulse-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const context = await browser.newContext({ viewport: { width: 414, height: 932 } });
  const page = await context.newPage();
  try {
    if (process.env.E2E_API_BASE_URL) await context.route('**/trpc/**', route => {
      const target = new URL(route.request().url());
      const base = new URL(process.env.E2E_API_BASE_URL!);
      target.host = base.host;
      target.protocol = base.protocol;
      return route.continue({ url: target.toString() });
    });
    const { id, coopId } = fixture('publish', runId);
    await openPulse(page, USER_A_EMAIL);
    await page.goto(`/commons/${coopId}`);
    await page.getByText('Community', { exact: true }).click();
    const card = page.getByTestId(`pulse-observation-${id}`);
    await expect(card.getByText('Still getting a read', { exact: true })).toBeVisible();
    await expect(card).toContainText('isn’t enough recent shared activity');
    await card.getByRole('button', { name: 'What led to this?' }).click();
    await expect(card).toContainText('quiet feed doesn’t mean a quiet community');
    await card.getByRole('radio', { name: 'Partly', exact: true }).click();
    await expect(card.getByText(/Your response is saved/)).toBeVisible();
    await page.reload();
    await page.getByText('Community', { exact: true }).click();
    await expect(card.getByRole('radio', { name: 'Partly', exact: true })).toHaveAttribute('aria-checked', 'true');
  } finally {
    await context.close();
    fixture('cleanup-published', runId);
  }
});
