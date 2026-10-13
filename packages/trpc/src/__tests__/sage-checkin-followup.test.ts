import { beforeEach, describe, expect, it, vi } from "vitest";

const runMock = vi.fn();
vi.mock("@openai/agents", () => {
  class MockAgent { constructor(public opts: any) {} }
  return { Agent: MockAgent, run: (...args: unknown[]) => runMock(...args) };
});
vi.mock("../services/ai-cost.js", () => ({ recordAgentResultCost: vi.fn().mockResolvedValue(undefined), recordAICost: vi.fn().mockResolvedValue(undefined) }));

import {
  CHECKIN_FOLLOWUP_MODEL, MAX_CHECKIN_FOLLOWUPS, checkinFollowupAllowed, isClosingFollowup, runCheckinFollowup,
} from "../services/sage-checkin-followup.js";

describe("weekly check-in follow-ups", () => {
  beforeEach(() => {
    runMock.mockReset();
    process.env.OPENAI_API_KEY = "test";
    delete process.env.SAGE_CHECKIN_MODEL;
  });

  it("allows a bounded number of replies per check-in and closes on the last one", () => {
    expect(checkinFollowupAllowed(0)).toBe(true);
    expect(checkinFollowupAllowed(MAX_CHECKIN_FOLLOWUPS - 1)).toBe(true);
    expect(checkinFollowupAllowed(MAX_CHECKIN_FOLLOWUPS)).toBe(false);
    expect(isClosingFollowup(0)).toBe(false);
    expect(isClosingFollowup(MAX_CHECKIN_FOLLOWUPS - 1)).toBe(true);
  });

  it("uses the check-in model and tells the model to stop asking on the closing turn", async () => {
    runMock.mockResolvedValue({ finalOutput: "Glad to hear it." });
    const open = await runCheckinFollowup({ coopId: "c", checkin: "How was your week?", message: "Good", followupsSent: 0 });
    expect(open).toEqual({ reply: "Glad to hear it.", model: CHECKIN_FOLLOWUP_MODEL, usedFallback: false });
    expect(runMock.mock.calls[0][0].opts.instructions).toContain("at most one short follow-up question");

    await runCheckinFollowup({ coopId: "c", checkin: "How was your week?", message: "Thanks", followupsSent: MAX_CHECKIN_FOLLOWUPS - 1 });
    expect(runMock.mock.calls[1][0].opts.instructions).toContain("Do not ask a question");
  });

  it("falls back to a fixed reply without a model key or output", async () => {
    runMock.mockResolvedValue({ finalOutput: "" });
    expect((await runCheckinFollowup({ coopId: "c", checkin: "Hi", message: "ok", followupsSent: 0 })).usedFallback).toBe(true);
    delete process.env.OPENAI_API_KEY;
    const offline = await runCheckinFollowup({ coopId: "c", checkin: "Hi", message: "ok", followupsSent: 0 });
    expect(offline.usedFallback).toBe(true);
    expect(runMock).toHaveBeenCalledTimes(1);
  });

  it("still replies with the fixed follow-up when the model call fails", async () => {
    runMock.mockRejectedValue(new Error("401"));
    const out = await runCheckinFollowup({ coopId: "c", checkin: "Hi", message: "Rough week", followupsSent: 0 });
    expect(out).toMatchObject({ usedFallback: true });
    expect(out.reply).toContain("What would make the biggest difference");
  });
});

describe("Sage reply model by channel", async () => {
  const { sageReplyModel, SAGE_DM_MODEL } = await import("../agents/registry.js");
  it("uses the cheap model for direct outreach and keeps @mentions unchanged", () => {
    delete process.env.SAGE_DM_MODEL;
    delete process.env.COMMONS_AI_MODEL;
    expect(sageReplyModel("dm")).toBe(SAGE_DM_MODEL);
    expect(sageReplyModel(undefined)).toBe("gpt-5.2");
  });
});
