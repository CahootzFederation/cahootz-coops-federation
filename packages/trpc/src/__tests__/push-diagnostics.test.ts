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
  });
  expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-device-token");
});
