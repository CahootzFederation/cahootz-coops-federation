import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { newSignedInPage, USER_A_EMAIL, USER_B_EMAIL } from "./support/auth";

// Sage's wake-and-wait loop, routed alerts, consent-first introductions and memory. Fixtures run the
// real service code (apps/api/scripts/e2e-sage-steward.ts); nothing here calls a live model, but
// creating a Commons post can wake Sage's reply agent, so the post journeys are tagged @sage.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const API_BASE_URL = process.env.E2E_API_BASE_URL || "http://localhost:3001";
const ADMIN_BASE_URL = process.env.E2E_ADMIN_BASE_URL || "http://localhost:3000";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || "e2e-admin@test.cahootz.local";
const COOP_ID = "cahootz";
const SERVER_POLL = { timeout: 30_000, intervals: [250, 500, 1_000] };

function fixture(script: string, ...args: string[]) {
  const output = execFileSync(
    "pnpm",
    ["--silent", "-F", "@cahootz/api", "exec", "tsx", "--import", "./dotenv.config.js", `scripts/${script}`, ...args],
    { cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000 },
  );
  const line = output.split("\n").reverse().find((entry) => entry.startsWith("E2E_RESULT "));
  if (!line) throw new Error(`${script} printed no result:\n${output}`);
  return JSON.parse(line.slice("E2E_RESULT ".length));
}
const steward = (...args: string[]) => fixture("e2e-sage-steward.ts", ...args);

async function sessionTokenFor(page: Page) {
  return page.evaluate(() => window.localStorage.getItem("cahootz.sessionToken"));
}

async function trpcPost(pathName: string, sessionToken: string, body: unknown) {
  const response = await fetch(`${API_BASE_URL}/trpc/${pathName}`, {
    method: "POST", headers: { "content-type": "application/json", "x-session-token": sessionToken }, body: JSON.stringify(body),
  });
  const text = await response.text();
  expect(response.ok, `${pathName} failed: ${text}`).toBe(true);
  return JSON.parse(text).result.data as any;
}

async function trpcGet(pathName: string, sessionToken: string, input: unknown) {
  const response = await fetch(`${API_BASE_URL}/trpc/${pathName}?input=${encodeURIComponent(JSON.stringify(input))}`, {
    headers: { "x-session-token": sessionToken },
  });
  const text = await response.text();
  expect(response.ok, `${pathName} failed: ${text}`).toBe(true);
  return JSON.parse(text).result.data as any;
}

function shown(page: Page, text: string | RegExp) {
  return page.getByText(text).locator("visible=true").first();
}

async function openFollowing(page: Page) {
  await page.goto("/sage");
  await page.getByRole("tab", { name: "Following" }).locator("visible=true").first().click();
}

