import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  platformConfig: { findUnique: vi.fn(), upsert: vi.fn() },
  sageDevIssueDraft: {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  appFeedback: { findMany: vi.fn() },
  aIObservation: { findMany: vi.fn() },
  proposal: { findMany: vi.fn() },
  coopConfig: { findMany: vi.fn() },
}));
vi.mock("@repo/db", () => ({ db }));
vi.mock("../services/slack-notification-service.js", () => ({ sendSlackNotification: vi.fn().mockResolvedValue(true) }));
vi.mock("../services/ai-cost.js", () => ({ recordAgentResultCost: vi.fn() }));

import {
  devIssueEvidence,
  devIssuePeriod,
  devIssuePrivacyFlags,
  dismissSageDevIssueDraft,
  postSageDevIssueDraft,
  renderDevIssueBody,
  runSageDevIssueSuggestion,
  setDevIssueCadence,
  type DevIssueOutput,
  type DevIssueSignals,
} from "../services/sage-dev-issues.js";

const signals: DevIssueSignals = {
  feedback: [
    { ref: "f1", category: "BUG", screen: "/rides", text: "the ride board never loads when I open it at night", userId: "u1" },
    { ref: "f2", category: "BUG", screen: "/rides", text: "rides page is blank", userId: "u2" },
    { ref: "f3", category: "IDEA", screen: null, text: "let us share recipes", userId: "u2" },
  ],
  pulse: [{ ref: "c1", text: "Several ride requests went unanswered this week." }],
  proposals: [{ ref: "p1", status: "SUBMITTED", category: "COMMUNITY", text: "Carpool fund: help with gas" }],
  openIssueTitles: ["Flaky E2E: sage-follow-through"],
  privateNames: ["Ada Lovelace", "adal", "soulaan", "Soulaan Co-op"],
};

const output: DevIssueOutput = {
  decision: "SUGGEST",
  title: "Ride board sometimes shows nothing",
  problem: "Members open the ride board and see an empty page, so they can't find or offer a ride.",
  whyItMatters: "Rides are how a lot of us get to work and appointments. If the board looks empty, people stop asking.",
  sourceRefs: ["f1", "f2", "c1", "zz"],
  skipReason: "",
};

function emptySources() {
  db.appFeedback.findMany.mockResolvedValue([]);
  db.aIObservation.findMany.mockResolvedValue([]);
  db.proposal.findMany.mockResolvedValue([]);
  db.coopConfig.findMany.mockResolvedValue([]);
}

const noIssues = vi.fn().mockResolvedValue({ ok: true, json: async () => [] }) as unknown as typeof fetch;

beforeEach(() => {
  vi.clearAllMocks();
  db.platformConfig.findUnique.mockResolvedValue(null);
  db.sageDevIssueDraft.findUnique.mockResolvedValue(null);
  emptySources();
});

afterEach(() => vi.unstubAllEnvs());

describe("devIssuePeriod", () => {
  it("keys weekly drafts by ISO week and monthly drafts by month", () => {
    const now = new Date("2026-10-27T15:00:00Z");
    expect(devIssuePeriod(now, "WEEKLY").key).toBe("2026-W44");
    expect(devIssuePeriod(now, "MONTHLY").key).toBe("2026-10");
    expect(devIssuePeriod(now, "WEEKLY").windowStart).toEqual(new Date("2026-10-20T15:00:00Z"));
  });
});

describe("devIssuePrivacyFlags", () => {
  it("passes a draft written in Sage's own words", () => {
    expect(devIssuePrivacyFlags(`${output.title}\n${output.problem}`, signals)).toEqual([]);
  });

  it("flags contact details, links and handles", () => {
    const flags = devIssuePrivacyFlags("Email me at a@b.co or call 555 123 4567, see https://x.io, ask @adal", signals);
    expect(flags).toEqual([
      "Mentions an email address",
      "Mentions a phone number",
      "Includes a link",
      "Mentions an @handle",
      "Names a member or a Commons",
    ]);
  });

  it("flags a member's name or a Commons, but not a word that merely contains one", () => {
    expect(devIssuePrivacyFlags("Ada Lovelace can't find rides", signals)).toContain("Names a member or a Commons");
    expect(devIssuePrivacyFlags("Members in Soulaan Co-op can't find rides", signals)).toContain("Names a member or a Commons");
    expect(devIssuePrivacyFlags("Members in soulaanville can't find rides", signals)).toEqual([]);
  });

  it("flags six words copied from a member", () => {
    expect(devIssuePrivacyFlags("Someone said the ride board never loads when I open it", signals)).toEqual([
      "Quotes a member's own words",
    ]);
  });
});

