import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  aIObservation: { findMany: vi.fn(), updateMany: vi.fn() },
  userCoopMembership: { findMany: vi.fn() },
  coopConfig: { findMany: vi.fn() },
  auditLog: { create: vi.fn() },
}));
vi.mock("@repo/db", () => ({ db }));

const { handleMemberMemoryRequest, loadMemberMemory, memberMemoryLines, parseMemberMemoryRequest, MEMBER_MEMORY_MAX_CHARS } = await import("../services/sage-member-memory.js");
const { classifyPrivateSignal } = await import("../services/sage-private-signals.js");

const NOW = new Date("2026-10-14T12:00:00.000Z");
const signal = (id: string, themeKey: string, opts: { stance?: "SUPPORT" | "CONTRADICT"; coopIds?: string[]; date?: string } = {}) => ({
  id, createdAt: new Date(`${opts.date ?? "2026-10-10"}T09:00:00.000Z`),
  details: { themeKey, stance: opts.stance ?? "SUPPORT", relevantCoopIds: opts.coopIds ?? [], sourceDate: opts.date ?? "2026-10-10" },
});

beforeEach(() => {
  vi.clearAllMocks();
  db.aIObservation.findMany.mockResolvedValue([]);
  db.aIObservation.updateMany.mockResolvedValue({ count: 0 });
  db.userCoopMembership.findMany.mockResolvedValue([{ coopId: "harbor" }]);
  db.coopConfig.findMany.mockResolvedValue([{ coopId: "harbor", name: "Harbor Commons" }]);
  db.auditLog.create.mockResolvedValue({});
});

describe("reading what a member asked Sage to remember", () => {
  it("reads only this member's private, consented, unexpired rows and audits the read", async () => {
    await loadMemberMemory({ memberId: "member-1", purpose: "sage dm reply", now: NOW });
    expect(db.aIObservation.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      scopeType: "member", scopeId: "member-1", visibility: "PRIVATE_TO_AUTHOR_SCOPE", status: "ACTIVE",
      generatedByAgentKey: "sage-member-signal", type: { in: ["member_need_signal", "member_need_resolution"] },
      OR: [{ expiresAt: null }, { expiresAt: { gt: NOW } }],
    } }));
    expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      actorId: "system/sage", action: "SAGE_MEMBER_MEMORY_READ", resourceId: "member-1",
      metadata: expect.objectContaining({ purpose: "sage dm reply", returned: 0 }),
    }) });
  });

  it("keeps one line per theme with the newest answer winning, and names the Commons it came from", async () => {
    db.aIObservation.findMany.mockResolvedValueOnce([
      signal("r3", "transportation_access", { stance: "CONTRADICT", date: "2026-10-12", coopIds: ["harbor"] }),
      signal("r2", "food_access", { date: "2026-10-11" }),
      signal("r1", "transportation_access", { date: "2026-10-01", coopIds: ["harbor"] }),
    ]);
    const items = await loadMemberMemory({ memberId: "member-1", purpose: "test", now: NOW });
    expect(items.map((item) => [item.themeKey, item.resolved, item.rowIds])).toEqual([
      ["transportation_access", true, ["r3", "r1"]],
      ["food_access", false, ["r2"]],
    ]);
    expect(memberMemoryLines(items)).toEqual([
      "2026-10-12: transportation access is no longer a need (Harbor Commons)",
      "2026-10-11: a need around food access",
    ]);
  });

  it("leaves out themes from a Commons the member left, and other Commons' themes when writing about one", async () => {
    db.aIObservation.findMany.mockResolvedValue([
      signal("left", "housing_stability", { coopIds: ["old-commons"] }),
      signal("other", "food_access", { coopIds: ["riverside"] }),
      signal("here", "transportation_access", { coopIds: ["harbor"] }),
      signal("anywhere", "belonging_connection"),
    ]);
    db.userCoopMembership.findMany.mockResolvedValue([{ coopId: "harbor" }, { coopId: "riverside" }]);
    const all = await loadMemberMemory({ memberId: "member-1", purpose: "test", now: NOW });
    expect(all.map((item) => item.themeKey)).toEqual(["food_access", "transportation_access", "belonging_connection"]);
    const focused = await loadMemberMemory({ memberId: "member-1", purpose: "weekly", focusCoopId: "harbor", now: NOW });
    expect(focused.map((item) => item.themeKey)).toEqual(["transportation_access", "belonging_connection"]);
  });

  it("stays within its item and character budget", async () => {
    const themes = ["transportation_access", "food_access", "housing_stability", "belonging_connection", "time_and_workload", "safety_access", "shared_resources"];
    db.aIObservation.findMany.mockResolvedValueOnce(themes.map((theme, i) => signal(`r${i}`, theme, { coopIds: ["harbor"] })));
    const items = await loadMemberMemory({ memberId: "member-1", purpose: "test", now: NOW });
    expect(items.length).toBeLessThanOrEqual(5);
    expect(memberMemoryLines(items).join("").length).toBeLessThanOrEqual(MEMBER_MEMORY_MAX_CHARS);
  });
});

