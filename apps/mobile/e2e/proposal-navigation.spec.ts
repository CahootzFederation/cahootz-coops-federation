import { expect, test } from '@playwright/test';
import { enterFeed, newSignedInPage, USER_A_EMAIL } from './support/auth';

test('proposals live in the active commons drawer instead of the main tab bar', async ({ browser }) => {
  const member = await newSignedInPage(browser, USER_A_EMAIL);
  const { page } = member;

  try {
    // The drawer loads the commons directory when it opens. Slowing that
    // response down holds the drawer in its pre-load state, which must not
    // name a commons (it once said "Cahootz Commons" while linking to a
    // commons with another name).
    await page.route('**/trpc/commons.listDirectory**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      await route.continue();
    });

    const mainNavigation = page.getByRole('tablist', { name: 'Main navigation' });
    await expect(mainNavigation.getByRole('tab', { name: 'Proposals' })).toHaveCount(0);

    await page.getByLabel('Open menu').click();
    await expect(page.getByText('Conversation', { exact: true })).toBeVisible();
    await expect(page.getByText('Circles', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Drafts', { exact: true })).toBeVisible();
    await expect(page.getByText('About this commons', { exact: true })).toBeVisible();
    const drawerProposals = page.getByLabel(/^Open .+ proposals and votes$/);
    const proposalLabel = await drawerProposals.getAttribute('aria-label');
    const activeCommonsName = proposalLabel?.replace(/^Open /, '').replace(/ proposals and votes$/, '');
    expect(activeCommonsName).toBeTruthy();
    await drawerProposals.click();

    await expect(page).toHaveURL(/\/proposals\?coopId=[^&]+$/);
    await expect(page.getByText('Turn conversations into decisions')).toBeVisible();
    await expect(page.getByText('Proposals & Votes', { exact: true }).first()).toBeVisible();
    await expect(page.getByLabel(`Continue proposal drafts in ${activeCommonsName}`)).toBeVisible();
    await expect(page.getByLabel('Switch commons').getByText(activeCommonsName!)).toBeVisible();
  } finally {
    await member.context.close();
  }
});

test('signed-out visitors can browse proposals but see sign-in-aware actions', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
  const page = await context.newPage();
  try {
    await enterFeed(page);
    await page.getByLabel('Open menu').click();
    await expect(page.getByText('Public commons', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Drafts', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Circles', { exact: true })).toHaveCount(0);
    await page.getByLabel(/^Open .+ proposals and votes$/).click();
    await expect(page.getByText('Sign in to propose', { exact: true })).toBeVisible();
    await page.getByText('Sign in to propose', { exact: true }).click();
    await expect(page.getByPlaceholder('name@email.com')).toBeVisible();
  } finally {
    await context.close();
  }
});
