import { afterEach, expect, it, vi } from "vitest";

import { createNotificationAndPush } from "../services/push-notification-service";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it.each([
  { ok: true, status: 200, body: { data: [{ status: 'ok', id: 'receipt-123' }] }, log: '[push] Expo accepted notification (delivery not yet confirmed)', fields: { receiptId: 'receipt-123' } },
  { ok: false, status: 401, body: { errors: [{ code: 'UNAUTHORIZED' }] }, log: '[push] Expo request rejected', fields: { code: 'UNAUTHORIZED' } },
])('reports production send results for HTTP $status', async ({ ok, status, body, log, fields }) => {
  vi.stubEnv('NODE_ENV', 'production');
  const info = vi.spyOn(console, 'info').mockImplementation(() => {});
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok, status, json: async () => body }));
  await createNotificationAndPush({
    notification: { create: vi.fn().mockResolvedValue({ id: 'alert' }) },
    notificationPreference: { findUnique: vi.fn().mockResolvedValue(null) },
    pushDevice: { findMany: vi.fn().mockResolvedValue([{ expoPushToken: 'secret-device-token' }]) },
  }, { userId: 'user', coopId: 'cahootz', type: 'MENTION', title: 'Private title', body: 'Private message' });
  expect(ok ? info : warn).toHaveBeenCalledWith(log, { notificationId: 'alert', type: 'MENTION', ...fields });
  const logs = JSON.stringify([info.mock.calls, warn.mock.calls]);
  expect(logs).not.toContain('secret-device-token');
  expect(logs).not.toContain('Private message');
});

it("reports an Expo ticket error even when HTTP succeeds without logging tokens", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            status: "error",
            message: "secret-device-token",
            details: { error: "DeviceNotRegistered" },
          },
        ],
      }),
    }),
  );
  const db = {
    notification: { create: vi.fn().mockResolvedValue({ id: "alert" }) },
    notificationPreference: { findUnique: vi.fn().mockResolvedValue(null) },
    pushDevice: {
      findMany: vi
        .fn()
        .mockResolvedValue([{ expoPushToken: "secret-device-token" }]),
    },
  };
  await createNotificationAndPush(db, {
    userId: "user",
    coopId: "cahootz",
    type: "MENTION",
    title: "Mention",
    body: "Test",
  });
  expect(db.notification.create).toHaveBeenCalledOnce();
  expect(warn).toHaveBeenCalledWith("[push] Expo ticket rejected", {
    notificationId: "alert",
    type: "MENTION",
    code: "DeviceNotRegistered",
    rawCode: "DeviceNotRegistered",
  });
  expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-device-token");
});

function pushDb(devices: Array<{ id: string; expoPushToken: string }>) {
  return {
    notification: { create: vi.fn().mockResolvedValue({ id: "alert" }) },
    notificationPreference: { findUnique: vi.fn().mockResolvedValue(null) },
    pushDevice: { findMany: vi.fn().mockResolvedValue(devices), updateMany: vi.fn().mockResolvedValue({}) },
    pushTicket: { createMany: vi.fn().mockResolvedValue({}) },
  };
}

it("pushes to every phone the member has, not only the one tied to this Commons", async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ status: "ok", id: "r1" }] }) }));
  const db = pushDb([{ id: "device-1", expoPushToken: "ExponentPushToken[a]" }]);
  await createNotificationAndPush(db, { userId: "user", coopId: "second-commons", type: "MENTION", title: "Hi", body: "Hey" });
  const where = db.pushDevice.findMany.mock.calls[0][0].where;
  expect(where).toEqual({ userId: "user", enabled: true });
  expect(db.pushTicket.createMany).toHaveBeenCalledWith({
    data: [expect.objectContaining({ deviceId: "device-1", coopId: "second-commons", status: "PENDING", expoTicketId: "r1" })],
  });
});

it("records rejected pushes and turns off devices that no longer exist", async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: [
      { status: "ok", id: "r1" },
      { status: "error", message: "ExponentPushToken[dead]", details: { error: "DeviceNotRegistered" } },
    ] }),
  }));
  const db = pushDb([
    { id: "live", expoPushToken: "ExponentPushToken[live]" },
    { id: "dead", expoPushToken: "ExponentPushToken[dead]" },
  ]);
  await createNotificationAndPush(db, { userId: "user", coopId: "cahootz", type: "MENTION", title: "Hi", body: "Hey" });
  expect(db.pushDevice.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["dead"] } }, data: { enabled: false } });
  const rows = db.pushTicket.createMany.mock.calls[0][0].data;
  expect(rows).toEqual([
    expect.objectContaining({ deviceId: "live", status: "PENDING" }),
    expect.objectContaining({ deviceId: "dead", status: "ERROR", errorCode: "DeviceNotRegistered" }),
  ]);
  expect(JSON.stringify(rows)).not.toContain("ExponentPushToken");
});

it("records every device as failed when Expo can't be reached", async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
  const db = pushDb([{ id: "device-1", expoPushToken: "ExponentPushToken[a]" }]);
  await createNotificationAndPush(db, { userId: "user", coopId: "cahootz", type: "MENTION", title: "Hi", body: "Hey" });
  expect(db.pushTicket.createMany.mock.calls[0][0].data).toEqual([
    expect.objectContaining({ deviceId: "device-1", status: "ERROR", errorCode: "RequestFailed" }),
  ]);
});

it("sends the Expo access token when one is configured", async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.stubEnv("EXPO_ACCESS_TOKEN", "expo-secret");
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ status: "ok", id: "r1" }] }) });
  vi.stubGlobal("fetch", fetchMock);
  await createNotificationAndPush(pushDb([{ id: "d", expoPushToken: "ExponentPushToken[a]" }]), {
    userId: "user", coopId: "cahootz", type: "MENTION", title: "Hi", body: "Hey",
  });
  expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer expo-secret");
});
