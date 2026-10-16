import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  commonsContentScan: { findFirst: vi.fn(), create: vi.fn() },
  sageTask: { findFirst: vi.fn() },
}));
const createSageTask = vi.hoisted(() => vi.fn().mockResolvedValue({ created: true, taskId: "task-1" }));
vi.mock("@repo/db", () => ({ db }));
vi.mock("../services/sage-tasks.js", () => ({ createSageTask }));

const {
  FACILITATION_COOLDOWN_HOURS, claimFacilitation, detectFacilitation, facilitationInstruction, factualQuestion, isDeferral, revisitDays,
  revisitSignal, scheduleThreadRevisit, threadUpTo,
} = await import("../services/sage-facilitation.js");
const { SAGE_REPLY_TEMPLATES } = await import("../services/sage-reply-templates.js");
const fixtures = await import("./fixtures/facilitation-threads.js");
const { NOW } = fixtures;

const HOUR = 3_600_000;

beforeEach(() => {
  vi.clearAllMocks();
  db.commonsContentScan.findFirst.mockResolvedValue(null);
  db.commonsContentScan.create.mockResolvedValue({ id: "scan-1" });
  db.sageTask.findFirst.mockResolvedValue(null);
});

describe("when a thread needs Sage", () => {
  it.each([
    ["an unanswered factual question", fixtures.UNANSWERED_QUESTION, "unanswered_question", "missing-piece"],
    ["members disagreeing", fixtures.DISAGREEMENT, "disagreement", "trade-off"],
    ["agreement on shared spending with numbers", fixtures.READY_FOR_PROPOSAL, "ready_for_proposal", null],
    ["two people deciding for everyone", fixtures.NARROW_DECISION, "narrow_decision", "before-we-decide"],
    ["a long thread with no decision", fixtures.BUSY_THREAD, "busy_thread", "where-we-are"],
    ["the group putting it off", fixtures.DEFERRAL, "deferral", null],
  ])("flags %s", (_label, thread, kind, template) => {
    const { signal } = detectFacilitation(thread, NOW);
    expect(signal?.kind).toBe(kind);
    expect(signal?.template).toBe(template);
    expect(signal?.reason.length).toBeGreaterThan(20);
  });

  it("leaves an answered question, small talk and a fresh post alone", () => {
    expect(detectFacilitation(fixtures.ANSWERED_QUESTION, NOW).signal).toBeNull();
    expect(detectFacilitation(fixtures.QUIET, NOW).signal).toBeNull();
    expect(detectFacilitation({ ...fixtures.DISAGREEMENT, comments: [] }, NOW).signal).toBeNull();
  });

  it("points at the question itself and the member who raised the idea", () => {
    expect(detectFacilitation(fixtures.UNANSWERED_QUESTION, NOW).signal).toMatchObject({
      anchorId: "post-1", question: "Does anyone know what time the library closes on Saturdays?",
    });
    expect(detectFacilitation(fixtures.READY_FOR_PROPOSAL, NOW).signal).toMatchObject({ draftOwnerId: "andre", anchorId: "c4" });
  });

  it("only uses templates that exist", () => {
    const keys = new Set(SAGE_REPLY_TEMPLATES.map((template) => template.key));
    for (const thread of [fixtures.UNANSWERED_QUESTION, fixtures.DISAGREEMENT, fixtures.NARROW_DECISION, fixtures.BUSY_THREAD]) {
      expect(keys.has(detectFacilitation(thread, NOW).signal!.template!)).toBe(true);
    }
    expect(keys.has(revisitSignal("c1", "later").template!)).toBe(true);
  });

  it("reads the thread as it stood when the comment arrived", () => {
    // Three comments in, the garden thread was still just people saying when they're free.
    expect(detectFacilitation(threadUpTo(fixtures.BUSY_THREAD, "c3"), NOW).signal).toBeNull();
    expect(detectFacilitation(threadUpTo(fixtures.BUSY_THREAD, "c8"), NOW).signal?.kind).toBe("busy_thread");
  });
});

