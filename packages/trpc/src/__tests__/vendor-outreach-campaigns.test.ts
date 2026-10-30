import { beforeEach, describe, expect, it, vi } from "vitest";

const emailState = vi.hoisted(() => ({ ready: false }));
vi.mock("../lib/email.js", () => ({
  outreachEmailReady: () => emailState.ready,
  sendVendorOutreachEmail: vi.fn(async () => ({ id: "re_sent" })),
}));
vi.mock("../services/slack-notification-service.js", () => ({ sendSlackNotification: vi.fn(async () => true) }));
vi.mock("../services/sage-autonomy.js", () => ({ sageAutonomyAllowed: vi.fn(async () => true) }));

import { sendVendorOutreachEmail } from "../lib/email.js";
import { sendSlackNotification } from "../services/slack-notification-service.js";
import {
  approveCampaign,
  checkOutreachText,
  loadReplyPage,
  moveCampaign,
  outreachFunnel,
  proposeCampaigns,
  recordVendorResponse,
  unsubscribeByToken,
  updateProspect,
} from "../services/vendor-outreach/index.js";
import { discoverForCampaign } from "../services/vendor-outreach/discovery.js";
import { buildOutreachEmail, hashReplyToken, replyToken } from "../services/vendor-outreach/email-builder.js";
import { inSendingWindow, runOutreachSweep } from "../services/vendor-outreach/outreach-sweep.js";
import { verifyProspect } from "../services/vendor-outreach/verify.js";
import { createFakeOutreachDb } from "./fixtures/fake-outreach-db.js";

process.env.SESSION_SECRET = "test-session-secret-for-reply-links";
process.env.WEB_BASE_URL = "https://cahootz.test";

// A Tuesday at 10:00 Eastern: inside the sending window.
const NOW = new Date("2026-11-03T15:00:00Z");
const DAY = 86_400_000;
const mxYes = async () => true;

function question(db: any, overrides: Record<string, unknown> = {}) {
  db.tables.commonsAction ??= [];
  db.tables.commonsAction.push({
    id: `q${db.tables.commonsAction.length + 1}`,
    coopId: "church",
    sourceType: "deal_interest",
    status: "PUBLISHED",
    sourcePostId: "post1",
    createdAt: new Date(NOW.getTime() - 8 * DAY),
    payload: { dealCategory: "groceries", interestCount: 7, evidence: { kind: "need_posts", postCount: 3, authorCount: 3 } },
    ...overrides,
  });
}

async function activeCampaign(db: any, overrides: Record<string, unknown> = {}) {
  question(db);
  await proposeCampaigns("church", NOW, db);
  const campaign = db.tables.vendorCampaign[0];
  await approveCampaign(db, "admin", campaign.id, { area: "Atlanta, GA", maxEmails: 3 }, NOW);
  Object.assign(campaign, overrides);
  return campaign;
}

function seedSources(db: any, types = ["CAHOOTZ_SHOP", "MEMBER_REFERRAL", "WEB_SEARCH"]) {
  db.tables.prospectSource = types.map((type, index) => ({ id: `src${index}`, type, name: type, status: "ENABLED", config: {} }));
}

