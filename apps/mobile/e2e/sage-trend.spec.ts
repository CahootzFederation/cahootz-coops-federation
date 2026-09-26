import { expect, test } from "@playwright/test";
import { newSignedInPage } from "./support/auth";

const API_BASE_URL = process.env.E2E_API_BASE_URL || "http://localhost:3001";
const USER_A_EMAIL = process.env.E2E_USER_A_EMAIL || "releaseclick1@test.cahootz.local"; // circle leader
const USER_B_EMAIL = process.env.E2E_USER_B_EMAIL || "releaseclick2@test.cahootz.local";
const CIRCLE_WINDOW_MESSAGE_LIMIT = 40;
// Check often so the test moves on as soon as the result lands, instead of
// sleeping a fixed 3-5s between checks.
const SAGE_POLL = { timeout: 90_000, intervals: [1_000, 2_000, 3_000] }; // live model call
const SERVER_POLL = { timeout: 30_000, intervals: [250, 500, 1_000] }; // async server work

async function sessionTokenFor(page: import("@playwright/test").Page) {
  return page.evaluate(() => window.localStorage.getItem("cahootz.sessionToken"));
}

async function trpcPost(path: string, sessionToken: string, body: unknown) {
  const response = await fetch(`${API_BASE_URL}/trpc/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-session-token": sessionToken },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  expect(response.ok, `${path} failed: ${text}`).toBe(true);
  return JSON.parse(text).result.data as any;
}

async function trpcGet(path: string, sessionToken: string, input: unknown) {
  const encoded = encodeURIComponent(JSON.stringify(input));
  const response = await fetch(`${API_BASE_URL}/trpc/${path}?input=${encoded}`, {
    headers: { "x-session-token": sessionToken },
  });
  const text = await response.text();
  expect(response.ok, `${path} failed: ${text}`).toBe(true);
  return JSON.parse(text).result.data as any;
}

// A circle leader receives a Sage trend suggestion (an event, a post to the circle, or a post to the
// whole Commons - whichever the model judges fits) after a window of conversation about a recurring
// topic closes, and approving it through the real UI actually publishes something.
test("a circle leader receives and approves a Sage trend suggestion", { tag: "@sage" }, async ({ browser }) => {
  test.setTimeout(240_000); // seeds 40 messages sequentially and polls a live model call, not a fixed UI wait
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const leader = await newSignedInPage(browser, USER_A_EMAIL);
  const member = await newSignedInPage(browser, USER_B_EMAIL);
  let circleId: string | undefined;

  try {
    const leaderToken = await sessionTokenFor(leader.page);
    const memberToken = await sessionTokenFor(member.page);
    if (!leaderToken || !memberToken) throw new Error("Missing session token after sign-in");

    const { group } = await trpcPost("groups.create", leaderToken, { name: `E2E trend circle ${runId}`, privacy: "invite-only" });
    circleId = group.id;
    await trpcPost("groups.joinByCode", memberToken, { inviteCode: group.inviteCode });

    // Seed a clear, recurring theme (wanting a cleanup day) across the window so Sage has something
    // concrete to notice, rather than generic chatter.
    const themedLines = [
      `E2E ${runId}: it would be great if we did a neighborhood cleanup day sometime soon.`,
      `E2E ${runId}: I keep meaning to bring up organizing a cleanup day for the block.`,
      `E2E ${runId}: a cleanup day would be awesome, count me in if it happens.`,
      `E2E ${runId}: does anyone else think we should finally do that cleanup day?`,
    ];
    for (let i = 0; i < CIRCLE_WINDOW_MESSAGE_LIMIT - 1; i++) {
      const token = i % 2 === 0 ? leaderToken : memberToken;
      const content = i < themedLines.length ? themedLines[i] : `E2E ${runId}: chatting, message ${i}.`;
      await trpcPost("groups.addComment", token, { groupId: circleId, content });
    }
    // Message #40 closes the window and kicks off both detection passes (ride-match and trend).
    await trpcPost("groups.addComment", leaderToken, { groupId: circleId, content: `E2E ${runId}: ok last thought - a cleanup day, who's with me?` });

    let suggestionId: string | undefined;
    await expect.poll(async () => {
      const { suggestions } = await trpcGet("sage.list", leaderToken, { tab: "NEEDS_YOU" });
      // Ride-match detection runs on the same closed window; pick the trend suggestion.
      suggestionId = suggestions.find((s: { circleId: string | null; type: string }) =>
        s.circleId === circleId && s.type === "SUGGEST_ACTION")?.id;
      return suggestionId;
    }, { message: "Sage never surfaced a trend suggestion for this window", ...SAGE_POLL }).toBeTruthy();

    await leader.page.goto(`/sage/${suggestionId}`);
    await expect(leader.page.getByText(/Sage has an idea/i)).toBeVisible();
    await expect(leader.page.getByRole("button", { name: "Approve" })).toBeVisible();
    await leader.page.getByRole("button", { name: "Approve" }).click();

    // Approving is async (Trigger execution) - poll Done instead of asserting immediately.
    await expect.poll(async () => {
      const { suggestions } = await trpcGet("sage.list", leaderToken, { tab: "DONE" });
      return suggestions.some((s: { id: string }) => s.id === suggestionId);
    }, { message: "Suggestion should reach Done after approval", ...SERVER_POLL }).toBe(true);

    const detail = await trpcGet("sage.getDetail", leaderToken, { actionId: suggestionId });
    expect(detail.suggestion.status).toBe("APPROVED");
    expect(detail.auditEvents.some((event: { description: string }) => event.description === "Sage completed the suggestion")).toBe(true);
  } finally {
    const leaderToken = await sessionTokenFor(leader.page).catch(() => null);
    const memberToken = await sessionTokenFor(member.page).catch(() => null);
    if (circleId) {
      if (memberToken) await trpcPost("groups.leave", memberToken, { groupId: circleId }).catch(() => {});
      if (leaderToken) await trpcPost("groups.leave", leaderToken, { groupId: circleId }).catch(() => {});
    }
    await leader.context.close();
    await member.context.close();
  }
});
