import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { signIn } from './support/auth';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

function defaultCommonsFixture(command: 'create' | 'cleanup', email: string) {
  execFileSync(
    'pnpm',
    ['--silent', '-F', '@cahootz/api', 'exec', 'tsx', '--import', './dotenv.config.js', 'scripts/e2e-default-commons.ts', command, email],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 120_000,
      env: {
        ...process.env,
        E2E_DATABASE_URL_OVERRIDE: process.env.DATABASE_URL,
      },
    },
  );
}

test('a member can star a default Commons and lands there on their next sign-in', async ({ browser }) => {
  const runId = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2edefaultcommons${runId}@test.cahootz.local`;
  const defaultName = 'E2E Market Commons';
  defaultCommonsFixture('create', email);

  const firstContext = await browser.newContext({ viewport: { width: 430, height: 932 } });
  const firstPage = await firstContext.newPage();
  let secondContext: Awaited<ReturnType<typeof browser.newContext>> | null = null;
  try {
    await signIn(firstPage, email);
    const initialCommonsSwitcher = firstPage.getByLabel(/^Switch commons\. Currently /);
    await expect(firstPage).toHaveURL(/coopId=cahootz/);
    await expect(initialCommonsSwitcher).toBeVisible();

    await initialCommonsSwitcher.click();
    const firstSwitcherSheet = firstPage.getByLabel('Commons switcher');
    await firstSwitcherSheet.getByLabel(`Make ${defaultName} your default commons`).click();
    await expect(
      firstSwitcherSheet.getByLabel(`${defaultName} is your default commons`),
    ).toBeVisible();

    await firstContext.close();

    secondContext = await browser.newContext({ viewport: { width: 430, height: 932 } });
    const secondPage = await secondContext.newPage();
    await signIn(secondPage, email);

    await expect(secondPage.getByLabel(`Switch commons. Currently ${defaultName}`)).toBeVisible();
    await expect(secondPage).toHaveURL(/coopId=e2e-market/);
    await secondPage.getByLabel(`Switch commons. Currently ${defaultName}`).click();
    await expect(
      secondPage.getByLabel('Commons switcher').getByLabel(`${defaultName} is your default commons`),
    ).toBeVisible();
  } finally {
    await firstContext.close().catch(() => {});
    await secondContext?.close().catch(() => {});
    defaultCommonsFixture('cleanup', email);
  }
});
