import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadSnapshot } from "../services/sage-facilitation.js";

// The facilitation path end to end through the real Commons action agent, with the database, the model
// and notifications mocked: code decides the thread needs Sage, the model is told how to help, and the
// usual gates decide whether Sage publishes, asks the circle leader, or holds.

const db = vi.hoisted(() => {
  const client: Record<string, any> = {
    commonsComment: { findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    commonsPost: { findUnique: vi.fn() },
    group: { findUnique: vi.fn() },
    coopConfig: { findFirst: vi.fn() },
    commonsAgentSetting: { upsert: vi.fn(), findUnique: vi.fn() },
    commonsContentScan: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    commonsAction: { upsert: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    commonsActionParticipant: { upsert: vi.fn() },
    commonsProposalDraft: { findUnique: vi.fn(), create: vi.fn(), findFirst: vi.fn() },
    sageDecisionTrail: { create: vi.fn() },
    sageTask: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  client.$transaction = vi.fn((fn: (tx: unknown) => unknown) => fn(client));
  return client;
});
const run = vi.hoisted(() => vi.fn());
const createSageTask = vi.hoisted(() => vi.fn());
const requestLeaderApproval = vi.hoisted(() => vi.fn());
const notifySageComment = vi.hoisted(() => vi.fn());

vi.mock("@repo/db", () => ({ db }));
vi.mock("@openai/agents", () => {
  class MockAgent { constructor(public opts: unknown) {} }
  return { Agent: MockAgent, run, tool: vi.fn() };
});
vi.mock("../lib/bot.js", () => ({ ensureSageBotUser: vi.fn().mockResolvedValue({ id: "sage" }) }));
vi.mock("../services/push-notification-service.js", () => ({ createNotificationAndPush: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../services/sage-comment-notifications.js", () => ({ notifySageComment }));
vi.mock("../services/sage-autonomy.js", () => ({ sageAutonomyAllowed: vi.fn().mockResolvedValue(true) }));
vi.mock("../services/sage-memory.js", () => ({ retrieveSageMemory: vi.fn().mockResolvedValue([]) }));
vi.mock("../services/ai-cost.js", () => ({ recordAICost: vi.fn().mockResolvedValue(undefined), recordAgentResultCost: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../agents/tools/comment-tools.js", () => ({ buildCommentTools: vi.fn().mockReturnValue([]) }));
vi.mock("../services/sage-responsibility.js", () => ({ routeSageAlert: vi.fn() }));
vi.mock("../services/sage-trend-agent.js", () => ({ requestLeaderApproval }));
vi.mock("../services/sage-tasks.js", () => ({ createSageTask, clampFollowUpDays: (days: number) => days || 3, FOLLOW_UP_DEFAULT_DAYS: 3 }));

const { processCommonsActionContent, revisitThread } = await import("../services/commons-action-agent.js");
const fixtures = await import("./fixtures/facilitation-threads.js");

const CHARTER = "Members decide shared spending of Commons funds by proposal and vote. We gather regularly to share food and build friendships.";
const onTopic = async () => ({ relevant: true, reason: "On topic." });
const offTopic = async () => ({ relevant: false, reason: "Off topic." });

function action(overrides: Record<string, unknown> = {}) {
  return {
    type: "ANSWER_QUESTION", summary: "Lay out the potluck options", evidence: "the same two people end up hosting every time", evidenceSource: "thread",
    confidence: 0.9, draftText: "Plain fallback.", resourceKind: "", resourceTitle: "", targetHandle: "",
    templateKey: "trade-off", templateLead: "We're choosing between the library room and rotating homes.",
    templateSteps: ["Library: free and on the bus line, but it closes at 7.", "Homes: we can stay late, but the same two people end up hosting."],
    templateOffer: "How many of us need to leave before 7?",
    followUpDays: 0, followUpExpect: "", escalationCategory: "", escalationAboutMember: false, ...overrides,
  };
}

/** Wires the mocks for one thread: `commentId` is the comment that just arrived. */
function useThread(thread: ThreadSnapshot, commentId: string, circleId: string | null = null) {
  const comment = thread.comments.find((entry) => entry.id === commentId)!;
  const post = { id: thread.postId, coopId: "harbor", circleId: circleId ?? "general:harbor", title: thread.title, content: thread.content, authorId: thread.postAuthorId, createdAt: thread.createdAt };
  db.commonsComment.findUnique.mockResolvedValue({ ...comment, postId: thread.postId, author: { isBot: false }, post });
  db.commonsPost.findUnique.mockResolvedValue(post);
  // The thread loader reads the latest 60 comments; the thread context, the 10 before a comment.
  db.commonsComment.findMany.mockImplementation(async (args: { take?: number; where: { id?: { not: string }; createdAt?: { lte: Date } } }) => {
    const newestFirst = [...thread.comments].reverse();
    if (args.take === 60) return newestFirst.map((entry) => ({ id: entry.id, authorId: entry.authorId, content: entry.content, createdAt: entry.createdAt, author: { isBot: entry.isSage } }));
    return newestFirst.filter((entry) => entry.id !== args.where.id?.not && entry.createdAt <= (args.where.createdAt?.lte ?? new Date()))
      .slice(0, args.take).map((entry) => ({ content: entry.content, author: { name: entry.authorId, handle: null, isBot: entry.isSage } }));
  });
  return { comment, post };
}

function trailRows() {
  return db.sageDecisionTrail.create.mock.calls.map((call: any[]) => call[0].data);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(fixtures.NOW.getTime() + 60_000));
  db.coopConfig.findFirst.mockResolvedValue({ id: "config-1", version: 3, coopId: "harbor", name: "Harbor", charterText: CHARTER, missionGoals: [] });
  db.commonsAgentSetting.upsert.mockResolvedValue({ autoReply: true });
  db.commonsContentScan.findFirst.mockResolvedValue(null);
  db.commonsContentScan.findUnique.mockResolvedValue(null);
  db.commonsContentScan.create.mockResolvedValue({});
  db.commonsContentScan.update.mockResolvedValue({});
  db.commonsAction.findFirst.mockResolvedValue(null);
  db.commonsAction.findMany.mockResolvedValue([]);
  db.commonsAction.upsert.mockImplementation(async (args: any) => ({ id: "action-1", ...args.create }));
  db.commonsAction.findUnique.mockResolvedValue({ status: "PENDING" });
  db.commonsAction.update.mockResolvedValue({});
  db.commonsComment.create.mockResolvedValue({ id: "sage-comment-1" });
  db.commonsComment.findFirst.mockResolvedValue(null);
  db.commonsProposalDraft.findUnique.mockResolvedValue(null);
  db.commonsProposalDraft.create.mockResolvedValue({ id: "draft-1" });
  db.group.findUnique.mockResolvedValue({ coopId: "harbor", kind: "STANDARD", leaderId: "leader-1" });
  db.sageDecisionTrail.create.mockResolvedValue({ id: "trail-1" });
  createSageTask.mockResolvedValue({ created: true, taskId: "task-1" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("facilitating a Commons thread", () => {
  it("tells the model the thread needs a trade-off and publishes the rendered comment", async () => {
    useThread(fixtures.DISAGREEMENT, "c4");
    run.mockResolvedValue({ finalOutput: { items: [{ id: "c4", actions: [action()] }] } });

    await processCommonsActionContent("commons_comment", "c4", { relevanceJudge: onTopic });

    const prompt = JSON.parse(run.mock.calls[0]![1]);
    expect(prompt.items[0].facilitate).toMatch(/Trade-off template/);
    expect(String((run.mock.calls[0]![0] as { opts: { instructions: string } }).opts.instructions)).toMatch(/An item with facilitate is a thread that code found needs Sage's help/);
    expect(db.commonsComment.create).toHaveBeenCalledWith({ data: { postId: "post-1", authorId: "sage", content: [
      "We're choosing between the library room and rotating homes.",
      "• Library: free and on the bus line, but it closes at 7.",
      "• Homes: we can stay late, but the same two people end up hosting.",
      "",
      "How many of us need to leave before 7?",
    ].join("\n") } });
    const [trail] = trailRows();
    expect(trail.visibility).toBe("COMMONS_MEMBERS");
    expect(trail.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: "EVIDENCE", label: "Code flagged the thread: members disagree" }),
      expect.objectContaining({ label: "Published a reply as Sage" }),
    ]));
  });

  it("claims the trigger once: the next comment during the cooldown gets Sage's ordinary analysis only", async () => {
    useThread(fixtures.DISAGREEMENT, "c4");
    db.commonsContentScan.findFirst.mockResolvedValue({ contentHash: "disagreement:c3", scannedAt: new Date() });
    run.mockResolvedValue({ finalOutput: { items: [{ id: "c4", actions: [] }] } });

    await processCommonsActionContent("commons_comment", "c4", { relevanceJudge: onTopic });

    expect(JSON.parse(run.mock.calls[0]![1]).items[0].facilitate).toBeUndefined();
    expect(trailRows()[0].steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Didn't step into the thread", detail: expect.stringMatching(/within the last 12 hours/) }),
    ]));
  });

  it("adds only the deterministic social opening approved for a harmless busy thread", async () => {
    useThread(fixtures.BUSY_THREAD, "c8");
    run.mockResolvedValue({ finalOutput: { items: [{ id: "c8", actions: [action({
      templateKey: "where-we-are",
      templateLead: "This is about finding a workable time for the garden workday.",
      templateSteps: ["Agreed: the workday should happen before frost.", "Still open: a time people can attend safely."],
      templateOffer: "Which two-hour window works for the most people?",
      evidence: "We should do a workday at the community garden before frost",
    })] }] } });

    await processCommonsActionContent("commons_comment", "c8", { relevanceJudge: onTopic });

    const content = db.commonsComment.create.mock.calls[0]![0].data.content as string;
    expect(content).toMatch(/^(You’ve surfaced the constraints clearly|This thread has done a few laps)/);
    expect(content.match(/You’ve surfaced|This thread has done/g)).toHaveLength(1);
    expect(trailRows()[0].steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: expect.stringMatching(/^Used one brief (compliment|light humor) opening$/) }),
    ]));
  });

  it("holds a comment when the group defers, and schedules the revisit instead", async () => {
    useThread(fixtures.DEFERRAL, "c2");
    run.mockResolvedValue({ finalOutput: { items: [{ id: "c2", actions: [action({ templateKey: "", draftText: "Sounds good!", evidence: "once we know the volunteer schedule" })] }] } });

    await processCommonsActionContent("commons_comment", "c2", { relevanceJudge: onTopic });

    expect(db.commonsComment.create).not.toHaveBeenCalled();
    expect(createSageTask).toHaveBeenCalledWith(expect.objectContaining({ subjectType: "thread_revisit", ownerUserId: "rosa", dueInDays: 7, postId: "post-1" }));
    expect(trailRows()[0].steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Held: the group put this off, so Sage brings it back later instead of commenting now" }),
      expect.objectContaining({ label: "Will bring this back in 7 days" }),
    ]));
  });

  it("drafts the proposal for the member who raised the idea, not the last commenter", async () => {
    useThread(fixtures.READY_FOR_PROPOSAL, "c4");
    run.mockResolvedValue({ finalOutput: { items: [{ id: "c4", actions: [action({
      type: "MAKE_PROPOSAL", summary: "Lease a shared delivery van", evidenceSource: "charter",
      evidence: "Members decide shared spending of Commons funds by proposal and vote", templateKey: "",
      draftText: "Lease one van for $450 a month, split between the businesses that use it.",
    })] }] } });

    await processCommonsActionContent("commons_comment", "c4", { relevanceJudge: onTopic });

    expect(JSON.parse(run.mock.calls[0]![1]).items[0].facilitate).toMatch(/MAKE_PROPOSAL/);
    expect(db.commonsProposalDraft.create).toHaveBeenCalledWith({ data: expect.objectContaining({ authorId: "andre", title: "Lease a shared delivery van" }) });
    // A draft only: nothing is submitted.
    expect(db.commonsProposalDraft.create.mock.calls[0]![0].data.submittedAt).toBeUndefined();
  });

  it("still won't publish a facilitation comment that fails a gate", async () => {
    useThread(fixtures.DISAGREEMENT, "c4");
    run.mockResolvedValue({ finalOutput: { items: [{ id: "c4", actions: [action()] }] } });

    await processCommonsActionContent("commons_comment", "c4", { relevanceJudge: offTopic });

    expect(db.commonsComment.create).not.toHaveBeenCalled();
    expect(trailRows()[0].steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Queued the reply for a platform admin to review" }),
    ]));
  });
});