describe("outreach wording check", () => {
  it("allows a plain, friendly line", () => {
    expect(checkOutreachText("Your shop's fresh produce and long hours caught our eye.").ok).toBe(true);
  });

  it.each([
    ["Visit www.example.com for details", "link"],
    ["We can pay $5 more per box", "price"],
    ["We guarantee 40 orders a month", "promise"],
    ["This note was written by our AI assistant", "how the email was written"],
    ["Our church loves your bakery", "community"],
    ["Approved by our leadership", "approved"],
  ])("refuses %s", (text, reason) => {
    const result = checkOutreachText(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain(reason);
  });

  it("refuses the Commons' own name", () => {
    expect(checkOutreachText("Families at Grace Fellowship would love this", { forbiddenNames: ["Grace Fellowship"] }).ok).toBe(false);
  });
});

describe("the outreach email", () => {
  const base = {
    businessName: "Corner Market",
    categoryLabel: "groceries",
    area: "Atlanta, GA",
    interestCount: 7,
    offerType: "GROUP_BUY" as const,
    replyUrl: "https://cahootz.test/v/tok",
    unsubscribeUrl: "https://cahootz.test/v/tok?unsubscribe=1",
    postalAddress: "123 Main St, Atlanta, GA 30303",
  };

  it("comes from Cahootz Commons with facts from records, a mailing address and unsubscribe", () => {
    const email = buildOutreachEmail({ ...base, step: "FIRST", personalLine: "Your produce stand caught our eye." });
    expect(email.subject).toBe("Local households looking for groceries");
    expect(email.text).toContain("I'm reaching out from Cahootz Commons");
    expect(email.text).toContain("7 households in a community near Atlanta, GA");
    expect(email.text).toContain("That amount is yours, with no fees taken out of it.");
    expect(email.text).toContain("Your produce stand caught our eye.");
    expect(email.text).toContain("123 Main St, Atlanta, GA 30303");
    expect(email.text).toContain("Unsubscribe: https://cahootz.test/v/tok?unsubscribe=1");
    expect(email.text).toContain("The Cahootz Commons team");
    expect(email.html).toContain('href="https://cahootz.test/v/tok"');
    expect(`${email.subject} ${email.text}`).not.toMatch(/\b(AI|Sage|assistant|automated|church)\b/i);
  });

  it("sends a short follow-up", () => {
    const email = buildOutreachEmail({ ...base, step: "FOLLOW_UP" });
    expect(email.subject).toBe("Following up: local households and groceries");
    expect(email.text).not.toContain("How it works");
    expect(email.text).toContain("Unsubscribe:");
  });

  it("uses the same reply link for the follow-up", () => {
    expect(replyToken("cp_1")).toBe(replyToken("cp_1"));
    expect(replyToken("cp_1")).not.toBe(replyToken("cp_2"));
  });

  it("only sends on weekdays, 9 to 5 Eastern", () => {
    expect(inSendingWindow(new Date("2026-11-03T15:00:00Z"))).toBe(true); // Tue 10am
    expect(inSendingWindow(new Date("2026-11-03T23:30:00Z"))).toBe(false); // Tue 6:30pm
    expect(inSendingWindow(new Date("2026-11-07T16:00:00Z"))).toBe(false); // Saturday
  });
});

describe("campaign proposals and approval", () => {
  let db: any;
  beforeEach(() => {
    db = createFakeOutreachDb();
    vi.mocked(sendSlackNotification).mockClear();
  });

  it("proposes one campaign from a question at least 5 members answered", async () => {
    question(db);
    question(db, { id: "q_low", payload: { dealCategory: "baby_supplies", interestCount: 3 } });
    question(db, { id: "q_open", payload: { dealCategory: "auto_repair" } });
    expect(await proposeCampaigns("church", NOW, db)).toEqual({ proposed: 1 });
    expect(await proposeCampaigns("church", NOW, db)).toEqual({ proposed: 0 });
    expect(db.tables.vendorCampaign).toHaveLength(1);
    expect(db.tables.vendorCampaign[0]).toMatchObject({ status: "PROPOSED", category: "groceries", offerType: "GROUP_BUY", demandActionId: "q1" });
    expect(db.tables.vendorCampaign[0].demandEvidence).toMatchObject({ interestCount: 7, needPosts: { posts: 3, members: 3 } });
    expect(sendSlackNotification).toHaveBeenCalledTimes(1);
  });

  it("looks for a group buy for every category, services included", async () => {
    question(db, { payload: { dealCategory: "auto_repair", interestCount: 6 } });
    await proposeCampaigns("church", NOW, db);
    expect(db.tables.vendorCampaign[0].offerType).toBe("GROUP_BUY");
  });

  it("needs an area to approve, then runs for 30 days", async () => {
    question(db);
    await proposeCampaigns("church", NOW, db);
    const id = db.tables.vendorCampaign[0].id;
    await expect(approveCampaign(db, "admin", id, { area: "" }, NOW)).rejects.toThrow();
    await expect(approveCampaign(db, "admin", id, { area: "Atlanta", pitchPoints: "We'll pay $2 more" }, NOW)).rejects.toThrow(/price/);
    await approveCampaign(db, "admin", id, { area: "Atlanta, GA", maxEmails: 5 }, NOW);
    expect(db.tables.vendorCampaign[0]).toMatchObject({ status: "ACTIVE", area: "Atlanta, GA", maxEmails: 5, approvedById: "admin" });
    expect(db.tables.vendorCampaign[0].expiresAt.getTime()).toBe(NOW.getTime() + 30 * DAY);
    await expect(approveCampaign(db, "admin", id, { area: "Atlanta" }, NOW)).rejects.toThrow(/Only a proposed/);
  });

  it("pauses, resumes and rejects only from the right state", async () => {
    const campaign = await activeCampaign(db);
    await moveCampaign(db, "admin", campaign.id, "pause");
    expect(campaign.status).toBe("PAUSED");
    await moveCampaign(db, "admin", campaign.id, "resume", undefined, NOW);
    expect(campaign.status).toBe("ACTIVE");
    await expect(moveCampaign(db, "admin", campaign.id, "reject", "no")).rejects.toThrow();
  });
});

describe("finding and checking businesses", () => {
  let db: any;
  beforeEach(() => {
    db = createFakeOutreachDb();
    seedSources(db);
  });

  it("checks suppression, recent contact, a declined business, missing email and the mail server", async () => {
    db.tables.outreachSuppression = [{ id: "s1", email: "gone@shop.com", reason: "UNSUBSCRIBED" }];
    const fresh = { email: "hello@shop.com", domain: "shop.com", status: "FOUND", lastContactedAt: null, declinedUntil: null };
    expect(await verifyProspect(db, fresh, { now: NOW, resolveMx: mxYes })).toEqual({ ok: true });
    expect(await verifyProspect(db, { ...fresh, email: "gone@shop.com" }, { now: NOW, resolveMx: mxYes })).toEqual({ ok: false, reason: "UNSUBSCRIBED" });
    expect(await verifyProspect(db, { ...fresh, lastContactedAt: new Date(NOW.getTime() - 30 * DAY) }, { now: NOW, resolveMx: mxYes })).toEqual({ ok: false, reason: "CONTACTED_RECENTLY" });
    expect(await verifyProspect(db, { ...fresh, declinedUntil: new Date(NOW.getTime() + DAY) }, { now: NOW, resolveMx: mxYes })).toEqual({ ok: false, reason: "DECLINED_RECENTLY" });
    expect(await verifyProspect(db, { ...fresh, email: null }, { now: NOW })).toEqual({ ok: false, reason: "NO_EMAIL" });
    expect(await verifyProspect(db, fresh, { now: NOW, resolveMx: async () => false })).toEqual({ ok: false, reason: "NO_MAIL_SERVER" });
  });

  it("finds Cahootz shops, member referrals and web results, and queues up to the email limit", async () => {
    const campaign = await activeCampaign(db);
    db.tables.store = [
      { id: "store1", name: "Corner Market", status: "APPROVED", deletedAt: null, category: "FOOD_BEVERAGE", email: "hi@cornermarket.com", city: "Atlanta" },
      { id: "store2", name: "Far Away Foods", status: "APPROVED", deletedAt: null, category: "FOOD_BEVERAGE", email: "x@faraway.com", city: "Denver" },
    ];
    db.tables.vendorProspect = [{ id: "ref1", businessName: "Mama's Pantry", category: "groceries", sourceType: "MEMBER_REFERRAL", email: "mama@pantry.com", emailNormalized: "mama@pantry.com", domain: "pantry.com", status: "FOUND", city: "Atlanta" }];
    const research = vi.fn(async () => ({
      businesses: [
        { name: "Sunrise Grocery", website: "sunrisegrocery.com", email: "owner@sunrisegrocery.com", phone: null, address: null, city: "Atlanta", contactSourceUrl: "https://sunrisegrocery.com/contact", whyFit: "Family-run grocery with a big bulk aisle." },
        { name: "Phone Only Deli", website: null, email: null, phone: "555-0100", address: null, city: "Atlanta", contactSourceUrl: "https://example.org/listing", whyFit: "Local deli." },
        { name: "Extra Store", website: "extra.com", email: "a@extra.com", phone: null, address: null, city: "Atlanta", contactSourceUrl: "https://extra.com", whyFit: "Neighborhood store." },
      ],
      suggestedSources: [{ name: "Atlanta Black Chamber directory", domain: "https://atlblackchamber.org/members", reason: "Lists local member businesses" }],
    }));
    const result = await discoverForCampaign(db, campaign.id, { now: NOW, research, resolveMx: mxYes });
    expect(result).toMatchObject({ searched: true });
    expect(research).toHaveBeenCalledWith(expect.objectContaining({ area: "Atlanta, GA", categoryLabel: "groceries" }));
    const rows = db.tables.campaignProspect;
    const names = (status: string) => rows.filter((row: any) => row.status === status).map((row: any) => db.tables.vendorProspect.find((p: any) => p.id === row.prospectId).businessName);
    expect(names("QUEUED")).toHaveLength(3); // maxEmails is 3
    expect(names("QUEUED")).not.toContain("Far Away Foods");
    expect(rows.find((row: any) => db.tables.vendorProspect.find((p: any) => p.id === row.prospectId).businessName === "Phone Only Deli").skipReason).toBe("NO_EMAIL");
    expect(db.tables.prospectSource.find((s: any) => s.suggestedBy === "sage")).toMatchObject({ status: "SUGGESTED", config: { domain: "atlblackchamber.org" } });
    expect(campaign.searchesUsed).toBe(1);
    // Discovery runs once per campaign.
    expect((await discoverForCampaign(db, campaign.id, { now: NOW, research, resolveMx: mxYes })).found).toBe(0);
  });

  it("does nothing for a campaign that isn't approved, and skips web search when it's turned off", async () => {
    question(db);
    await proposeCampaigns("church", NOW, db);
    const research = vi.fn();
    expect((await discoverForCampaign(db, db.tables.vendorCampaign[0].id, { now: NOW, research, resolveMx: mxYes })).found).toBe(0);
    db.tables.prospectSource = db.tables.prospectSource.filter((s: any) => s.type !== "WEB_SEARCH");
    await approveCampaign(db, "admin", db.tables.vendorCampaign[0].id, { area: "Atlanta" }, NOW);
    await discoverForCampaign(db, db.tables.vendorCampaign[0].id, { now: NOW, research, resolveMx: mxYes });
    expect(research).not.toHaveBeenCalled();
  });

  it("ends a search that reaches nobody right away, says why, and tells the admins", async () => {
    const nothing = vi.fn(async () => ({ businesses: [], suggestedSources: [] }));
    const campaign = await activeCampaign(db);
    vi.mocked(sendSlackNotification).mockClear();
    expect(await discoverForCampaign(db, campaign.id, { now: NOW, research: nothing, resolveMx: mxYes })).toMatchObject({ found: 0, endReason: "NOTHING_FOUND" });
    expect(campaign).toMatchObject({ status: "COMPLETED", endReason: "NOTHING_FOUND" });
    expect(vi.mocked(sendSlackNotification).mock.calls[0][0].text).toContain("found no sellers: nothing turned up in that area.");
    // The sweep doesn't pick it up again.
    expect((await discoverForCampaign(db, campaign.id, { now: NOW, research: nothing, resolveMx: mxYes })).found).toBe(0);
  });

  it("names the reason: sources off, web search off, or businesses found but none we can email", async () => {
    const nothing = vi.fn(async () => ({ businesses: [], suggestedSources: [] }));
    db.tables.prospectSource = [];
    let campaign = await activeCampaign(db);
    expect((await discoverForCampaign(db, campaign.id, { now: NOW, research: nothing, resolveMx: mxYes })).endReason).toBe("NO_SOURCES");
    expect(nothing).not.toHaveBeenCalled();

    db = createFakeOutreachDb();
    seedSources(db, ["CAHOOTZ_SHOP", "MEMBER_REFERRAL"]);
    campaign = await activeCampaign(db);
    expect((await discoverForCampaign(db, campaign.id, { now: NOW, research: nothing, resolveMx: mxYes })).endReason).toBe("NOTHING_FOUND_NO_WEB_SEARCH");

    db = createFakeOutreachDb();
    seedSources(db);
    campaign = await activeCampaign(db);
    const phoneOnly = vi.fn(async () => ({
      businesses: [{ name: "Phone Only Deli", website: null, email: null, phone: "555-0100", address: null, city: "Atlanta", contactSourceUrl: "https://example.org", whyFit: "Local deli." }],
      suggestedSources: [],
    }));
    expect(await discoverForCampaign(db, campaign.id, { now: NOW, research: phoneOnly, resolveMx: mxYes })).toMatchObject({ found: 1, queued: 0, endReason: "NONE_REACHABLE" });
    expect(campaign.status).toBe("COMPLETED");
  });

  it("leaves a search running when at least one business can be emailed", async () => {
    const campaign = await activeCampaign(db);
    const one = vi.fn(async () => ({
      businesses: [{ name: "Sunrise Grocery", website: "sunrisegrocery.com", email: "owner@sunrisegrocery.com", phone: null, address: null, city: "Atlanta", contactSourceUrl: "https://sunrisegrocery.com", whyFit: "Grocery." }],
      suggestedSources: [],
    }));
    expect((await discoverForCampaign(db, campaign.id, { now: NOW, research: one, resolveMx: mxYes })).endReason).toBeNull();
    expect(campaign.status).toBe("ACTIVE");
    expect(campaign.endReason).toBeUndefined();
  });
});

describe("the outreach sweep", () => {
  let db: any;
  const draft = vi.fn(async () => "Your bulk aisle caught our eye.");

  async function readyCampaign(prospects: Array<Record<string, unknown>>) {
    const campaign = await activeCampaign(db);
    campaign.discoveredAt = NOW;
    for (const [index, extra] of prospects.entries()) {
      db.tables.vendorProspect.push({ id: `p${index}`, businessName: `Shop ${index}`, email: `owner${index}@shop${index}.com`, emailNormalized: `owner${index}@shop${index}.com`, domain: `shop${index}.com`, status: "FOUND", description: "Family grocery.", lastContactedAt: null, declinedUntil: null, ...extra });
      db.tables.campaignProspect.push({ id: `cp${index}`, campaignId: campaign.id, prospectId: `p${index}`, status: "QUEUED", personalLine: null, createdAt: new Date(NOW.getTime() + index) });
    }
    return campaign;
  }

  beforeEach(() => {
    db = createFakeOutreachDb();
    db.tables.vendorProspect = [];
    db.tables.campaignProspect = [];
    db.tables.coopConfig = [{ coopId: "church", isActive: true, name: "Grace Fellowship", slug: "grace" }];
    emailState.ready = false;
    vi.mocked(sendVendorOutreachEmail).mockClear();
    draft.mockClear();
  });

  it("saves emails as a dry run until sending is set up", async () => {
    await readyCampaign([{}]);
    const result = await runOutreachSweep(db, NOW, { draft, resolveMx: mxYes });
    expect(result).toMatchObject({ live: false, dryRun: 1, sent: 0 });
    expect(sendVendorOutreachEmail).not.toHaveBeenCalled();
    expect(db.tables.outreachMessage[0]).toMatchObject({ status: "DRY_RUN", step: "FIRST", toEmail: "owner0@shop0.com" });
    expect(db.tables.outreachMessage[0].body).toContain("[Mailing address not set yet]");
  });

  it("sends once with the unsubscribe header, records the reply link, and never twice", async () => {
    emailState.ready = true;
    db.tables.platformConfig = [{ key: "outreach.postalAddress", value: "123 Main St, Atlanta, GA" }];
    await readyCampaign([{}]);
    const first = await runOutreachSweep(db, NOW, { draft, resolveMx: mxYes });
    expect(first).toMatchObject({ live: true, sent: 1 });
    expect(sendVendorOutreachEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: "owner0@shop0.com",
      oneClickUnsubscribeUrl: `https://cahootz.test/api/vendor-reply/${replyToken("cp0")}/unsubscribe`,
    }));
    expect(db.tables.campaignProspect[0]).toMatchObject({ status: "SENT", replyTokenHash: hashReplyToken(replyToken("cp0")), personalLine: "Your bulk aisle caught our eye." });
    expect(db.tables.vendorProspect[0]).toMatchObject({ status: "CONTACTED" });
    await runOutreachSweep(db, new Date(NOW.getTime() + 3600_000), { draft, resolveMx: mxYes });
    expect(sendVendorOutreachEmail).toHaveBeenCalledTimes(1);
  });

  it("keeps the personal line out when it fails the check", async () => {
    await readyCampaign([{}]);
    await runOutreachSweep(db, NOW, { draft: vi.fn(async () => "Grace Fellowship families need you"), resolveMx: mxYes });
    expect(db.tables.outreachMessage[0].body).not.toContain("Grace Fellowship");
  });

  it("stays within the daily limit and the sending window", async () => {
    await readyCampaign([{}, {}]);
    db.tables.outreachMessage = Array.from({ length: 19 }, (_, i) => ({ id: `old${i}`, status: "SENT", step: "FIRST", sentAt: new Date(NOW.getTime() - 3600_000), campaignProspectId: "elsewhere" }));
    expect((await runOutreachSweep(db, NOW, { draft, resolveMx: mxYes })).dryRun).toBe(1);
    const evening = await runOutreachSweep(db, new Date("2026-11-03T23:30:00Z"), { draft, resolveMx: mxYes });
    expect(evening.outsideWindow).toBe(true);
  });

  it("skips a business that unsubscribed after it was found", async () => {
    await readyCampaign([{}]);
    db.tables.outreachSuppression = [{ id: "s", email: "owner0@shop0.com", reason: "UNSUBSCRIBED" }];
    const result = await runOutreachSweep(db, NOW, { draft, resolveMx: mxYes });
    expect(result.skipped).toBe(1);
    expect(db.tables.outreachMessage ?? []).toHaveLength(0);
  });

  it("sends nothing for a paused campaign", async () => {
    const campaign = await readyCampaign([{}]);
    campaign.status = "PAUSED";
    expect((await runOutreachSweep(db, NOW, { draft, resolveMx: mxYes })).dryRun).toBe(0);
  });

  it("follows up once a week later, then stops", async () => {
    await readyCampaign([{}]);
    await runOutreachSweep(db, NOW, { draft, resolveMx: mxYes });
    const weekLater = new Date(NOW.getTime() + 7 * DAY);
    expect((await runOutreachSweep(db, weekLater, { draft, resolveMx: mxYes })).followUps).toBe(1);
    expect((await runOutreachSweep(db, new Date(weekLater.getTime() + 3600_000), { draft, resolveMx: mxYes })).followUps).toBe(0);
    expect(db.tables.outreachMessage.map((m: any) => m.step)).toEqual(["FIRST", "FOLLOW_UP"]);
    expect(db.tables.vendorCampaign[0].status).toBe("COMPLETED");
  });

  it("expires campaigns after 30 days", async () => {
    await readyCampaign([{}]);
    const result = await runOutreachSweep(db, new Date(NOW.getTime() + 31 * DAY), { draft, resolveMx: mxYes });
    expect(result.campaignsExpired).toBe(1);
    expect(db.tables.outreachMessage ?? []).toHaveLength(0);
  });
});

