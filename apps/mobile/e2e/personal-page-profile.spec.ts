import { expect, test, type Page } from "@playwright/test";
import { newSignedInPage } from "./support/auth";

const API_BASE_URL = process.env.E2E_API_BASE_URL || "http://localhost:3001";
const USER_A_EMAIL =
  process.env.E2E_USER_A_EMAIL || "releaseclick1@test.cahootz.local";
const USER_B_EMAIL =
  process.env.E2E_USER_B_EMAIL || "releaseclick2@test.cahootz.local";

// 1x1 transparent PNG, enough for the image picker to accept a real file.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

type ProfileSnapshot = {
  handle: string;
  bio: string | null;
  avatarUrl: string | null;
  avatarEmoji: string | null;
  avatarColor: string | null;
};

async function ownProfile(page: Page): Promise<ProfileSnapshot> {
  const handle = USER_A_EMAIL.split("@")[0].replace(/[^a-z0-9]+/gi, "");
  const input = encodeURIComponent(JSON.stringify({ handle, limit: 1 }));
  const response = await page.request.get(
    `${API_BASE_URL}/trpc/commons.getPersonalPage?input=${input}`,
  );
  expect(response.ok()).toBe(true);
  const { profile } = (await response.json()).result.data;
  return {
    handle: profile.handle,
    bio: profile.bio ?? null,
    avatarUrl: profile.avatarUrl ?? null,
    avatarEmoji: profile.avatarEmoji ?? null,
    avatarColor: profile.avatarColor ?? null,
  };
}

test("a member adds a bio and emoji avatar to their page and another member sees it", async ({
  browser,
}) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const bioText = `E2E bio ${runId}: building a tool library for the block`;

  const userA = await newSignedInPage(browser, USER_A_EMAIL);
  const userB = await newSignedInPage(browser, USER_B_EMAIL);
  const original = await ownProfile(userA.page);

  try {
    await userA.page.getByLabel("Open menu").click();
    await userA.page.getByText("My Personal Page", { exact: true }).click();
    await expect(userA.page).toHaveURL(/personal-page/);

    await userA.page.getByRole("button", { name: /Add a bio|Edit profile/ }).click();
    await expect(userA.page.getByText("Edit profile", { exact: true }).last()).toBeVisible();

    // Picking a photo previews it in the sheet before anything is saved.
    const chooser = userA.page.waitForEvent("filechooser");
    await userA.page.getByRole("button", { name: "Upload photo" }).click();
    await (await chooser).setFiles({
      name: "avatar.png",
      mimeType: "image/png",
      buffer: TINY_PNG,
    });
    // expo-image renders the label as the <img>'s alt text on web, which
    // getByLabel doesn't match - query it as an image by accessible name.
    await expect(
      userA.page.getByRole("img", { name: /profile photo$/ }).last(),
    ).toBeVisible();

    // Switch to an emoji avatar instead, then write the bio and save.
    await userA.page.getByRole("button", { name: "Use emoji" }).click();
    await userA.page.getByLabel("Use emoji 🌻").click();
    await userA.page.getByLabel("Bio").fill(bioText);
    await userA.page.getByRole("button", { name: "Save profile" }).click();

    await expect(userA.page.getByRole("button", { name: "Save profile" })).toBeHidden();
    await expect(userA.page.getByText(bioText, { exact: true })).toBeVisible();
    await expect(userA.page.getByText("🌻", { exact: true }).first()).toBeVisible();
    await expect(userA.page.getByRole("button", { name: "Edit profile" })).toBeVisible();

    await userA.page.reload();
    await expect(userA.page.getByText(bioText, { exact: true })).toBeVisible();
    await expect(userA.page.getByText("🌻", { exact: true }).first()).toBeVisible();

    // User B opens A's public page in a separate session.
    await userB.page.goto(`/people/${original.handle}`);
    await expect(userB.page.getByText(bioText, { exact: true })).toBeVisible();
    await expect(userB.page.getByText("🌻", { exact: true }).first()).toBeVisible();
  } finally {
    const sessionToken = await userA.page.evaluate(() =>
      window.localStorage.getItem("cahootz.sessionToken"),
    );
    if (sessionToken) {
      const cleanupResponse = await fetch(
        `${API_BASE_URL}/trpc/commons.updatePersonalPageProfile`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-session-token": sessionToken,
          },
          body: JSON.stringify({
            bio: original.bio ?? "",
            avatarUrl: original.avatarUrl,
            avatarEmoji: original.avatarEmoji,
            avatarColor: original.avatarColor,
          }),
        },
      );
      expect(cleanupResponse.ok).toBe(true);
    }
    await userA.context.close();
    await userB.context.close();
  }
});
