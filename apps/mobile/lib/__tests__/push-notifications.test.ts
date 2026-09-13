import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

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
});