describe("the per-thread cooldown", () => {
  it("waits after Sage's own comment, then counts only what came after it", () => {
    const soon = detectFacilitation(fixtures.SAGE_SPOKE_RECENTLY, NOW);
    expect(soon.signal).toBeNull();
    expect(soon.blocked).toMatch(/Sage commented in this thread 2 hours ago/);
    const later = new Date(NOW.getTime() + FACILITATION_COOLDOWN_HOURS * HOUR);
    // Three members pushed back after Sage spoke, so once the cooldown is over it's a trade-off.
    expect(detectFacilitation(fixtures.SAGE_SPOKE_RECENTLY, later).signal?.kind).toBe("disagreement");
  });

  it("still schedules a revisit during the cooldown, because a deferral doesn't comment", () => {
    const thread = { ...fixtures.SAGE_SPOKE_RECENTLY, comments: [...fixtures.SAGE_SPOKE_RECENTLY.comments,
      { id: "c9", authorId: "kim", isSage: false, content: "Let's talk about it again next week", createdAt: NOW }] };
    expect(detectFacilitation(thread, NOW).signal).toMatchObject({ kind: "deferral", revisitInDays: 7, anchorId: "c9" });
  });

  it("claims each trigger once and backs off for the cooldown after any attempt", async () => {
    const signal = detectFacilitation(fixtures.DISAGREEMENT, NOW).signal!;
    await expect(claimFacilitation("harbor", "post-1", signal, NOW)).resolves.toEqual({ claimed: true });
    expect(db.commonsContentScan.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      sourceType: "thread_facilitation", sourceId: "post-1", contentHash: "disagreement:c4", status: "SUCCESS",
    }) });
    expect(db.commonsContentScan.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      scannedAt: { gt: new Date(NOW.getTime() - FACILITATION_COOLDOWN_HOURS * HOUR) }, NOT: { contentHash: { startsWith: "deferral:" } },
    }) }));

    db.commonsContentScan.findFirst.mockResolvedValueOnce({ contentHash: "busy_thread:c2", scannedAt: NOW });
    expect(await claimFacilitation("harbor", "post-1", signal, NOW)).toMatchObject({ claimed: false, reason: expect.stringMatching(/busy_thread/) });

    db.commonsContentScan.create.mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002" }));
    expect(await claimFacilitation("harbor", "post-1", signal, NOW)).toEqual({ claimed: false, reason: "This trigger was already handled." });
  });

  it("doesn't let a deferral start or wait for the comment cooldown", async () => {
    const deferral = detectFacilitation(fixtures.DEFERRAL, NOW).signal!;
    await claimFacilitation("harbor", "post-1", deferral, NOW);
    expect(db.commonsContentScan.findFirst).not.toHaveBeenCalled();
  });
});

describe("questions and deferrals", () => {
  it("separates facts to look up from choices for the group", () => {
    expect(factualQuestion("Quick one. What time does the library close on Saturdays?")).toBe("What time does the library close on Saturdays?");
    expect(factualQuestion("How much is the van lease?")).toBe("How much is the van lease?");
    for (const opinion of ["Should we rotate homes?", "What do you think?", "What if we lease a van?", "Who's in?", "Thoughts?"]) {
      expect(factualQuestion(opinion)).toBeNull();
    }
  });

  it("recognizes the ways members put a discussion off, and not ordinary uses of 'later'", () => {
    for (const text of ["Let's revisit this next week", "can we decide on this later?", "let's circle back to this after the holidays",
      "We could talk about it on Thursday", "Let's table this for now", "maybe pick this back up next month"]) {
      expect(isDeferral(text)).toBe(true);
    }
    for (const text of ["See you later!", "I'll pay you back later", "Next week works for the workday", "I'll bring chairs on Saturday"]) {
      expect(isDeferral(text)).toBe(false);
    }
  });

  it("brings it back when members said", () => {
    const thursday = new Date("2026-10-15T12:00:00.000Z"); // a Thursday
    expect(revisitDays("let's decide tomorrow", thursday)).toBe(1);
    expect(revisitDays("revisit this next week", thursday)).toBe(7);
    expect(revisitDays("let's pick it up next month", thursday)).toBe(14);
    expect(revisitDays("can we talk about it on Monday", thursday)).toBe(4);
    expect(revisitDays("let's talk about it on Thursday", thursday)).toBe(7);
    expect(revisitDays("let's revisit", thursday)).toBe(3);
  });

  it("schedules one revisit per thread, owned by the member who deferred", async () => {
    await scheduleThreadRevisit({ coopId: "harbor", circleId: null, postId: "post-1", postTitle: "Tool library hours", commentId: "c2",
      ownerUserId: "rosa", deferredText: "Let's revisit this next week", days: 7 });
    expect(createSageTask).toHaveBeenCalledWith(expect.objectContaining({
      subjectType: "thread_revisit", subjectId: "post-1", postId: "post-1", ownerUserId: "rosa", dueInDays: 7,
      title: "Bring back: Tool library hours", reason: 'A member put the discussion off: "Let\'s revisit this next week"',
    }));
    db.sageTask.findFirst.mockResolvedValueOnce({ id: "open", dueAt: new Date("2026-10-23T00:00:00.000Z") });
    expect(await scheduleThreadRevisit({ coopId: "harbor", circleId: null, postId: "post-1", postTitle: "x", commentId: "c3",
      ownerUserId: "dev", deferredText: "later", days: 3 })).toMatchObject({ created: false, reason: expect.stringMatching(/already bringing this back on 2026-10-23/) });
    expect(createSageTask).toHaveBeenCalledTimes(1);
  });
});

describe("what the model is told", () => {
  it("names the template and never asks Sage to take a side", () => {
    expect(facilitationInstruction(detectFacilitation(fixtures.DISAGREEMENT, NOW).signal!)).toMatch(/Trade-off template.*Don't take a side/);
    expect(facilitationInstruction(detectFacilitation(fixtures.NARROW_DECISION, NOW).signal!)).toMatch(/groups \(never individuals\)/);
    expect(facilitationInstruction(detectFacilitation(fixtures.BUSY_THREAD, NOW).signal!)).toMatch(/Where we are/);
    expect(facilitationInstruction(detectFacilitation(fixtures.READY_FOR_PROPOSAL, NOW).signal!)).toMatch(/MAKE_PROPOSAL/);
    expect(facilitationInstruction(detectFacilitation(fixtures.UNANSWERED_QUESTION, NOW).signal!)).toMatch(/what time the library closes/);
    expect(facilitationInstruction(detectFacilitation(fixtures.DEFERRAL, NOW).signal!)).toMatch(/Don't comment/);
  });
});
