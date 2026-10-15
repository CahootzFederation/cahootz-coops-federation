import { expect, test } from "@playwright/test";
import { newSignedInPage, USER_A_EMAIL } from "./support/auth";

// Sage has a face (a peach blob with round glasses) instead of initials or a
// sparkle icon. It shows on Sage's page, in the Sage suggestions screen, and
// in Messages, and never on a person's own page.
test("Sage shows its own face instead of initials", async ({ browser }) => {
  const member = await newSignedInPage(browser, USER_A_EMAIL);

  try {
    await member.page.goto("/people/sage");
    await expect(member.page.getByText("@sage").first()).toBeVisible();
    await expect(member.page.getByTestId("sage-avatar").first()).toBeVisible();

    await member.page.goto("/sage");
    await expect(member.page.getByText("Sage suggestions").first()).toBeVisible();
    await expect(member.page.getByTestId("sage-avatar").first()).toBeVisible();

    await member.page.reload();
    await expect(member.page.getByTestId("sage-avatar").first()).toBeVisible();

    const raw = await member.page.evaluate(() => window.localStorage.getItem("cahootz.user"));
    const { handle } = JSON.parse(raw || "{}");
    expect(handle).toBeTruthy();
    await member.page.goto(`/people/${handle}`);
    await expect(member.page.getByText("Personal Page").first()).toBeVisible();
    await expect(member.page.getByTestId("sage-avatar")).toHaveCount(0);
  } finally {
    await member.context.close();
  }
});
