import { afterEach, expect, it, vi } from "vitest";

import { checkPushReceipts } from "../services/push-receipt-service";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const now = new Date("2026-10-19T12:00:00Z");
const ticket = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  deviceId: `device-${id}`,
  coopId: "cahootz",
  type: "MENTION",
  status: "PENDING",
  expoTicketId: `receipt-${id}`,
  errorCode: null,
  createdAt: new Date(now.getTime() - 20 * 60 * 1000),
  ...overrides,
});

function receiptDb(pending: any[], unalerted: any[] = []) {
  return {
    pushTicket: {
      findMany: vi.fn().mockImplementation(async (args: any) => (args.where.status === "PENDING" ? pending : unalerted)),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({}),
    },
    pushDevice: { updateMany: vi.fn().mockResolvedValue({}) },
  };
}

function stubFetch(receipts: Record<string, unknown>) {
  const slackBodies: any[] = [];
  vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.test/abc");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: any) => {
    if (String(url).includes("getReceipts")) return { ok: true, json: async () => ({ data: receipts }) };
    slackBodies.push(JSON.parse(init.body));
    return { ok: true };
  }));
  return slackBodies;
}

it("marks delivered pushes and stays quiet in Slack when nothing failed", async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  const slack = stubFetch({ "receipt-a": { status: "ok" } });
  const db = receiptDb([ticket("a")]);
  const result = await checkPushReceipts(db, now);
  expect(db.pushTicket.update).toHaveBeenCalledWith({ where: { id: "a" }, data: { status: "DELIVERED", checkedAt: now } });
  expect(result).toMatchObject({ delivered: 1, newFailures: 0, alerted: false });
  expect(slack).toHaveLength(0);
});

it("turns off dead devices, alerts Slack once with a fix, and marks failures alerted", async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  const slack = stubFetch({
    "receipt-a": { status: "error", message: "ExponentPushToken[x]", details: { error: "DeviceNotRegistered" } },
    "receipt-b": { status: "error", details: { error: "InvalidCredentials" } },
  });
  const failed = [
    ticket("a", { status: "ERROR", errorCode: "DeviceNotRegistered" }),
    ticket("b", { status: "ERROR", errorCode: "InvalidCredentials", type: "EVENT_REMINDER" }),
  ];
  const db = receiptDb([ticket("a"), ticket("b")], failed);
  const result = await checkPushReceipts(db, now);

  expect(db.pushDevice.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["device-a"] } }, data: { enabled: false } });
  expect(result).toMatchObject({ failed: 2, newFailures: 2, alerted: true });
  expect(slack).toHaveLength(1);
  expect(slack[0].text).toContain("<!channel>");
  expect(slack[0].text).toContain("2 phone pushes didn't go out");
  expect(slack[0].text).toContain("InvalidCredentials");
  expect(slack[0].text).toContain("eas credentials");
  expect(JSON.stringify(slack)).not.toContain("ExponentPushToken");
  expect(db.pushTicket.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["a", "b"] } }, data: { alertedAt: now } });
});

it("doesn't page the channel when the only failures are deleted apps", async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  const slack = stubFetch({});
  const db = receiptDb([], [ticket("a", { status: "ERROR", errorCode: "DeviceNotRegistered" })]);
  await checkPushReceipts(db, now);
  expect(slack[0].text).not.toContain("<!channel>");
  expect(slack[0].text).toContain("1 phone push didn't go out");
});

it("counts a push with no receipt after a day as failed", async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  stubFetch({});
  const old = ticket("a", { createdAt: new Date(now.getTime() - 25 * 60 * 60 * 1000) });
  const db = receiptDb([old]);
  const result = await checkPushReceipts(db, now);
  expect(db.pushTicket.update).toHaveBeenCalledWith({
    where: { id: "a" },
    data: { status: "ERROR", errorCode: "ReceiptMissing", checkedAt: now },
  });
  expect(result.expired).toBe(1);
});

it("leaves failures unalerted so the next run retries when Slack is down", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.test/abc");
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 })));
  const db = receiptDb([], [ticket("a", { status: "ERROR", errorCode: "InvalidCredentials" })]);
  const result = await checkPushReceipts(db, now);
  expect(result.alerted).toBe(false);
  expect(db.pushTicket.updateMany).not.toHaveBeenCalled();
});
