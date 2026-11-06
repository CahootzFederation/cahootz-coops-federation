import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { newSignedInPage, USER_A_EMAIL } from './support/auth';

function fixture(...args: string[]) {
  const output = execFileSync('pnpm', ['--silent', '-F', '@cahootz/api', 'exec', 'tsx', '--import', './dotenv.config.js', 'scripts/e2e-governance-vote.ts', ...args], {
    cwd: path.resolve(__dirname, '../../..'), encoding: 'utf8', timeout: 120_000,
  });
  const line = output.split('\n').find((entry) => entry.startsWith('E2E_RESULT '));
  if (!line) throw new Error('Governance fixture did not return its result');
  return JSON.parse(line.slice('E2E_RESULT '.length)) as { proposalId: string; title: string };
}

test('proposal history keeps a withdrawn decision discoverable after reload', async ({ browser }) => {
  const seeded = fixture('seed', `calm-${Date.now()}`, USER_A_EMAIL, 'cahootz');
  const member = await newSignedInPage(browser, USER_A_EMAIL);
  const { page } = member;
  try {
    await page.goto('/proposals?coopId=cahootz');
    await page.getByText(seeded.title, { exact: true }).click();
    await page.getByRole('button', { name: 'Withdraw proposal', exact: true }).click();
    await page.getByRole('button', { name: 'Yes, withdraw it', exact: true }).click();
    await expect(page.getByText('Withdrawn', { exact: true }).filter({ visible: true }).first()).toBeVisible();
    await page.goto('/proposals?coopId=cahootz');
    await expect(page.getByRole('tab', { name: 'Current', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText(seeded.title, { exact: true })).toHaveCount(0);
    await page.getByRole('tab', { name: 'History', exact: true }).click();
    await expect(page.getByText(seeded.title, { exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole('tab', { name: 'History', exact: true }).click();
    await page.getByText(seeded.title, { exact: true }).click();
    await expect(page.getByText('Withdrawn', { exact: true }).filter({ visible: true }).first()).toBeVisible();
  } finally {
    fixture('cleanup', seeded.proposalId);
    await member.context.close();
  }
});

test('unavailable proposal actions can retry without claiming no votes', async ({ browser }) => {
  const member = await newSignedInPage(browser, USER_A_EMAIL);
  const { page } = member;
  try {
    await page.route('**/trpc/proposal.myActionSummary**', (route) => route.abort());
    await page.goto('/proposals?coopId=cahootz');
    await expect(page.getByText("We couldn't check your drafts and votes.", { exact: true })).toBeVisible();
    await expect(page.getByLabel(/proposals need your vote/)).toHaveCount(0);
    await expect(page.getByText('You are caught up', { exact: true })).toHaveCount(0);
    // Recover through the real endpoint: this fixture is an ordinary member.
    await page.unroute('**/trpc/proposal.myActionSummary**');
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.getByText("We couldn't check your drafts and votes.", { exact: true })).toHaveCount(0);
    await expect(page.getByText('Checking drafts and votes…', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel(/proposals need your vote/)).toHaveCount(0);
  } finally { await member.context.close(); }
});

// Presentation-only states: no vote or permission mutation. The backend's
// council role gate is unchanged and these responses authorize no actions.
test('eligible decision summary distinguishes an empty queue from outstanding votes', async ({ browser }) => {
  const member = await newSignedInPage(browser, USER_A_EMAIL);
  const { page } = member;
  const seeded = fixture('seed', `calm-queue-${Date.now()}`, USER_A_EMAIL, 'cahootz');
  let hasVote = true;
  try {
    await page.route('**/trpc/proposal.myActionSummary**', async (route) => {
      if (route.request().method() === 'OPTIONS') return route.continue();
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { data: {
        canVote: true, actionableVoteCount: hasVote ? 1 : 0, actionableProposalIds: hasVote ? [seeded.proposalId] : [],
      } } }) });
    });
    await page.goto('/proposals?coopId=cahootz');
    await page.getByLabel('1 proposals need your vote', { exact: true }).click();
    await expect(page.getByText(seeded.title, { exact: true })).toBeVisible();
    hasVote = false;
    await page.reload();
    await page.getByLabel('0 proposals need your vote', { exact: true }).click();
    await expect(page.getByText('You are caught up', { exact: true })).toBeVisible();
    await expect(page.getByText(seeded.title, { exact: true })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Current', exact: true }).click();
    await expect(page.getByText(seeded.title, { exact: true })).toBeVisible();
  } finally { fixture('cleanup', seeded.proposalId); await member.context.close(); }
});
