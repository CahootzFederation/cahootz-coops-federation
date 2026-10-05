import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { newSignedInPage } from "./support/auth";

const API_BASE_URL = process.env.E2E_API_BASE_URL || "http://localhost:3001";
const USER_A_EMAIL =
  process.env.E2E_USER_A_EMAIL || "releaseclick1@test.cahootz.local";
const USER_B_EMAIL =
  process.env.E2E_USER_B_EMAIL || "releaseclick2@test.cahootz.local";
const COOP_ID = "cahootz";

// A 1x1 PNG, so the fixture post carries a real image without uploading to
// blob storage.
const PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function sessionTokenFor(page: Page) {
  return page.evaluate(() =>
    window.localStorage.getItem("cahootz.sessionToken"),
  );
}

async function trpcPost(path: string, sessionToken: string, body: unknown) {
  const response = await fetch(`${API_BASE_URL}/trpc/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-session-token": sessionToken,
    },
    body: JSON.stringify(body),
  });
  return response.json();
}

test("a circle member browses the circle's photos in its gallery", async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const circleName = `E2E Gallery Circle ${runId}`;
  const postText = `E2E gallery photo ${runId}`;

  const userA = await newSignedInPage(browser, USER_A_EMAIL);
  const userB = await newSignedInPage(browser, USER_B_EMAIL);
  let groupId: string | undefined;
  let postId: string | undefined;

  try {
    const sessionTokenA = await sessionTokenFor(userA.page);
    const sessionTokenB = await sessionTokenFor(userB.page);
    expect(sessionTokenA).toBeTruthy();
    expect(sessionTokenB).toBeTruthy();

    // Fixture: A makes a private circle, B joins, A posts a photo there.
    const created = await trpcPost("groups.create", sessionTokenA!, {
      name: circleName,
      privacy: "private",
    });
    groupId = created?.result?.data?.group?.id;
    const inviteCode = created?.result?.data?.group?.inviteCode;
    expect(groupId).toBeTruthy();
    await trpcPost("groups.joinByCode", sessionTokenB!, { inviteCode });
    const posted = await trpcPost("commons.createPost", sessionTokenA!, {
      coopId: COOP_ID,
      circleId: groupId,
      content: postText,
      media: [
        {
          pathname: `e2e/gallery-${runId}.png`,
          url: PIXEL_PNG,
          mediaType: "image",
          mimeType: "image/png",
          fileName: "gallery.png",
          width: 1,
          height: 1,
        },
      ],
    });
    postId = posted?.result?.data?.post?.id;
    expect(postId).toBeTruthy();

    // B opens the circle and goes to its gallery from the header.
    const page = userB.page;
    await page.goto(`/${COOP_ID}/posts?circleId=${groupId}`);
    await page.getByLabel("Circle gallery").click();
    await expect(page.getByText("Gallery", { exact: true })).toBeVisible();
    await expect(
      page.getByText(circleName).filter({ visible: true }),
    ).toBeVisible();
    const tile = page.getByRole("button", { name: /^Open photo 1 from / });
    await expect(tile).toBeVisible();

    // The gallery survives a reload.
    await page.reload();
    await expect(tile).toBeVisible();

    // Tapping a photo opens it full screen, with a way to the post.
    await tile.click();
    await expect(page.getByLabel("Close media viewer")).toBeVisible();
    await page.getByRole("button", { name: "View post" }).click();
    await expect(page).toHaveURL(new RegExp(`/posts/${postId}`));
    await expect(page.getByText(postText).first()).toBeVisible();
  } finally {
    const sessionTokenA = await sessionTokenFor(userA.page).catch(() => null);
    const sessionTokenB = await sessionTokenFor(userB.page).catch(() => null);
    if (sessionTokenA && postId) {
      await trpcPost("commons.deletePost", sessionTokenA, { postId }).catch(
        () => {},
      );
    }
    if (groupId && sessionTokenB) {
      await trpcPost("groups.leave", sessionTokenB, { groupId }).catch(
        () => {},
      );
    }
    if (groupId && sessionTokenA) {
      await trpcPost("groups.leave", sessionTokenA, { groupId }).catch(
        () => {},
      );
    }
    await Promise.all([userA.context.close(), userB.context.close()]);
  }
});

test("a circle with no photos says so in its gallery", async ({ browser }) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const userA = await newSignedInPage(browser, USER_A_EMAIL);
  let groupId: string | undefined;

  try {
    const sessionTokenA = await sessionTokenFor(userA.page);
    const created = await trpcPost("groups.create", sessionTokenA!, {
      name: `E2E Empty Gallery ${runId}`,
      privacy: "private",
    });
    groupId = created?.result?.data?.group?.id;
    expect(groupId).toBeTruthy();

    await userA.page.goto(`/${COOP_ID}/gallery?circleId=${groupId}`);
    await expect(
      userA.page.getByText("No photos or videos yet"),
    ).toBeVisible();
  } finally {
    const sessionTokenA = await sessionTokenFor(userA.page).catch(() => null);
    if (groupId && sessionTokenA) {
      await trpcPost("groups.leave", sessionTokenA, { groupId }).catch(
        () => {},
      );
    }
    await userA.context.close();
  }
});