// A member is followed up on: Sage's task shows under Following with why and when it will check back,
// one wake sends exactly one reminder, the member's reply closes the task, and a dismissed follow-up is
// not recreated. Then the platform admin sees the dismissal in the memory the steward's review read.
test("Sage follows up once, closes the task on reply, respects a dismissal and remembers it", { tag: "@sage" }, async ({ browser }) => {
  test.setTimeout(240_000);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const member = await newSignedInPage(browser, USER_B_EMAIL);
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  const postIds: string[] = [];
  const taskIds: string[] = [];
  let token: string | null = null;
  let stewardTrailId = "-";

  try {
    token = await sessionTokenFor(member.page);
    if (!token) throw new Error("Missing session token after sign-in");
    const replyTitle = `E2E ${runId} shared drivers`;
    const dismissTitle = `E2E ${runId} tool library`;
    for (const title of [replyTitle, dismissTitle]) {
      const created = await trpcPost("commons.createPost", token, { coopId: COOP_ID, title, content: `${title}: could member shops share this?`, tag: "Need" });
      postIds.push(created.post.id);
    }
    const first = steward("follow-up", USER_B_EMAIL, postIds[0]!, replyTitle, "--due");
    const second = steward("follow-up", USER_B_EMAIL, postIds[1]!, dismissTitle);
    // Sage's own reply to each post may have started the follow-up first; either way there's one open task.
    expect(first.taskId && second.taskId, JSON.stringify({ first, second })).toBeTruthy();
    taskIds.push(first.taskId, second.taskId);
    const dismissTaskTitle: string = second.title;

    // 1. Both follow-ups show under Following, with what Sage is waiting for and why.
    await openFollowing(member.page);
    const replyCard = member.page.getByTestId(`sage-task-${first.taskId}`);
    await expect(replyCard.getByText(first.title)).toBeVisible();
    await expect(replyCard.getByText(/^Waiting for you to /)).toBeVisible();
    await expect(replyCard.getByText(/^Why: /)).toBeVisible();
    await expect(replyCard.getByText(/Sage checks back/)).toBeVisible();

    // 2. A wake sends one reminder, and later wakes send nothing more. (The API's own wake loop may get
    //    there first; either way the member gets exactly one.)
    steward("wake");
    steward("wake");
    await openFollowing(member.page);
    await expect(replyCard.getByText(/Sage checks back .* one last time\./)).toBeVisible();
    await member.page.goto("/");
    await member.page.getByLabel("Alerts", { exact: true }).locator("visible=true").first().click();
    await expect(member.page.getByText("Sage is checking in").locator("visible=true")).toHaveCount(1);
    await shown(member.page, "Sage is checking in").click();
    await expect(member.page).toHaveURL(new RegExp(`/posts/${postIds[0]}`));

    // 3. The member replies in the thread; Sage sees it and closes the task.
    await member.page.getByPlaceholder("Write a comment...").locator("visible=true").first()
      .fill(`E2E ${runId}: Mon/Wed/Fri, and we pay a driver $650 a month.`);
    await member.page.getByLabel("Send comment").locator("visible=true").first().click();
    await expect(async () => {
      await openFollowing(member.page);
      await expect(member.page.getByTestId(`sage-task-${first.taskId}`)).toHaveCount(0, { timeout: 2_000 });
      await expect(shown(member.page, "Done · The member replied in the thread")).toBeVisible({ timeout: 2_000 });
    }).toPass(SERVER_POLL);

    // 4. The member dismisses the other follow-up; Sage won't start it again.
    await member.page.getByRole("button", { name: `Dismiss follow-up ${dismissTaskTitle}` }).click();
    await expect(member.page.getByTestId(`sage-task-${second.taskId}`)).toHaveCount(0);
    await expect(shown(member.page, "Dismissed · Dismissed by the member")).toBeVisible();
    expect(steward("follow-up", USER_B_EMAIL, postIds[1]!, dismissTitle)).toMatchObject({ created: false, reason: "The member dismissed this recently" });

    // 5. Memory: the steward's next review reads the dismissal, and the admin can see that in its trail.
    const review = steward("steward-review", runId);
    stewardTrailId = review.trailId ?? "-";
    expect(review).toMatchObject({ skipped: false, outcomes: [] });
    await admin.goto(`${ADMIN_BASE_URL}/portal/admin/login`);
    await admin.getByLabel("Email address").fill(ADMIN_EMAIL);
    await admin.getByRole("button", { name: "Email me a login code" }).click();
    await expect(admin.getByLabel("Login code")).toBeVisible();
    const { code } = fixture("e2e-admin.ts", "login-code", ADMIN_EMAIL);
    await admin.getByLabel("Login code").fill(code);
    await admin.getByRole("button", { name: "Verify & Sign In" }).click();
    await expect(admin).toHaveURL(/\/portal\/admin(?!\/login)/);
    await admin.goto(`${ADMIN_BASE_URL}/portal/admin/commons/${COOP_ID}/ai`);
    await expect(admin.getByRole("heading", { name: "Commons AI actions" })).toBeVisible({ timeout: 60_000 });
    await expect(admin.getByRole("region", { name: "Sage follow-ups" }).getByText(dismissTaskTitle).first()).toBeVisible();
    await admin.getByLabel("Filter decision trails by agent").selectOption({ label: "Steward review" });
    await admin.getByRole("button", { name: /Daily review: nothing needed/ }).first().click();
    await expect(admin.getByText(/things? Sage remembers/).first()).toBeVisible();
    await expect(admin.getByText(`[FOLLOW-UP DISMISSED] · `, { exact: false }).filter({ hasText: dismissTaskTitle }).first()).toBeVisible();
  } finally {
    steward("cleanup", runId, taskIds.join(",") || "-", "-", "-", stewardTrailId);
    for (const postId of postIds) {
      // Sage's own replies, actions and trails on the E2E post, then the post.
      fixture("e2e-agent-trails.ts", "cleanup-post", postId);
      if (token) await trpcPost("commons.deletePost", token, { postId }).catch(() => {});
    }
    await adminContext.close();
    await member.context.close();
  }
});

