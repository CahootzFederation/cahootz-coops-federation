import { expect, test, type Page, type Route } from "@playwright/test";

import { newSignedInPage, USER_A_EMAIL } from "./support/auth";

// When a screen fails to load, members (many of them older or new to
// smartphones) must see a plain sentence and a "Try again" button - never
// a raw validation dump or an internal server message, and never an empty
// screen that looks like "nothing here yet". These journeys force a load
// failure with a faked tRPC error, check what the member sees, then let the
// real API answer again and use "Try again" to recover.

/**
 * Visible text only. Expo Router keeps earlier screens of a stack mounted
 * (hidden), so the same text can exist on a screen underneath.
 */
function shown(page: Page, text: string | RegExp, options?: { exact?: boolean }) {
  return page.getByText(text, options).filter({ visible: true });
}

function tryAgain(page: Page) {
  return page.getByRole("button", { name: "Try again" }).filter({ visible: true });
}

/** Matches exactly one tRPC procedure, not others that share its prefix. */
function procedure(name: string) {
  return (url: URL) => url.pathname === `/trpc/${name}`;
}

/**
 * Answers with a tRPC error body shaped like the real API's. The real
 * request still goes out first so the response keeps the API's CORS
 * headers; only its status and body are replaced.
 */
async function fulfillTrpcError(
  route: Route,
  error: { message: string; code: string; httpStatus: number },
) {
  // Leave the browser's CORS preflight alone; only fake the real call.
  if (route.request().method() === "OPTIONS") {
    await route.continue();
    return;
  }
  const response = await route.fetch();
  await route.fulfill({
    response,
    status: error.httpStatus,
    contentType: "application/json",
    body: JSON.stringify({
      error: {
        message: error.message,
        code: -32600,
        data: { code: error.code, httpStatus: error.httpStatus },
      },
    }),
  });
}

const RAW_VALIDATION_DUMP = JSON.stringify(
  [
    {
      code: "invalid_type",
      expected: "string",
      received: "undefined",
      path: ["coopId"],
      message: "Required",
    },
  ],
  null,
  2,
);

test("Circle View says plainly when circles fail to load and recovers with Try again", async ({
  browser,
}) => {
  const { context, page } = await newSignedInPage(browser, USER_A_EMAIL);
  const listVisible = procedure("groups.listVisible");

  try {
    await page.route(listVisible, (route) =>
      fulfillTrpcError(route, {
        message: "SC token address not configured for coop: cahootz",
        code: "INTERNAL_SERVER_ERROR",
        httpStatus: 500,
      }),
    );
    await page.reload();

    await expect(shown(page, "Welcome In", { exact: true })).toBeVisible();
    await expect(
      shown(page, "We couldn't load your circles. Please try again."),
    ).toBeVisible();
    await expect(tryAgain(page)).toBeVisible();
    // The big button is easy to tap.
    const box = await tryAgain(page).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

    // No developer text, and no grid pretending there's nothing to join.
    await expect(shown(page, /not configured|token address|cahootz:/i)).toHaveCount(0);
    await expect(shown(page, "General", { exact: true })).toHaveCount(0);

    // Let the real API answer again.
    await page.unroute(listVisible);
    const reloaded = page.waitForResponse(
      (response) => listVisible(new URL(response.url())) && response.ok(),
    );
    await tryAgain(page).click();
    await reloaded;

    await expect(shown(page, "General", { exact: true })).toBeVisible();
    await expect(shown(page, /We couldn't load your circles/)).toHaveCount(0);
    await expect(tryAgain(page)).toHaveCount(0);
  } finally {
    await context.close();
  }
});

// A validation dump on a load gets the screen's own message: the member
// typed nothing, so "check what you entered" would be wrong.
const PROPOSALS_FALLBACK = "We couldn't load proposals. Please try again.";

test("the proposals list hides a raw validation error and recovers with Try again", async ({
  browser,
}) => {
  const { context, page } = await newSignedInPage(browser, USER_A_EMAIL);
  const listProposals = procedure("proposal.list");

  try {
    await page.route(listProposals, (route) =>
      fulfillTrpcError(route, {
        message: RAW_VALIDATION_DUMP,
        code: "BAD_REQUEST",
        httpStatus: 400,
      }),
    );
    await page.goto("/proposals?coopId=cahootz");

    await expect(shown(page, "Turn conversations into decisions")).toBeVisible();
    await expect(shown(page, PROPOSALS_FALLBACK)).toBeVisible();
    await expect(tryAgain(page)).toBeVisible();

    // The zod dump never reaches the screen, and a failed load isn't
    // presented as an empty list.
    await expect(shown(page, /invalid_type|"expected"|coopId|Required/)).toHaveCount(0);
    await expect(shown(page, "No proposals yet", { exact: true })).toHaveCount(0);

    await page.unroute(listProposals);
    const reloaded = page.waitForResponse(
      (response) => listProposals(new URL(response.url())) && response.ok(),
    );
    await tryAgain(page).click();
    const body = await (await reloaded).json();
    const proposals: { title: string }[] = body?.result?.data?.proposals ?? [];

    await expect(shown(page, PROPOSALS_FALLBACK)).toHaveCount(0);
    await expect(tryAgain(page)).toHaveCount(0);
    if (proposals.length === 0) {
      await expect(shown(page, "No proposals yet", { exact: true })).toBeVisible();
    } else {
      await expect(shown(page, proposals[0].title, { exact: true }).first()).toBeVisible();
    }

    // The recovered state survives a reload.
    await page.reload();
    await expect(shown(page, "Turn conversations into decisions")).toBeVisible();
    await expect(tryAgain(page)).toHaveCount(0);
  } finally {
    await context.close();
  }
});
