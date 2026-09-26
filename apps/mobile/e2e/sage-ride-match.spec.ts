import { expect, test } from "@playwright/test";
import { newSignedInPage } from "./support/auth";

const API_BASE_URL = process.env.E2E_API_BASE_URL || "http://localhost:3001";
const USER_A_EMAIL = process.env.E2E_USER_A_EMAIL || "releaseclick1@test.cahootz.local"; // Maya
const USER_B_EMAIL = process.env.E2E_USER_B_EMAIL || "releaseclick2@test.cahootz.local"; // Jordan
const CIRCLE_WINDOW_MESSAGE_LIMIT = 40;
// Check often so the test moves on as soon as the result lands, instead of
// sleeping a fixed 2-5s between checks.
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

// Two isolated accounts complete Sage's ride-match example end to end: Sage notices a ride
// need in a shared circle, Maya provides context and consents to a limited match, Jordan
// accepts, and a new private circle with exactly the two of them is created.
test("two members complete a Sage ride-match suggestion and get a private circle", { tag: "@sage" }, async ({ browser }) => {
  test.setTimeout(240_000); // seeds 40 messages sequentially and polls a live model call, not a fixed UI wait
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const rideNeedText = `E2E ${runId}: I really need a ride to the Saturday farmers market, my car is in the shop.`;
  const rideOfferText = `E2E ${runId}: I can give a ride Saturday morning if anyone needs one, I have room in my car.`;

  const maya = await newSignedInPage(browser, USER_A_EMAIL);
  const jordan = await newSignedInPage(browser, USER_B_EMAIL);
  let circleId: string | undefined;
  let matchCircleId: string | undefined;

  try {
    const mayaToken = await sessionTokenFor(maya.page);
    const jordanToken = await sessionTokenFor(jordan.page);
    if (!mayaToken || !jordanToken) throw new Error("Missing session token after sign-in");

    // Fixture setup via direct API calls, per CLAUDE.md: a shared circle both are members of.
    const { group } = await trpcPost("groups.create", mayaToken, { name: `E2E ride circle ${runId}`, privacy: "invite-only" });
    circleId = group.id;
    await trpcPost("groups.joinByCode", jordanToken, { inviteCode: group.inviteCode });
    const { members: fixtureCircleMembers } = await trpcGet("groups.getDetail", mayaToken, { groupId: circleId });
    const [mayaUserId, jordanUserId] = fixtureCircleMembers
      .map((m: { userId: string; isLeader: boolean }) => m)
      .sort((a: { isLeader: boolean }, b: { isLeader: boolean }) => Number(b.isLeader) - Number(a.isLeader))
      .map((m: { userId: string }) => m.userId);

    // Jordan's ride offer is what the deterministic matcher will find later.
    await trpcPost("groups.addComment", jordanToken, { groupId: circleId, content: rideOfferText });
    // Fill the rest of the window with filler chatter so the 40th message closes it and
    // hands the window to Sage's real (unmocked) detection pipeline.
    for (let i = 0; i < CIRCLE_WINDOW_MESSAGE_LIMIT - 2; i++) {
      const sender = i % 2 === 0 ? mayaToken : jordanToken;
      await trpcPost("groups.addComment", sender, { groupId: circleId, content: `E2E ${runId}: chatting about the weekend, message ${i}.` });
    }
    // This is message #40 - it closes the window and (in local/dev, without Trigger.dev
    // configured) kicks off Sage's real ride-match detection against a live model.
    await trpcPost("groups.addComment", mayaToken, { groupId: circleId, content: rideNeedText });

    // Detection runs asynchronously - poll Maya's Needs You tab for it.
    let suggestionId: string | undefined;
    await expect.poll(async () => {
      const { suggestions } = await trpcGet("sage.list", mayaToken, { tab: "NEEDS_YOU" });
      // Trend detection runs on the same closed window and can also land a
      // suggestion for this circle in Maya's queue - pick the ride match.
      suggestionId = suggestions.find((s: { circleId: string | null; type: string }) =>
        s.circleId === circleId && s.type === "RIDE_MATCH_PROPOSAL")?.id;
      return suggestionId;
    }, { message: "Sage never surfaced a ride-match suggestion for this window", ...SAGE_POLL }).toBeTruthy();

    // Maya reviews through the real full-page UI (never a modal) and provides context.
    await maya.page.goto(`/sage/${suggestionId}`);
    await expect(maya.page.getByRole("button", { name: "Approve" })).toBeVisible();
    await maya.page.getByLabel("General area").fill("Downtown");
    await maya.page.getByLabel("Time window").fill("Saturday morning");
    await maya.page.getByLabel("What's OK to share").fill("My general area and the time window");
    await maya.page.getByRole("button", { name: "Approve" }).click();

    // Sage's deterministic matcher found Jordan's offer - Maya gets a new consent review.
    await expect(maya.page.getByText(/Confirm what to share/i)).toBeVisible({ timeout: 15000 });
    await maya.page.getByRole("button", { name: "Approve" }).click();

    // Jordan gets the match invitation with only what Maya approved sharing. The approve click above
    // only waits for the click to register, not for its mutation to finish server-side, so poll.
    let jordanSuggestion: { id: string } | undefined;
    await expect.poll(async () => {
      const { suggestions: jordanNeedsYou } = await trpcGet("sage.list", jordanToken, { tab: "NEEDS_YOU" });
      jordanSuggestion = jordanNeedsYou.find((s: { circleId: string | null; type: string }) =>
        s.circleId === circleId && s.type === "RIDE_MATCH_PROPOSAL");
      return jordanSuggestion;
    }, { message: "Jordan should have a pending Sage review after Maya consents", ...SERVER_POLL }).toBeTruthy();
    await jordan.page.goto(`/sage/${jordanSuggestion!.id}`);
    await expect(jordan.page.getByText(/could use your help/i)).toBeVisible();
    await jordan.page.getByRole("button", { name: "Approve" }).click();

    // Both land in Done, and a private circle with exactly Maya + Jordan was created. Again, the
    // click above only waits for the click itself, not for execution to finish server-side, so poll.
    let matchCircle: { id: string; name: string } | undefined;
    await expect.poll(async () => {
      const { groups: mayaCircles } = await trpcGet("groups.listVisible", mayaToken, { coopId: "cahootz" });
      matchCircle = mayaCircles.find((c: { name: string }) => c.name === "Ride match");
      return matchCircle;
    }, { message: "A new 'Ride match' private circle should exist", ...SERVER_POLL }).toBeTruthy();
    matchCircleId = matchCircle!.id;

    const [{ suggestions: jordanDone }, { suggestions: mayaDone }] = await Promise.all([
      trpcGet("sage.list", jordanToken, { tab: "DONE" }),
      trpcGet("sage.list", mayaToken, { tab: "DONE" }),
    ]);
    expect(jordanDone.some((s: { id: string }) => s.id === jordanSuggestion!.id)).toBe(true);
    expect(mayaDone.some((s: { id: string }) => s.id === suggestionId)).toBe(true);
    const { members } = await trpcGet("groups.getDetail", mayaToken, { groupId: matchCircleId });
    expect((members as Array<{ userId: string }>).map((m) => m.userId).sort()).toEqual([mayaUserId, jordanUserId].sort());
  } finally {
    const mayaToken = await sessionTokenFor(maya.page).catch(() => null);
    const jordanToken = await sessionTokenFor(jordan.page).catch(() => null);
    // Maya is the leader of both circles - she can only leave once she's the sole
    // remaining member (which then deletes the group), so Jordan must leave first.
    for (const groupId of [circleId, matchCircleId]) {
      if (!groupId) continue;
      if (jordanToken) await trpcPost("groups.leave", jordanToken, { groupId }).catch(() => {});
      if (mayaToken) await trpcPost("groups.leave", mayaToken, { groupId }).catch(() => {});
    }
    await maya.context.close();
    await jordan.context.close();
  }
});