// Sage routes a circle matter to the person responsible: the circle's leader gets the alert with its
// evidence and why they got it, the other member doesn't, a duplicate is suppressed, and "Not for me"
// passes it on.
test("a routed alert reaches the circle leader with evidence, and Not for me passes it on", async ({ browser }) => {
  test.setTimeout(180_000);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const leader = await newSignedInPage(browser, USER_A_EMAIL);
  const member = await newSignedInPage(browser, USER_B_EMAIL);
  let circleId: string | undefined;
  let leaderToken: string | null = null;
  let memberToken: string | null = null;
  const title = `E2E ${runId} members asking about dues`;

  try {
    leaderToken = await sessionTokenFor(leader.page);
    memberToken = await sessionTokenFor(member.page);
    if (!leaderToken || !memberToken) throw new Error("Missing session token after sign-in");
    const { group } = await trpcPost("groups.create", leaderToken, { name: `E2E Dues circle ${runId}`, privacy: "invite-only" });
    circleId = group.id;
    await trpcPost("groups.joinByCode", memberToken, { inviteCode: group.inviteCode });

    const routed = steward("alert", circleId!, runId);
    expect(routed.first).toMatchObject({ status: "ROUTED", category: "CIRCLE_LEADER" });
    expect(routed.second).toMatchObject({ status: "DEDUPED" });

    // 1. The leader gets exactly one alert and opens it.
    await leader.page.goto("/");
    await leader.page.getByLabel("Alerts", { exact: true }).locator("visible=true").first().click();
    await expect(leader.page.getByText(title).locator("visible=true")).toHaveCount(1);
    await shown(leader.page, title).click();
    await expect(leader.page).toHaveURL(/\/sage\/alert\//);
    await expect(shown(leader.page, "What Sage saw")).toBeVisible();
    await expect(shown(leader.page, `“E2E ${runId}: does anyone know when circle dues are collected?”`)).toBeVisible();
    await expect(shown(leader.page, /You're getting this as the circle's leader\./)).toBeVisible();
    await expect(shown(leader.page, "Post a short note in the circle explaining when dues are collected.")).toBeVisible();

    // 2. The other member of the circle wasn't alerted.
    await member.page.goto("/");
    await member.page.getByLabel("Alerts", { exact: true }).locator("visible=true").first().click();
    await expect(member.page.getByText(title).locator("visible=true")).toHaveCount(0);

    // 3. "Not for me" passes it on and closes it for the leader, including after a reload.
    await leader.page.getByRole("button", { name: "Not for me" }).click();
    await leader.page.getByLabel("Who should get this instead (optional)").fill(`E2E ${runId}: the treasurer handles dues`);
    await leader.page.getByRole("button", { name: "Pass it on" }).click();
    await expect(shown(leader.page, /^Thanks\. Sage (passed this to the next person responsible|sent this to the platform team)/)).toBeVisible();
    await leader.page.reload();
    await expect(shown(leader.page, "You passed this on. Sage sent it to the next person responsible.")).toBeVisible();
    await expect(leader.page.getByRole("button", { name: "Got it" })).toHaveCount(0);
  } finally {
    steward("cleanup", runId, "-", circleId ?? "-", "-", "-");
    if (circleId) {
      if (memberToken) await trpcPost("groups.leave", memberToken, { groupId: circleId }).catch(() => {});
      if (leaderToken) await trpcPost("groups.leave", leaderToken, { groupId: circleId }).catch(() => {});
    }
    await leader.context.close();
    await member.context.close();
  }
});

// Bridge's introduction is consent-first: the member with the need is asked first, the helper only after,
// and a private Introduction circle for just the two of them exists only once both say yes.
test("an introduction needs both members' consent before Sage makes a private circle", async ({ browser }) => {
  test.setTimeout(180_000);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const need = await newSignedInPage(browser, USER_A_EMAIL);
  const helper = await newSignedInPage(browser, USER_B_EMAIL);
  let actionId = "-";

  try {
    const needToken = await sessionTokenFor(need.page);
    const helperToken = await sessionTokenFor(helper.page);
    if (!needToken || !helperToken) throw new Error("Missing session token after sign-in");
    const intro = steward("introduce", USER_A_EMAIL, USER_B_EMAIL, runId);
    expect(intro.created, JSON.stringify(intro)).toBe(true);
    actionId = intro.actionId;

    // 1. The helper isn't asked yet.
    const helperNeeds = await trpcGet("sage.list", helperToken, { coopId: COOP_ID, tab: "NEEDS_YOU" });
    expect(JSON.stringify(helperNeeds)).not.toContain(actionId);

    // 2. The member with the need accepts first.
    await need.page.goto(`/sage/${actionId}`);
    await expect(shown(need.page, "Sage can introduce you")).toBeVisible();
    await need.page.getByRole("button", { name: "Approve" }).click();

    // 3. Now the helper is asked, and accepts.
    await expect(async () => {
      await helper.page.goto(`/sage/${actionId}`);
      await expect(helper.page.getByRole("button", { name: "Approve" })).toBeVisible({ timeout: 3_000 });
    }).toPass(SERVER_POLL);
    await expect(shown(helper.page, "Sage can introduce you")).toBeVisible();
    await helper.page.getByRole("button", { name: "Approve" }).click();

    // 4. A private Introduction circle with exactly the two of them.
    await expect(async () => {
      await helper.page.reload();
      await expect(shown(helper.page, "Done")).toBeVisible({ timeout: 3_000 });
    }).toPass(SERVER_POLL);
    const { groups } = await trpcGet("groups.listMine", needToken, { coopId: COOP_ID });
    const circle = groups.find((group: { name: string }) => group.name === "Introduction");
    expect(circle, "the Introduction circle should exist for the member with the need").toBeTruthy();
    const { members } = await trpcGet("groups.getDetail", helperToken, { groupId: circle.id });
    expect(members).toHaveLength(2);
  } finally {
    steward("cleanup", runId, "-", "-", actionId, "-");
    await need.context.close();
    await helper.context.close();
  }
});