describe("evidence and body", () => {
  it("counts only cited records that exist, and renders them without the model's numbers", () => {
    const evidence = devIssueEvidence(output, signals);
    expect(evidence).toEqual({
      feedbackReports: 2,
      feedbackReporters: 2,
      feedbackByCategory: { BUG: 2 },
      pulseNotes: 1,
      proposals: 0,
    });
    const body = renderDevIssueBody(output, evidence, devIssuePeriod(new Date("2026-10-27T15:00:00Z"), "WEEKLY"));
    expect(body).toContain("- 2 in-app reports from 2 members (2 bug reports)");
    expect(body).toContain("- 1 Community Pulse note");
    expect(body).not.toContain("proposal");
    expect(body).toContain("From Oct 20, 2026 to Oct 27, 2026.");
  });
});

describe("runSageDevIssueSuggestion", () => {
  const now = new Date("2026-10-27T15:00:00Z");

  it("drafts nothing when this period already has one", async () => {
    db.sageDevIssueDraft.findUnique.mockResolvedValue({ id: "d1" });
    const generate = vi.fn();
    await expect(runSageDevIssueSuggestion({ now, generate })).resolves.toEqual({ status: "EXISTS", draftId: "d1" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("skips the model call when there's nothing to read", async () => {
    const generate = vi.fn();
    const result = await runSageDevIssueSuggestion({ now, generate, fetchImpl: noIssues });
    expect(result.status).toBe("SKIPPED");
    expect(generate).not.toHaveBeenCalled();
  });

  it("saves a weekly draft by default, built from records, and leaves out E2E feedback", async () => {
    db.appFeedback.findMany.mockResolvedValue([
      { category: "BUG", message: "rides page is blank", screen: "/rides", userId: "u1", user: { name: "Ada Lovelace", nickname: null, handle: "adal" } },
      { category: "BUG", message: "E2E test feedback", screen: null, userId: "u9", user: null },
    ]);
    db.sageDevIssueDraft.create.mockImplementation(async ({ data }) => ({ id: "d2", ...data }));
    const generate = vi.fn().mockResolvedValue({ ...output, sourceRefs: ["f1"] });

    const result = await runSageDevIssueSuggestion({ now, generate, fetchImpl: noIssues });

    expect(generate.mock.calls[0]![0].feedback).toHaveLength(1);
    expect(generate.mock.calls[0]![1]).toBe("WEEKLY");
    expect(result).toEqual({ status: "CREATED", draftId: "d2", title: output.title, privacyFlags: [] });
    const data = db.sageDevIssueDraft.create.mock.calls[0]![0].data;
    expect(data.periodKey).toBe("2026-W44");
    expect(data.body).toContain("- 1 in-app report from 1 member (1 bug report)");
  });

  it("uses the monthly setting and saves a flagged draft that can't be posted", async () => {
    db.platformConfig.findUnique.mockResolvedValue({ value: "MONTHLY" });
    db.appFeedback.findMany.mockResolvedValue([
      { category: "BUG", message: "rides page is blank", screen: "/rides", userId: "u1", user: { name: "Ada Lovelace", nickname: null, handle: "adal" } },
    ]);
    db.sageDevIssueDraft.create.mockImplementation(async ({ data }) => ({ id: "d3", ...data }));
    const generate = vi.fn().mockResolvedValue({ ...output, problem: "Ada Lovelace can't see rides.", sourceRefs: ["f1"] });

    const result = await runSageDevIssueSuggestion({ now, generate, fetchImpl: noIssues });

    expect(db.sageDevIssueDraft.create.mock.calls[0]![0].data.periodKey).toBe("2026-10");
    expect(result).toMatchObject({ status: "CREATED", privacyFlags: ["Names a member or a Commons"] });
  });

  it("won't save a draft that cites nothing or repeats an open issue", async () => {
    db.appFeedback.findMany.mockResolvedValue([
      { category: "BUG", message: "rides page is blank", screen: "/rides", userId: "u1", user: null },
    ]);
    const uncited = vi.fn().mockResolvedValue({ ...output, sourceRefs: ["made-up"] });
    expect((await runSageDevIssueSuggestion({ now, generate: uncited, fetchImpl: noIssues })).status).toBe("SKIPPED");

    const openIssues = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ title: "Ride board sometimes shows nothing" }, { title: "A PR", pull_request: {} }],
    }) as unknown as typeof fetch;
    const repeat = vi.fn().mockResolvedValue({ ...output, sourceRefs: ["f1"] });
    const result = await runSageDevIssueSuggestion({ now, generate: repeat, fetchImpl: openIssues });
    expect(result).toEqual({ status: "SKIPPED", reason: 'Already open on GitHub: "Ride board sometimes shows nothing".' });
    expect(db.sageDevIssueDraft.create).not.toHaveBeenCalled();
  });
});