describe("facilitating a circle thread", () => {
  it("makes no model call for ordinary circle chatter", async () => {
    useThread(fixtures.QUIET, "c2", "circle-1");
    expect(await processCommonsActionContent("commons_comment", "c2")).toEqual({ processed: 0 });
    expect(run).not.toHaveBeenCalled();
  });

  it("asks the circle leader to approve a comment Sage isn't confident enough to post", async () => {
    useThread(fixtures.DISAGREEMENT, "c4", "circle-1");
    run.mockResolvedValue({ finalOutput: { items: [{ id: "c4", actions: [action({ confidence: 0.6 })] }] } });

    await processCommonsActionContent("commons_comment", "c4", { relevanceJudge: onTopic });

    expect(db.commonsComment.create).not.toHaveBeenCalled();
    expect(db.commonsAction.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({
      type: "SUGGEST_ACTION", circleId: "circle-1", sourceAuthorId: "leader-1",
      payload: expect.objectContaining({ capability: "comment_on_post", targetPostId: "post-1", facilitationOf: "c4" }),
    }) }));
    expect(requestLeaderApproval).toHaveBeenCalledWith(expect.objectContaining({ leaderId: "leader-1", reason: expect.stringMatching(/pushing back/) }));
    const [trail] = trailRows();
    expect(trail).toMatchObject({ visibility: "CIRCLE", circleId: "circle-1" });
  });

  it("publishes by itself only when every gate passes, as in the Commons feed", async () => {
    useThread(fixtures.DISAGREEMENT, "c4", "circle-1");
    run.mockResolvedValue({ finalOutput: { items: [{ id: "c4", actions: [action()] }] } });

    await processCommonsActionContent("commons_comment", "c4", { relevanceJudge: onTopic });

    expect(db.commonsComment.create).toHaveBeenCalledTimes(1);
    expect(requestLeaderApproval).not.toHaveBeenCalled();
  });

  it("sends a proposal draft to the leader rather than creating it", async () => {
    useThread(fixtures.READY_FOR_PROPOSAL, "c4", "circle-1");
    run.mockResolvedValue({ finalOutput: { items: [{ id: "c4", actions: [action({
      type: "MAKE_PROPOSAL", summary: "Lease a shared delivery van", evidenceSource: "charter",
      evidence: "Members decide shared spending of Commons funds by proposal and vote", templateKey: "", draftText: "Lease one van together.",
    })] }] } });

    await processCommonsActionContent("commons_comment", "c4", { relevanceJudge: onTopic });

    expect(db.commonsProposalDraft.create).not.toHaveBeenCalled();
    expect(requestLeaderApproval).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ capability: "draft_proposal" }) }));
  });

  it("schedules a deferral with no model call", async () => {
    useThread(fixtures.DEFERRAL, "c2", "circle-1");
    expect(await processCommonsActionContent("commons_comment", "c2")).toEqual({ processed: 1 });
    expect(run).not.toHaveBeenCalled();
    expect(createSageTask).toHaveBeenCalledWith(expect.objectContaining({ subjectType: "thread_revisit", circleId: "circle-1" }));
  });

  it("stays out of direct messages and welcome lounges", async () => {
    for (const kind of ["DIRECT", "WELCOME_TABLE"]) {
      db.group.findUnique.mockResolvedValueOnce({ coopId: "harbor", kind, leaderId: "leader-1" });
      useThread(fixtures.DISAGREEMENT, "c4", "circle-1");
      expect(await processCommonsActionContent("commons_comment", "c4")).toEqual({ processed: 0 });
    }
    expect(run).not.toHaveBeenCalled();
  });
});

