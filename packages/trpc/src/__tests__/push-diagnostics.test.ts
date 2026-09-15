import { afterEach, expect, it, vi } from "vitest";

import { createNotificationAndPush } from "../services/push-notification-service";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
    code: "DeviceNotRegistered",
  });
  expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-device-token");
});
