import { test as setup } from "@playwright/test";
import {
  USER_A_EMAIL,
  USER_B_EMAIL,
  signIn,
  storageStatePath,
} from "./support/auth";

// Runs before every other spec (see the `setup` project in
// playwright.config.ts). Each fixture account signs in once through the real
// UI - email, one-time code, onboarding wizard, and a check that the menu
// shows the right identity - and the resulting browser storage is saved so
// `newSignedInPage` can start each test already signed in.
for (const email of [USER_A_EMAIL, USER_B_EMAIL]) {
  setup(`${email} signs in through the UI`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 430, height: 932 },
    });
    try {
      const page = await context.newPage();
      await signIn(page, email);
      await context.storageState({ path: storageStatePath(email) });
    } finally {
      await context.close();
    }
  });
}
