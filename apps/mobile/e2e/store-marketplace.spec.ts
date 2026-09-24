import { expect, test } from '@playwright/test';
import { newSignedInPage } from './support/auth';

const USER_A_EMAIL = process.env.E2E_USER_A_EMAIL || 'releaseclick1@test.cahootz.local';

test('member can open the restored Shop and start a shop application', async ({ browser }) => {
  const member = await newSignedInPage(browser, USER_A_EMAIL);
  try {
    await member.page.getByRole('tab', { name: 'Shop' }).click();
    await expect(member.page.getByText('Shop together', { exact: true })).toBeVisible();
    await expect(member.page.getByText('Fund your commons', { exact: true })).toBeVisible();
    await expect(member.page.getByText('Funding badges', { exact: true })).toBeVisible();

    await member.page.getByLabel('Open a shop').click();
    await expect(member.page).toHaveURL(/apply-store/);
    await member.page.goBack();

    await member.page.getByRole('tab', { name: 'Shop' }).click();
    await member.page.getByLabel('Search marketplace').fill('E2E no matching shop');
    await expect(member.page.getByText('Nothing matched that search', { exact: true })).toBeVisible();
  } finally {
    await member.context.close();
  }
});

test('member of several commons can switch the Shop to another commons and see its shops', async ({ browser }) => {
  // Fixture: seed:e2e-marketplace joins User A to "E2E Market Commons" and
  // gives it one payment-ready member shop.
  const member = await newSignedInPage(browser, USER_A_EMAIL);
  try {
    await member.page.getByRole('tab', { name: 'Shop' }).click();
    const switchTo = member.page.getByLabel('Shop E2E Market');
    await expect(switchTo).toBeVisible();
    await switchTo.click();
    await member.page.getByRole('tab', { name: 'stores' }).click();
    await expect(member.page.getByLabel('Open E2E Second Commons Shop')).toBeVisible();

    await member.page.getByRole('tab', { name: 'products' }).click();
    await expect(member.page.getByText('E2E Second Commons Tote', { exact: true })).toBeVisible();

    await member.page.getByText('E2E Second Commons Tote', { exact: true }).click();
    await expect(member.page).toHaveURL(/store-detail/);
    await expect(member.page.getByText('Member shop in the E2E second commons.', { exact: true })).toBeVisible();
  } finally {
    await member.context.close();
  }
});

test('funding badge checkout uses Stripe test mode when a ready official shop is configured', async ({ browser }) => {
  test.skip(!process.env.E2E_STRIPE_CONNECTED_ACCOUNT_ID, 'Stripe Connect test account is not configured');
  test.setTimeout(120_000);
  const member = await newSignedInPage(browser, USER_A_EMAIL);
  try {
    await member.page.getByRole('tab', { name: 'Shop' }).click();
    await member.page.getByRole('tab', { name: 'stores' }).click();
    await expect(member.page.getByText('All shops', { exact: true })).toBeVisible();
    await member.page.getByLabel('Open Cahootz Funding Shop').click();
    await expect(member.page.getByText('Cahootz Funding Shop', { exact: true }).first()).toBeVisible();
    await member.page.goBack();
    await member.page.getByRole('tab', { name: 'Shop' }).click();
    const seedBadge = member.page.getByLabel('Add Seed Supporter to cart');
    await expect(seedBadge).toBeVisible();
    await seedBadge.click();
    await member.page.getByLabel('Shopping cart').click();
    await expect(member.page.getByText('Seed Supporter', { exact: true })).toBeVisible();
    await member.page.getByRole('button', { name: /checkout/i }).first().click();
    await expect(member.page).toHaveURL(/checkout/);
    await expect(member.page.getByText(/50.*SC|SC.*50/i).first()).toBeVisible();
    await member.page.getByRole('button', { name: /continue to payment/i }).click();

    const stripeFrame = member.page.frameLocator('iframe[title*="Secure payment"]');
    await stripeFrame.getByPlaceholder(/card number/i).fill('4242424242424242');
    await stripeFrame.getByPlaceholder(/expiration/i).fill('1234');
    await stripeFrame.getByPlaceholder(/security code/i).fill('123');
    const postal = stripeFrame.getByPlaceholder(/zip|postal/i);
    if (await postal.isVisible().catch(() => false)) await postal.fill('94612');

    const confirmation = new Promise<string>((resolve) => {
      member.page.once('dialog', async (dialog) => {
        const message = dialog.message();
        await dialog.accept();
        resolve(message);
      });
    });
    await member.page.getByRole('button', { name: /^Pay / }).click();
    expect(await confirmation).toContain('Payment Confirmed');
  } finally {
    await member.context.close();
  }
});
