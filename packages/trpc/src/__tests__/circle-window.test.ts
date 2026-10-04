import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({
  $executeRaw: vi.fn(),
  circleAgentWindow: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
}));
const db = vi.hoisted(() => ({ $transaction: vi.fn((fn: (client: unknown) => unknown) => fn(tx)) }));
const dispatch = vi.hoisted(() => ({ enqueueSageRideMatchDetect: vi.fn(), enqueueSageTrendDetect: vi.fn() }));

vi.mock("@repo/db", () => ({ db }));
vi.mock("../services/sage-dispatch.js", () => dispatch);

const { touchCircleWindow, CIRCLE_WINDOW_MESSAGE_LIMIT } = await import("../services/circle-window.js");

beforeEach(() => vi.clearAllMocks());

describe("circle analysis window", () => {
  it("takes a per-circle lock before reading the open window", async () => {
    tx.circleAgentWindow.findFirst.mockResolvedValue(null);
    await touchCircleWindow("g1", "harbor");
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw.mock.invocationCallOrder[0]!).toBeLessThan(tx.circleAgentWindow.findFirst.mock.invocationCallOrder[0]!);
    expect(tx.circleAgentWindow.create).toHaveBeenCalledWith({ data: expect.objectContaining({ groupId: "g1", coopId: "harbor", messageCount: 1 }) });
    expect(dispatch.enqueueSageTrendDetect).not.toHaveBeenCalled();
  });

  it("closes the window at the cap and dispatches detection after the transaction", async () => {
    tx.circleAgentWindow.findFirst.mockResolvedValue({ id: "w1", messageCount: CIRCLE_WINDOW_MESSAGE_LIMIT - 1 });
    await touchCircleWindow("g1", "harbor");
    expect(tx.circleAgentWindow.update).toHaveBeenCalledWith({ where: { id: "w1" }, data: expect.objectContaining({ status: "CLOSED" }) });
    expect(dispatch.enqueueSageRideMatchDetect).toHaveBeenCalledWith("w1");
    expect(dispatch.enqueueSageTrendDetect).toHaveBeenCalledWith("w1");
    expect(db.$transaction.mock.invocationCallOrder[0]!).toBeLessThan(dispatch.enqueueSageTrendDetect.mock.invocationCallOrder[0]!);
  });
});

describe("analyze a circle now", () => {
  it("closes the open window early and dispatches detection", async () => {
    tx.circleAgentWindow.findFirst.mockResolvedValue({ id: "w2", messageCount: 7 });
    const { closeCircleWindowNow } = await import("../services/circle-window.js");
    await expect(closeCircleWindowNow("g1")).resolves.toEqual({ windowId: "w2", messageCount: 7 });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.circleAgentWindow.update).toHaveBeenCalledWith({ where: { id: "w2" }, data: expect.objectContaining({ status: "CLOSED" }) });
    expect(dispatch.enqueueSageTrendDetect).toHaveBeenCalledWith("w2");
    expect(dispatch.enqueueSageRideMatchDetect).toHaveBeenCalledWith("w2");
  });

  it("does nothing when there is no new activity", async () => {
    tx.circleAgentWindow.findFirst.mockResolvedValue(null);
    const { closeCircleWindowNow } = await import("../services/circle-window.js");
    await expect(closeCircleWindowNow("g1")).resolves.toBeNull();
    expect(dispatch.enqueueSageTrendDetect).not.toHaveBeenCalled();
  });
});