describe("bringing a deferred thread back", () => {
  it("re-reads the thread and summarizes where the group left it", async () => {
    const { comment, post } = useThread(fixtures.DEFERRAL, "c2");
    // The deferral was a week ago; the revisit is judged as current work.
    vi.setSystemTime(new Date(fixtures.NOW.getTime() + 7 * 86_400_000));
    db.commonsComment.findFirst.mockResolvedValueOnce({ ...comment, postId: "post-1", post });
    run.mockResolvedValue({ finalOutput: { items: [{ id: "c2", actions: [action({
      templateKey: "where-we-are", templateLead: "This is about opening the tool library on Thursday evenings.",
      templateSteps: ["Agreed: it depends on who can staff it.", "Still open: the volunteer schedule."], templateOffer: "Who could take a Thursday shift?",
      evidence: "depends who can staff it",
    })] }] } });

    const result = await revisitThread({ id: "task-9", coopId: "harbor", postId: "post-1", subjectId: "post-1", reason: 'A member put the discussion off: "Let\'s revisit this next week"' }, { relevanceJudge: onTopic });

    expect(result).toEqual({ ran: true, reason: "Sage came back to the discussion" });
    expect(JSON.parse(run.mock.calls[0]![1]).items[0].facilitate).toMatch(/said it would come back to this/);
    expect(db.commonsComment.create).toHaveBeenCalledWith({ data: expect.objectContaining({ content: expect.stringMatching(/^This is about opening the tool library/) }) });
    expect(trailRows()[0]).toMatchObject({ trigger: "SAGE_WAKE", steps: expect.arrayContaining([expect.objectContaining({ label: "Came back to a discussion the group put off" })]) });
  });
});