describe("vendor replies and the pipeline", () => {
  let db: any;
  const token = replyToken("cp0");

  beforeEach(async () => {
    db = createFakeOutreachDb();
    vi.mocked(sendSlackNotification).mockClear();
    db.tables.vendorCampaign = [{ id: "camp1", coopId: "church", category: "groceries", area: "Atlanta, GA", offerType: "GROUP_BUY" }];
    db.tables.vendorProspect = [{ id: "p0", businessName: "Corner Market", email: "hi@corner.com", emailNormalized: "hi@corner.com", status: "CONTACTED" }];
    db.tables.campaignProspect = [{ id: "cp0", campaignId: "camp1", prospectId: "p0", status: "SENT", replyTokenHash: hashReplyToken(token) }];
  });

  it("shows the business its page without naming the community", async () => {
    const page = await loadReplyPage(db, token);
    expect(page).toEqual({ businessName: "Corner Market", categoryLabel: "groceries", area: "Atlanta, GA", offerType: "GROUP_BUY", answered: null });
    await expect(loadReplyPage(db, "not-a-real-token-at-all-xx")).rejects.toThrow(/doesn't work anymore/);
  });

  it("a yes goes to a platform admin", async () => {
    await recordVendorResponse(db, token, { interest: "YES", contactName: "Dana", bestContact: "555-0100", offerIdea: "10% off rice" }, NOW);
    expect(db.tables.vendorProspect[0].status).toBe("INTERESTED");
    expect(db.tables.campaignProspect[0].status).toBe("RESPONDED");
    expect(db.tables.vendorResponse[0]).toMatchObject({ interest: "YES", contactName: "Dana", offerIdea: "10% off rice" });
    expect(sendSlackNotification).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("Corner Market") }));
  });

  it("not right now pauses contact for 180 days; unsubscribe is permanent", async () => {
    await recordVendorResponse(db, token, { interest: "NOT_NOW" }, NOW);
    expect(db.tables.vendorProspect[0].status).toBe("DECLINED");
    expect(db.tables.vendorProspect[0].declinedUntil.getTime()).toBe(NOW.getTime() + 180 * DAY);
    await unsubscribeByToken(db, token);
    expect(db.tables.outreachSuppression[0]).toMatchObject({ email: "hi@corner.com", reason: "UNSUBSCRIBED" });
    expect(db.tables.vendorProspect[0].status).toBe("UNSUBSCRIBED");
  });

  it("marks a deal live only with a real offer, and counts the funnel", async () => {
    await expect(updateProspect(db, "admin", "p0", { action: "converted", offerId: "missing" })).rejects.toThrow(/couldn't find that offer/);
    db.tables.marketplaceOffer = [{ id: "offer1", status: "LIVE" }];
    await updateProspect(db, "admin", "p0", { action: "converted", offerId: "offer1" });
    expect(db.tables.vendorProspect[0]).toMatchObject({ status: "CONVERTED", convertedOfferId: "offer1" });
    db.tables.commonsAction = [{ sourceType: "deal_interest", status: "PUBLISHED", payload: { interestCount: 7 } }];
    const funnel = await outreachFunnel(db);
    expect(funnel).toMatchObject({ questionsAsked: 1, membersInterested: 7, converted: 1, dealsLive: 1 });
  });

  it("do-not-email adds the business to the suppression list", async () => {
    await updateProspect(db, "admin", "p0", { action: "doNotEmail" });
    expect(db.tables.outreachSuppression[0]).toMatchObject({ email: "hi@corner.com", reason: "ADMIN" });
  });
});
