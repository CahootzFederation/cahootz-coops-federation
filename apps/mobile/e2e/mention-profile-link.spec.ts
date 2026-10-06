import { expect, test, type Page } from "@playwright/test";
import { newSignedInPage } from "./support/auth";

const API_BASE_URL = process.env.E2E_API_BASE_URL || "http://localhost:3001";
const USER_A_EMAIL =
  process.env.E2E_USER_A_EMAIL || "releaseclick1@test.cahootz.local";
const USER_B_EMAIL =
  process.env.E2E_USER_B_EMAIL || "releaseclick2@test.cahootz.local";
const COOP_ID = "cahootz";

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
  const json = await response.json();
  return json?.result?.data;
}

async function personalPageName(handle: string): Promise<string> {
  const input = encodeURIComponent(JSON.stringify({ handle, limit: 1 }));
  const response = await fetch(
    `${API_BASE_URL}/trpc/commons.getPersonalPage?input=${input}`,
  );
  const json = await response.json();
  return json.result.data.profile.name;
}

test("tapping an @mention in a post opens that member's personal page", async ({
  browser,
}) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const mentionedHandle = USER_B_EMAIL.split("@")[0].replace(/[^a-z0-9]+/gi, "").toLowerCase();
  const mentionedName = await personalPageName(mentionedHandle);

  const author = await newSignedInPage(browser, USER_A_EMAIL);
  let postId: string | undefined;
  let token: string | null = null;

  try {
    token = await sessionTokenFor(author.page);
    expect(token).toBeTruthy();
    const created = await trpcPost("commons.createPost", token!, {
      coopId: COOP_ID,
      title: `E2E ${runId} mention link`,
      content: `E2E ${runId}: thanks @${mentionedHandle} for the help`,
      tag: "Social",
    });
    postId = created?.post?.id;
    expect(postId).toBeTruthy();

    await author.page.goto(`/${COOP_ID}/posts/${postId}`);
    const mention = author.page
      .getByRole("link", { name: `@${mentionedHandle}`, exact: true })
      .locator("visible=true")
      .first();
    await expect(mention).toBeVisible();
    await mention.click();

    await expect(author.page).toHaveURL(new RegExp(`/people/${mentionedHandle}`));
    await expect(
      author.page.getByText(mentionedName, { exact: true }).locator("visible=true").first(),
    ).toBeVisible();
  } finally {
    if (postId && token) {
      await trpcPost("commons.deletePost", token, { postId }).catch(() => {});
    }
    await author.context.close();
  }
});