describe("recognizing memory requests", () => {
  it("knows the ways members ask what Sage remembers and ask it to forget", () => {
    expect(parseMemberMemoryRequest("What do you remember about me?")).toEqual({ kind: "list" });
    expect(parseMemberMemoryRequest("what do you know about me")).toEqual({ kind: "list" });
    expect(parseMemberMemoryRequest("Forget that")).toEqual({ kind: "forget", target: "latest" });
    expect(parseMemberMemoryRequest("please forget about it.")).toEqual({ kind: "forget", target: "latest" });
    expect(parseMemberMemoryRequest("forget 2")).toEqual({ kind: "forget", target: 2 });
    expect(parseMemberMemoryRequest("Forget everything")).toEqual({ kind: "forget", target: "all" });
    expect(parseMemberMemoryRequest("can you forget about my ride situation?")).toEqual({ kind: "forget", target: { words: "my ride situation" } });
  });

  it("leaves ordinary conversation to the model", () => {
    expect(parseMemberMemoryRequest("Don't forget the potluck on Saturday")).toBeNull();
    expect(parseMemberMemoryRequest("Can you delete my post?")).toBeNull();
    expect(parseMemberMemoryRequest(`I keep forgetting ${"x".repeat(150)}`)).toBeNull();
    expect(parseMemberMemoryRequest("How was the meeting?")).toBeNull();
  });

  it("doesn't treat asking what Sage remembers as permission to remember something new", () => {
    expect(classifyPrivateSignal("What do you remember about my ride situation?").rememberConsent).toBe(false);
    expect(classifyPrivateSignal("Please remember I need a ride on Tuesdays").rememberConsent).toBe(true);
  });
});

describe("answering memory requests in code", () => {
  beforeEach(() => {
    db.aIObservation.findMany.mockResolvedValue([
      signal("r2", "food_access", { date: "2026-10-12" }),
      signal("r1", "transportation_access", { date: "2026-10-01", coopIds: ["harbor"] }),
      signal("r0", "transportation_access", { date: "2026-09-20", coopIds: ["harbor"] }),
    ]);
  });

  it("lists what Sage remembers, numbered, with how to forget", async () => {
    const answer = await handleMemberMemoryRequest({ memberId: "member-1", content: "What do you remember about me?", now: NOW });
    expect(answer?.reply).toBe([
      "Here's what you've asked me to remember:",
      "1. 2026-10-12: a need around food access",
      "2. 2026-10-01: a need around transportation access (Harbor Commons)",
      "",
      "Say \"forget 1\" (or another number), \"forget that\" for the newest, or \"forget everything\". I only use these in our private conversations, and in anonymous Commons-wide patterns only where you told me that was OK.",
    ].join("\n"));
    expect(db.aIObservation.updateMany).not.toHaveBeenCalled();
  });

  it("says plainly when it keeps nothing", async () => {
    db.aIObservation.findMany.mockResolvedValue([]);
    const answer = await handleMemberMemoryRequest({ memberId: "member-1", content: "what do you remember about me", now: NOW });
    expect(answer?.reply).toMatch(/^I'm not keeping anything about you right now/);
  });

  it("forgets a numbered theme, including older rows about it, only within this member's memory", async () => {
    const answer = await handleMemberMemoryRequest({ memberId: "member-1", content: "forget 2", now: NOW });
    expect(db.aIObservation.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["r1", "r0"] }, scopeType: "member", scopeId: "member-1", generatedByAgentKey: "sage-member-signal" },
      data: { status: "DISMISSED" },
    });
    expect(answer?.reply).toMatch(/^Done\. I've forgotten that you mentioned transportation access\./);
    expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      actorId: "member-1", action: "SAGE_MEMBER_MEMORY_FORGOTTEN", metadata: { themes: ["transportation_access"], rows: 2, all: false },
    }) });
  });

  it("forgets by naming the theme, or everything at once", async () => {
    await handleMemberMemoryRequest({ memberId: "member-1", content: "forget about my rides", now: NOW });
    expect(db.aIObservation.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { in: ["r1", "r0"] } }) }));
    const all = await handleMemberMemoryRequest({ memberId: "member-1", content: "forget everything", now: NOW });
    expect(db.aIObservation.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { in: ["r2", "r1", "r0"] } }) }));
    expect(all?.reply).toMatch(/everything you asked me to remember \(2 things\)/);
  });

  it("only treats a bare \"forget that\" as a memory request right after Sage talked about remembering", async () => {
    expect(await handleMemberMemoryRequest({ memberId: "member-1", content: "forget that", lastSageMessage: "Want me to post this for you?", now: NOW })).toBeNull();
    expect(db.aIObservation.updateMany).not.toHaveBeenCalled();
    const answer = await handleMemberMemoryRequest({
      memberId: "member-1", content: "forget that", lastSageMessage: "Here's what you've asked me to remember:\n1. …", now: NOW,
    });
    expect(answer?.reply).toMatch(/forgotten that you mentioned food access/);
  });

  it("passes a named thing it doesn't keep back to the conversation", async () => {
    expect(await handleMemberMemoryRequest({ memberId: "member-1", content: "forget about the weather", now: NOW })).toBeNull();
    expect(db.aIObservation.updateMany).not.toHaveBeenCalled();
  });
});
