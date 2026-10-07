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

// Members react to posts and comments with any emoji, Slack-style, not just a
// like: User B adds 🎉 to User A's post from the full picker's search and 🔥 to
// A's comment from the quick reactions, alongside a like. User A sees both
// after reload and joins B's 🎉, which then counts 2 for both of them.
test("two members react to a post and a comment with emoji", async ({ browser }) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const author = await newSignedInPage(browser, USER_A_EMAIL);
  const reactor = await newSignedInPage(browser, USER_B_EMAIL);
  let postId: string | undefined;
  let token: string | null = null;

  try {
    token = await sessionTokenFor(author.page);
    expect(token).toBeTruthy();
    const created = await trpcPost("commons.createPost", token!, {
      coopId: COOP_ID,
      title: `E2E ${runId} reactions`,
      content: `E2E ${runId}: react to this with anything`,
      tag: "Social",
    });
    postId = created?.post?.id;
    expect(postId).toBeTruthy();
    const comment = await trpcPost("commons.createComment", token!, {
      postId,
      content: `E2E ${runId} comment to react to`,
    });
    const commentId: string = comment?.comment?.id;
    expect(commentId).toBeTruthy();

    // User B: 🎉 on the post, found by searching the full picker.
    const b = reactor.page;
    await b.goto(`/${COOP_ID}/posts/${postId}`);
    await expect(b.getByText(`E2E ${runId}: react to this with anything`)).toBeVisible();
    await b.getByRole("button", { name: "Add a reaction to this post", exact: true }).click();
    const picker = b.getByTestId("emoji-picker");
    await expect(picker).toBeVisible();
    await expect(picker.getByRole("tab", { name: "Smileys" })).toBeVisible();
    await picker.getByRole("textbox", { name: "Search emoji" }).fill("party");
    await picker
      .getByTestId("emoji-picker-grid")
      .getByRole("button", { name: "party popper", exact: true })
      .click();
    await expect(picker).toBeHidden();
    await expect(
      b.getByRole("button", {
        name: "Remove your party popper reaction from this post, 1 reaction",
      }),
    ).toBeVisible();

    // ...then likes A's comment and adds 🔥 from the quick reactions.
    const bComment = b.getByTestId(`comment-${commentId}`);
    await bComment.getByRole("button", { name: /^Like .+'s comment, 0 likes$/ }).click();
    await expect(
      bComment.getByRole("button", { name: /^Remove your like from .+'s comment, 1 like$/ }),
    ).toBeVisible();
    await bComment.getByRole("button", { name: /^Add a reaction to .+'s comment$/ }).click();
    await expect(picker).toBeVisible();
    await picker.getByRole("button", { name: "fire", exact: true }).first().click();
    await expect(picker).toBeHidden();
    const bFire = bComment.getByRole("button", {
      name: /^Remove your fire reaction from .+'s comment, 1 reaction$/,
    });
    await expect(bFire).toBeVisible();

    await b.reload();
    await expect(
      b.getByRole("button", {
        name: "Remove your party popper reaction from this post, 1 reaction",
      }),
    ).toBeVisible();
    await expect(bFire).toBeVisible();
    await expect(
      bComment.getByRole("button", { name: /^Remove your like from .+'s comment, 1 like$/ }),
    ).toBeVisible();

    // User A sees B's reactions and joins the 🎉 with one tap on its chip.
    const a = author.page;
    await a.goto(`/${COOP_ID}/posts/${postId}`);
    const aComment = a.getByTestId(`comment-${commentId}`);
    await expect(
      aComment.getByRole("button", { name: /^Add fire reaction to .+'s comment, 1 reaction$/ }),
    ).toBeVisible();
    await a
      .getByRole("button", { name: "Add party popper reaction to this post, 1 reaction" })
      .click();
    const aParty = a.getByRole("button", {
      name: "Remove your party popper reaction from this post, 2 reactions",
    });
    await expect(aParty).toBeVisible();
    await a.reload();
    await expect(aParty).toBeVisible();

    await b.reload();
    await expect(
      b.getByRole("button", {
        name: "Remove your party popper reaction from this post, 2 reactions",
      }),
    ).toBeVisible();
  } finally {
    if (postId && token) {
      await trpcPost("commons.deletePost", token, { postId }).catch(() => {});
    }
    await author.context.close();
    await reactor.context.close();
  }
});
