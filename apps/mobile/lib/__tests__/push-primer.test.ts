import { describe, expect, it, jest } from "@jest/globals";

import { PUSH_PRIMER_SNOOZE_MS, shouldOfferPushPrimer } from "../push-primer";

jest.mock("../secure-storage", () => ({
  secureStorage: { getItem: jest.fn(), setItem: jest.fn() },
}));
jest.mock("../push-notifications", () => ({
  getPushPermissionState: jest.fn(),
  registerForNativePushNotifications: jest.fn(),
}));

describe("shouldOfferPushPrimer", () => {
  const now = Date.UTC(2026, 8, 26);

  it("offers the primer to an undecided device that never dismissed it", () => {
    expect(shouldOfferPushPrimer("undetermined", null, now)).toBe(true);
    expect(shouldOfferPushPrimer("unsupported", null, now)).toBe(true);
  });

  it("never offers it once the OS has granted or blocked notifications", () => {
    expect(shouldOfferPushPrimer("granted", null, now)).toBe(false);
    expect(shouldOfferPushPrimer("blocked", null, now)).toBe(false);
  });

  it("stays quiet after a recent 'Not now' and comes back after the snooze", () => {
    expect(shouldOfferPushPrimer("undetermined", now - 60_000, now)).toBe(false);
    expect(shouldOfferPushPrimer("undetermined", now - PUSH_PRIMER_SNOOZE_MS - 1, now)).toBe(true);
  });
});
