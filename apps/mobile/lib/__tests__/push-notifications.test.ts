import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

import { api } from "../api";
import {
  getPushPermissionStatus,
  registerForNativePushNotifications,
} from "../push-notifications";

jest.mock("../api", () => ({
  api: { getNotificationPreferences: jest.fn(), registerPushDevice: jest.fn() },
}));
jest.mock("expo-constants", () => ({
  easConfig: { projectId: "test-project" },
  expoConfig: { version: "1" },
}));
jest.mock("expo-notifications", () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  AndroidImportance: { DEFAULT: 3 },
  IosAuthorizationStatus: { PROVISIONAL: 3 },
}));

describe("native push permissions", () => {
  afterEach(() => { jest.restoreAllMocks(); });
  beforeEach(() => {
    jest.clearAllMocks();
    Platform.OS = "ios";
    jest
      .mocked(api.getNotificationPreferences)
      .mockResolvedValue({
        pushEnabled: true,
        community: true,
        governance: true,
        payments: true,
        orders: true,
        other: true,
      });
    jest.mocked(api.registerPushDevice).mockResolvedValue({ success: true });
    jest
      .mocked(Notifications.getExpoPushTokenAsync)
      .mockResolvedValue({ type: "expo", data: "ExponentPushToken[test]" });
  });
  it("does not request permissions or register on web", async () => {
    Platform.OS = "web";
    expect(await registerForNativePushNotifications("session")).toEqual({
      registered: false,
    });
    expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
    expect(await getPushPermissionStatus()).toContain("mobile app");
  });
  it("does not prompt or register when the saved master setting is off", async () => {
    jest
      .mocked(api.getNotificationPreferences)
      .mockResolvedValue({
        pushEnabled: false,
        community: true,
        governance: true,
        payments: true,
        orders: true,
        other: true,
      });
    expect(await registerForNativePushNotifications("session")).toEqual({
      registered: false,
    });
    expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
    expect(api.registerPushDevice).not.toHaveBeenCalled();
  });
  it("does not register after permission denial", async () => {
    jest
      .mocked(Notifications.getPermissionsAsync)
      .mockResolvedValue({
        granted: false,
        status: "denied",
        canAskAgain: false,
      } as never);
    jest
      .mocked(Notifications.requestPermissionsAsync)
      .mockResolvedValue({ granted: false, status: "denied" } as never);
    expect(await registerForNativePushNotifications("session")).toEqual({
      registered: false,
    });
    expect(api.registerPushDevice).not.toHaveBeenCalled();
    expect(await getPushPermissionStatus()).toContain("blocked");
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });
  it("asks an undecided user automatically after sign-in", async () => {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ granted: false, status: 'undetermined', canAskAgain: true } as never);
    jest.mocked(Notifications.requestPermissionsAsync).mockResolvedValue({ granted: true, status: 'granted' } as never);
    await expect(registerForNativePushNotifications('session', 'cahootz', { onlyAskIfUndetermined: true })).resolves.toEqual({ registered: true });
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(api.registerPushDevice).toHaveBeenCalledTimes(1);
  });
  it("does not automatically ask again after an earlier denial", async () => {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ granted: false, status: 'denied', canAskAgain: true } as never);
    await expect(registerForNativePushNotifications('session', 'cahootz', { onlyAskIfUndetermined: true })).resolves.toEqual({ registered: false });
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(api.registerPushDevice).not.toHaveBeenCalled();
  });
  it("registers a granted device with the session without prompting again", async () => {
    jest
      .mocked(Notifications.getPermissionsAsync)
      .mockResolvedValue({ granted: true, status: "granted" } as never);
    expect(await registerForNativePushNotifications("session")).toEqual({
      registered: true,
    });
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(api.registerPushDevice).toHaveBeenCalledWith(
      expect.objectContaining({
        expoPushToken: "ExponentPushToken[test]",
        platform: "ios",
      }),
      "session",
    );
  });
  it("accepts iOS provisional permissions", async () => {
    jest
      .mocked(Notifications.getPermissionsAsync)
      .mockResolvedValue({
        granted: false,
        status: "undetermined",
        ios: { status: 3 },
      } as never);
    expect(await registerForNativePushNotifications("session")).toEqual({
      registered: true,
    });
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });
  it("creates the Android channel used by the server payload", async () => {
    Platform.OS = "android";
    jest
      .mocked(Notifications.getPermissionsAsync)
      .mockResolvedValue({ granted: true, status: "granted" } as never);
    await registerForNativePushNotifications("session");
    expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith(
      "commons",
      expect.any(Object),
    );
  });

  it("identifies an Expo token failure before attempting API registration", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ granted: true } as never);
    jest.mocked(Notifications.getExpoPushTokenAsync).mockRejectedValueOnce(
      Object.assign(new Error('Missing aps-environment entitlement'), { code: 'ERR_NOTIFICATIONS' }),
    );
    await expect(registerForNativePushNotifications('test-session-secret')).rejects.toMatchObject({
      step: 'Get Expo push token', message: 'Missing aps-environment entitlement',
    });
    expect(warn).toHaveBeenCalledWith('[push] Registration failed', expect.objectContaining({ step: 'Get Expo push token', code: 'ERR_NOTIFICATIONS' }));
    expect(api.registerPushDevice).not.toHaveBeenCalled();
  });

  it("redacts session and device tokens from API failure logs and rethrown errors", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ granted: true } as never);
    jest.mocked(api.registerPushDevice).mockRejectedValueOnce(new Error('Failed for test-session-secret ExponentPushToken[test]'));
    await expect(registerForNativePushNotifications('test-session-secret')).rejects.toMatchObject({
      step: 'Save device with API', message: 'Failed for [redacted] [redacted]',
    });
    const logs = JSON.stringify(warn.mock.calls);
    expect(logs).not.toContain('test-session-secret');
    expect(logs).not.toContain('ExponentPushToken[test]');
  });
});