describe("cadence", () => {
  it("accepts only weekly or monthly", async () => {
    await expect(setDevIssueCadence("DAILY" as never, "admin")).rejects.toThrow("Pick weekly or monthly.");
    await setDevIssueCadence("MONTHLY", "admin");
    expect(db.platformConfig.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { value: "MONTHLY", updatedBy: "admin" } }));
  });
});

describe("posting to GitHub", () => {
  const draft = { id: "d1", title: "Ride board sometimes shows nothing", body: "body" };

  it("never posts an E2E test draft, even with a token", async () => {
    vi.stubEnv("GITHUB_ISSUES_TOKEN", "token");
    db.sageDevIssueDraft.findUnique.mockResolvedValue({ title: "E2E abc ride board looks empty" });
    const fetchImpl = vi.fn();
    await expect(postSageDevIssueDraft("d1", "admin", fetchImpl as unknown as typeof fetch)).rejects.toThrow("Test drafts never go to GitHub.");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(db.sageDevIssueDraft.updateMany).not.toHaveBeenCalled();
  });

  it("needs a token", async () => {
    vi.stubEnv("GITHUB_ISSUES_TOKEN", "");
    await expect(postSageDevIssueDraft("d1", "admin")).rejects.toThrow("GITHUB_ISSUES_TOKEN isn't set");
    expect(db.sageDevIssueDraft.updateMany).not.toHaveBeenCalled();
  });

  it("refuses a flagged draft", async () => {
    vi.stubEnv("GITHUB_ISSUES_TOKEN", "token");
    db.sageDevIssueDraft.updateMany.mockResolvedValue({ count: 0 });
    db.sageDevIssueDraft.findUnique.mockResolvedValue({ title: "Ride board", status: "DRAFT", privacyFlags: ["Includes a link"] });
    await expect(postSageDevIssueDraft("d1", "admin")).rejects.toThrow("This draft can't be posted: Includes a link.");
  });

  it("claims the draft once, posts it with the label, and records the issue", async () => {
    vi.stubEnv("GITHUB_ISSUES_TOKEN", "token");
    db.sageDevIssueDraft.updateMany.mockResolvedValue({ count: 1 });
    db.sageDevIssueDraft.findUniqueOrThrow.mockResolvedValue(draft);
    db.sageDevIssueDraft.update.mockImplementation(async ({ data }) => ({ ...draft, ...data }));
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ number: 300, html_url: "https://github.com/x/y/issues/300" }) });

    const posted = await postSageDevIssueDraft("d1", "admin", fetchImpl as unknown as typeof fetch);

    expect(db.sageDevIssueDraft.updateMany).toHaveBeenCalledWith({
      where: { id: "d1", status: "DRAFT", privacyFlags: { isEmpty: true } },
      data: { status: "POSTING" },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.github.com/repos/CahootzFederation/cahootz-coops-federation/issues",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ title: draft.title, body: "body", labels: ["sage-suggestion"] }) }),
    );
    expect(posted).toMatchObject({ status: "POSTED", githubIssueNumber: 300, postedBy: "admin" });
  });

  it("puts the draft back when GitHub refuses", async () => {
    vi.stubEnv("GITHUB_ISSUES_TOKEN", "token");
    db.sageDevIssueDraft.updateMany.mockResolvedValue({ count: 1 });
    db.sageDevIssueDraft.findUniqueOrThrow.mockResolvedValue(draft);
    db.sageDevIssueDraft.update.mockResolvedValue({});
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 403 });

    await expect(postSageDevIssueDraft("d1", "admin", fetchImpl as unknown as typeof fetch)).rejects.toThrow("GitHub said no (HTTP 403)");
    expect(db.sageDevIssueDraft.update).toHaveBeenCalledWith({ where: { id: "d1" }, data: { status: "DRAFT" } });
  });

  it("dismisses only an unposted draft", async () => {
    db.sageDevIssueDraft.updateMany.mockResolvedValue({ count: 0 });
    await expect(dismissSageDevIssueDraft("d1", "admin")).rejects.toThrow("Only a draft that hasn't been posted");
  });
});
