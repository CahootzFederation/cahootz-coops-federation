import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { newSignedInPage } from "./support/auth";

const API_BASE_URL = process.env.E2E_API_BASE_URL || "http://localhost:3001";
const USER_A_EMAIL =
  process.env.E2E_USER_A_EMAIL || "releaseclick1@test.cahootz.local";
const USER_B_EMAIL =
  process.env.E2E_USER_B_EMAIL || "releaseclick2@test.cahootz.local";
const COOP_ID = "cahootz";

// A 1x1 PNG, so the fixture posts carry a real image without uploading to
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

async function postPhoto(
  sessionToken: string,
  title: string,
  runId: string,
  circleId?: string,
) {
  const posted = await trpcPost("commons.createPost", sessionToken, {
    coopId: COOP_ID,
    ...(circleId ? { circleId } : {}),
    title,
    content: title,
    media: [
      {
        pathname: `e2e/commons-gallery-${runId}-${title.length}-${circleId ?? "general"}.png`,
        url: PIXEL_PNG,
        mediaType: "image",
        mimeType: "image/png",
        fileName: "gallery.png",
        width: 1,
        height: 1,
      },
    ],
  });
  const postId: string | undefined = posted?.result?.data?.post?.id;
  expect(postId).toBeTruthy();
  return postId!;
}

test("the commons gallery shows General and public-circle photos, never private ones", async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const publicCircleName = `E2E Gallery Public ${runId}`;
  const generalTitle = `E2E gallery general ${runId}`;
  const publicTitle = `E2E gallery public ${runId}`;
  const privateTitle = `E2E gallery private ${runId}`;

  const userA = await newSignedInPage(browser, USER_A_EMAIL);
  const userB = await newSignedInPage(browser, USER_B_EMAIL);
  const groupIds: string[] = [];
  const postIds: string[] = [];

  try {
    const sessionTokenA = await sessionTokenFor(userA.page);
    const sessionTokenB = await sessionTokenFor(userB.page);
    expect(sessionTokenA).toBeTruthy();
    expect(sessionTokenB).toBeTruthy();

    // Fixture: A makes a public circle and a private one (B joins neither)
    // and posts a photo in each, plus one in General.
    const publicCircle = await trpcPost("groups.create", sessionTokenA!, {
      name: publicCircleName,
      privacy: "public",
    });
    const privateCircle = await trpcPost("groups.create", sessionTokenA!, {
      name: `E2E Gallery Private ${runId}`,
      privacy: "private",
    });
    const publicId = publicCircle?.result?.data?.group?.id;
    const privateId = privateCircle?.result?.data?.group?.id;
    expect(publicId).toBeTruthy();
    expect(privateId).toBeTruthy();
    groupIds.push(publicId, privateId);
    postIds.push(await postPhoto(sessionTokenA!, generalTitle, runId));
    postIds.push(await postPhoto(sessionTokenA!, publicTitle, runId, publicId));
    postIds.push(await postPhoto(sessionTokenA!, privateTitle, runId, privateId));

    // B opens the commons gallery from the circles screen header.
    const page = userB.page;
    await page.goto("/");
    await page.getByLabel("Commons gallery").click();
    await expect(page.getByText("Gallery", { exact: true })).toBeVisible();
    const publicTile = page.getByRole("button", {
      name: new RegExp(`^Open photo from .*: ${publicTitle}$`),
    });
    const generalTile = page.getByRole("button", {
      name: new RegExp(`^Open photo from .*: ${generalTitle}$`),
    });
    await expect(publicTile).toBeVisible();
    await expect(generalTile).toBeVisible();
    await expect(
      page.getByRole("button", { name: new RegExp(privateTitle) }),
    ).toHaveCount(0);

    // The gallery survives a reload.
    await page.reload();
    await expect(publicTile).toBeVisible();
    await expect(
      page.getByRole("button", { name: new RegExp(privateTitle) }),
    ).toHaveCount(0);

    // A public-circle photo opens full screen, says where it came from, and
    // links to its post.
    await publicTile.click();
    await expect(page.getByLabel("Close media viewer")).toBeVisible();
    await expect(
      page.getByText(`${publicCircleName} · ${publicTitle}`),
    ).toBeVisible();
    await page.getByRole("button", { name: "View post" }).click();
    await expect(page).toHaveURL(new RegExp(`/posts/${postIds[1]}`));
    await expect(page.getByText(publicTitle).first()).toBeVisible();

    // The General feed header opens the same gallery.
    await page.goto(`/${COOP_ID}/posts`);
    await page.getByLabel("Commons gallery").click();
    await expect(generalTile).toBeVisible();
  } finally {
    const sessionTokenA = await sessionTokenFor(userA.page).catch(() => null);
    if (sessionTokenA) {
      for (const postId of postIds) {
        await trpcPost("commons.deletePost", sessionTokenA, { postId }).catch(
          () => {},
        );
      }
      for (const groupId of groupIds) {
        await trpcPost("groups.leave", sessionTokenA, { groupId }).catch(
          () => {},
        );
      }
    }
    await Promise.all([userA.context.close(), userB.context.close()]);
  }
});
