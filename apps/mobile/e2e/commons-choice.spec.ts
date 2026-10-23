import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const run = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const email = `e2e-choice-${run}@test.cahootz.local`;
const family = `E2E Family Choice ${run}`;
function cleanup(...args: string[]) {
  execFileSync('pnpm', ['--silent', '-F', '@cahootz/api', 'exec', 'tsx', '--import', './dotenv.config.js', 'scripts/e2e-family-commons.ts', ...args],
    { cwd: path.resolve(__dirname, '../../..'), timeout: 120_000 });
}
test.afterAll(() => { cleanup('cleanup', family); cleanup('cleanup-newcomers', email); });
test('signup, applying, and family creation never enroll in Cahootz Commons', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/profile-onboarding');
  await expect(page.getByPlaceholder('name@email.com')).toBeVisible();
  await expect(page.getByText('Welcome to Cahootz', { exact: true })).toHaveCount(0);
  await page.reload();
  await page.getByPlaceholder('name@email.com').fill(email);
  await page.getByRole('button', { name: 'Continue with email' }).click();
  await expect(page.getByPlaceholder('Enter 6-digit code')).toBeVisible();
  await page.getByRole('button', { name: 'Change email', exact: true }).click();
  await expect(page.getByPlaceholder('name@email.com')).toHaveValue(email);
  await expect(page.getByPlaceholder('Enter 6-digit code')).toHaveCount(0);
  await page.getByRole('button', { name: 'Continue with email' }).click();
  await page.getByPlaceholder('Enter 6-digit code').fill('000000');
  await page.getByRole('button', { name: 'Verify and continue' }).click();
  await expect(page.getByText('Build your profile', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByPlaceholder('I live in East Oakland and care about food access, music, and helping neighbors connect.').fill('E2E I enjoy meeting neighbors and sharing practical skills with my community.');
  await page.getByPlaceholder('music, housing, food, wellness, events').fill('gardening');
  await page.getByPlaceholder('childcare, rides, cooking, design help').fill('cooking');
  await page.getByPlaceholder('job leads, event space, repair help, collaborators').fill('collaborators');
  await page.getByRole('button', { name: 'Start using Cahootz' }).click();
  await expect(page.getByText('Invite people you know', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('Find your people', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Skip for now', exact: true })).toHaveCount(0);
  await page.screenshot({ path: '../../output/playwright/commons-choice.png', fullPage: true });
  await page.getByRole('button', { name: 'Explore commons' }).click();
  await expect(page).toHaveURL(/commons\?fromOnboarding=1/);
  await page.reload();
  await page.getByRole('button', { name: 'Go back', exact: true }).click();
  await expect(page.getByText('Find your people', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Find your people', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start a family', exact: true }).click();
  await expect(page.getByText('Family · step 1 of 3')).toBeVisible();
  await page.getByLabel('Family name', { exact: true }).fill(`E2E Draft ${run}`);
  await page.getByRole('button', { name: 'Next: make it concrete' }).click();
  await expect(page.getByText('Family · step 2 of 3')).toBeVisible();
  await page.getByRole('button', { name: 'Next: family agreement' }).click();
  await expect(page.getByText('Family · step 3 of 3')).toBeVisible();
  await page.getByLabel('Go back', { exact: true }).filter({ visible: true }).click();
  await expect(page.getByText('Family · step 2 of 3')).toBeVisible();
  await page.getByLabel('Go back', { exact: true }).filter({ visible: true }).click();
  await expect(page.getByLabel('Family name', { exact: true })).toHaveValue(`E2E Draft ${run}`);
  await page.getByLabel('Go back', { exact: true }).filter({ visible: true }).click();
  await expect(page.getByText('Find your people', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Explore commons' }).click();
  await expect(page.getByRole('button', { name: /^View Cahootz (Commons|Coop) details$/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: /^View Cahootz (Commons|Coop) details$/ })).toBeVisible();
  await page.getByRole('button', { name: 'View E2E Market Commons details' }).click();
  await page.getByLabel('Go back', { exact: true }).filter({ visible: true }).click();
  await expect(page.getByText('Browse commons', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View E2E Market Commons details' }).click();
  await page.getByRole('button', { name: 'Apply to join', exact: true }).click();
  await page.getByPlaceholder('Full name').fill(`E2E Applicant ${run}`);
  await page.getByPlaceholder('Phone', { exact: true }).fill(`415${String(Date.now()).slice(-7)}`);
  await page.getByText('Send application', { exact: true }).filter({ visible: true }).click();
  await expect(page.getByText('Application sent', { exact: true }).filter({ visible: true })).toBeVisible();
  await page.getByText('Done', { exact: true }).filter({ visible: true }).click();
  await page.reload();
  await expect(page.getByText('Application pending', { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await page.goto('/commons');
  await expect(page.getByRole('button', { name: /^View Cahootz (Commons|Coop) details$/ })).toBeVisible();
  await page.goto('/?entry=sign-in');
  await expect(page.getByText('Find your people', { exact: true })).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Main navigation' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Start a family' }).click();
  await expect(page.getByText('Family · step 1 of 3')).toBeVisible();
  await page.getByLabel('Family name').fill(family);
  await page.getByText('Skip for now and create the family', { exact: true }).click();
  await expect(page).toHaveURL(/commons-invites/);
  await page.goto('/commons');
  await expect(page.getByRole('button', { name: `Open ${family} circles` })).toBeVisible();
  // Finishing the final choice stays complete after membership changes.
  await page.goto('/profile-onboarding?step=commons');
  await expect(page.getByLabel('Open menu').filter({ visible: true })).toBeVisible();
  await expect(page).not.toHaveURL(/profile-onboarding/);
  await page.goto('/commons');

  await expect(page.getByRole('button', { name: /^View Cahootz (Commons|Coop) details$/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: /^View Cahootz (Commons|Coop) details$/ })).toBeVisible();
});

test('a completed user without a commons returns to choices without tabs on the next login', async ({ page, browser }) => {
  const familyEmail = `e2e-family-choice-${run}@test.cahootz.local`;
  try {
    await page.goto('/?entry=sign-in');
    await page.getByPlaceholder('name@email.com').fill(familyEmail);
    await page.getByRole('button', { name: 'Continue with email' }).click();
    await page.getByPlaceholder('Enter 6-digit code').fill('000000');
    await page.getByRole('button', { name: 'Verify and continue' }).click();
    await page.getByRole('button', { name: 'Do this later' }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Start a family', exact: true }).click();
    await expect(page.getByText('Family · step 1 of 3')).toBeVisible();
    await expect(page.getByLabel('Family name')).toBeVisible();
    await page.goto('/commons');
    await expect(page.getByRole('button', { name: /^View Cahootz (Commons|Coop) details$/ })).toBeVisible();
    const returningContext = await browser.newContext();
    try {
      const returningPage = await returningContext.newPage();
      await returningPage.goto('/?entry=sign-in');
      await returningPage.getByPlaceholder('name@email.com').fill(familyEmail);
      await returningPage.getByRole('button', { name: 'Continue with email' }).click();
      await returningPage.getByPlaceholder('Enter 6-digit code').fill('000000');
      await returningPage.getByRole('button', { name: 'Verify and continue' }).click();
      await expect(returningPage.getByText('Find your people', { exact: true })).toBeVisible();
      await expect(returningPage.getByRole('button', { name: 'Explore commons', exact: true })).toBeVisible();
      await expect(returningPage.getByRole('button', { name: 'Start a family', exact: true })).toBeVisible();
      await expect(returningPage.getByRole('tablist', { name: 'Main navigation' })).toHaveCount(0);
      await expect(returningPage.getByRole('button', { name: 'Skip for now', exact: true })).toHaveCount(0);
      await expect(returningPage.getByText('Build your profile', { exact: true })).toHaveCount(0);
      await returningPage.reload();
      await expect(returningPage.getByText('Find your people', { exact: true })).toBeVisible();
      await expect(returningPage.getByRole('button', { name: 'Explore commons', exact: true })).toBeVisible();
      await expect(returningPage.getByRole('button', { name: 'Start a family', exact: true })).toBeVisible();
      await expect(returningPage.getByRole('tablist', { name: 'Main navigation' })).toHaveCount(0);
      await expect(returningPage.getByRole('button', { name: 'Skip for now', exact: true })).toHaveCount(0);
      await returningPage.getByRole('button', { name: 'Explore commons', exact: true }).click();
      await expect(returningPage.getByText('Browse commons', { exact: true })).toBeVisible();
      await expect(returningPage.getByRole('tablist', { name: 'Main navigation' })).toHaveCount(0);
      await returningPage.getByRole('button', { name: 'Go back', exact: true }).click();
      await expect(returningPage.getByText('Find your people', { exact: true })).toBeVisible();
    } finally { await returningContext.close(); }
  } finally { cleanup('cleanup-newcomers', familyEmail); }
});


test('an invited member gets onboarding on first login, but not on their next device', async ({ browser }) => {
  const invitedEmail = `e2e-invited-first-${run}@test.cahootz.local`;
  cleanup('prepare-first-login-member', invitedEmail);
  try {
    for (const firstVisit of [true, false]) {
      const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
      const page = await context.newPage();
      try {
        await page.goto('/?entry=sign-in');
        await page.getByPlaceholder('name@email.com').fill(invitedEmail);
        await page.getByRole('button', { name: 'Continue with email' }).click();
        await page.getByPlaceholder('Enter 6-digit code').fill('000000');
        await page.getByRole('button', { name: 'Verify and continue' }).click();
        if (firstVisit) {
          await expect(page.getByText('Build your profile', { exact: true })).toBeVisible();
          await page.getByRole('button', { name: 'Do this later' }).click();
          await page.getByRole('button', { name: 'Next', exact: true }).click();
          await expect(page.getByRole('button', { name: 'Go to E2E Market Commons' })).toBeVisible();
          await expect(page.getByRole('button', { name: 'Explore commons' })).toHaveCount(0);
          await expect(page.getByRole('button', { name: 'Start a family', exact: true })).toHaveCount(0);
          await page.screenshot({ path: '../../output/playwright/first-login-commons.png', fullPage: true });
          await page.getByRole('button', { name: 'Go to E2E Market Commons' }).click();
          await expect(page).toHaveURL(/posts/);
          await expect(page.getByRole('tablist', { name: 'Main navigation' })).toBeVisible();
        } else {
          await expect(page.getByLabel('Open menu').filter({ visible: true })).toBeVisible();
          await expect(page.getByText('Build your profile', { exact: true })).toHaveCount(0);
          await page.goto('/profile-onboarding?step=commons');
          await expect(page.getByLabel('Open menu').filter({ visible: true })).toBeVisible();
          await expect(page).not.toHaveURL(/profile-onboarding/);
        }
      } finally { await context.close(); }
    }
  } finally { cleanup('cleanup-newcomers', invitedEmail); }
});


test('unfinished onboarding starts over after leaving each step until completion', async ({ browser }) => {
  test.setTimeout(240_000);
  const resumeEmail = `e2e-resume-${run}@test.cahootz.local`;
  cleanup('prepare-first-login-member', resumeEmail);
  const intro = 'E2E I enjoy sharing tools and growing food with my neighbors.';
  try {
    for (const visit of ['profile', 'invite', 'commons', 'complete', 'finished']) {
      const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
      const page = await context.newPage();
      try {
        await page.goto('/?entry=sign-in');
        await page.getByPlaceholder('name@email.com').fill(resumeEmail);
        await page.getByRole('button', { name: 'Continue with email' }).click();
        await page.getByPlaceholder('Enter 6-digit code').fill('000000');
        await page.getByRole('button', { name: 'Verify and continue' }).click();
        if (visit !== 'finished') {
          await expect(page.getByText('Build your profile', { exact: true })).toBeVisible();
          const introInput = page.getByPlaceholder('I live in East Oakland and care about food access, music, and helping neighbors connect.');
          await expect(introInput).toHaveValue('');
          if (visit === 'profile') {
            await introInput.fill(intro);
            await page.reload();
            await expect(page.getByText('Build your profile', { exact: true })).toBeVisible();
              await expect(introInput).toHaveValue('');
          } else {
            await page.getByRole('button', { name: 'Do this later' }).click();
            await expect(page.getByText('Invite people you know', { exact: true }).first()).toBeVisible();
            if (visit !== 'invite') {
              await page.getByRole('button', { name: 'Next', exact: true }).click();
              await expect(page.getByRole('button', { name: 'Go to E2E Market Commons' })).toBeVisible();
              if (visit === 'complete') {
                await page.getByRole('button', { name: 'Go to E2E Market Commons' }).click();
                await expect(page).toHaveURL(/posts/);
          await expect(page.getByRole('tablist', { name: 'Main navigation' })).toBeVisible();
              }
            }
          }
        } else {
          await expect(page.getByLabel('Open menu').filter({ visible: true })).toBeVisible();
          await page.goto('/profile-onboarding');
          await expect(page.getByLabel('Open menu').filter({ visible: true })).toBeVisible();
          await expect(page).not.toHaveURL(/profile-onboarding/);
        }
      } finally { await context.close(); }
    }
  } finally { cleanup('cleanup-newcomers', resumeEmail); }
});


test('sign-in back returns to the carousel even when opened from commons details', async ({ page }) => {
  await page.goto('/?coopId=cahootz');
  await page.getByLabel('Open menu').click();
  await page.getByText('Explore all Commons directory', { exact: true }).filter({ visible: true }).click();
  await expect(page.getByText('Browse commons', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View E2E Market Commons details' }).click();
  await page.getByRole('button', { name: 'Sign in to apply' }).click();
  await expect(page.getByPlaceholder('name@email.com')).toBeVisible();
  await page.getByRole('button', { name: 'Go back', exact: true }).click();
  await expect(page.getByText('Welcome to Cahootz', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Main navigation' })).toHaveCount(0);
});


test('logged-out welcome opens verification and back returns to welcome', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Welcome to Cahootz', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'I already have an account', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByPlaceholder('name@email.com')).toBeVisible();
  await page.getByRole('button', { name: 'Go back', exact: true }).click();
  await expect(page.getByText('Welcome to Cahootz', { exact: true }).filter({ visible: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByPlaceholder('name@email.com')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Don’t have an account? Get started' })).toHaveCount(0);
  await page.getByPlaceholder('name@email.com').fill(email);
  await page.getByRole('button', { name: 'Continue with email' }).click();
  await expect(page.getByPlaceholder('Enter 6-digit code')).toBeVisible();
  await page.getByRole('button', { name: 'Go back', exact: true }).click();
  await expect(page.getByText('Welcome to Cahootz', { exact: true }).filter({ visible: true })).toBeVisible();
});

test('signed-out browsing and welcome never show the member tab bar', async ({ page }) => {
  await page.goto('/?coopId=cahootz');
  await expect(page.getByLabel('Open menu')).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Main navigation' })).toHaveCount(0);
  await page.goto('/');
  await expect(page.getByText('Welcome to Cahootz', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Main navigation' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Welcome to Cahootz', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Main navigation' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByPlaceholder('name@email.com')).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Main navigation' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Go back', exact: true }).click();
  await expect(page.getByText('Welcome to Cahootz', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Main navigation' })).toHaveCount(0);
});

test('compact email and code forms fit phone and tablet widths', async ({ page }) => {
  await page.goto('/?entry=sign-in');
  await expect(page.getByRole('heading', { name: 'Continue to Cahootz' })).toBeVisible();
  for (const width of [320, 375, 414, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('button', { name: 'Continue with email' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `../../output/playwright/compact-email-${width}.png` });
  }
  await page.getByPlaceholder('name@email.com').fill(email);
  await page.getByRole('button', { name: 'Continue with email' }).click();
  await expect(page.getByText('Check your email', { exact: true })).toBeVisible();
  await expect(page.getByText(email, { exact: false })).toBeVisible();
  for (const width of [320, 375, 414, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('button', { name: 'Verify and continue' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `../../output/playwright/compact-code-${width}.png` });
  }
  await page.getByRole('button', { name: 'Change email', exact: true }).click();
  await expect(page.getByPlaceholder('name@email.com')).toHaveValue(email);
});
