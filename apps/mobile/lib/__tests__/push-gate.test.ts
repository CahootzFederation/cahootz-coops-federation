import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { Platform } from "react-native";

import { api } from "../api";
import { askForPushFromGate, checkPushOnOpen, pushGateStep } from "../push-gate";
import { getPushPermissionState, registerForNativePushNotifications } from "../push-notifications";

jest.mock("../api", () => ({
  api: { getNotificationPreferences: jest.fn() },
}));
jest.mock("../push-notifications", () => ({
  getPushPermissionState: jest.fn(),
  registerForNativePushNotifications: jest.fn(),
}));

const permission = getPushPermissionState as jest.MockedFunction<typeof getPushPermissionState>;
const register = registerForNativePushNotifications as jest.MockedFunction<typeof registerForNativePushNotifications>;
const preferences = api.getNotificationPreferences as jest.MockedFunction<typeof api.getNotificationPreferences>;

beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = "ios";
  preferences.mockResolvedValue({ pushEnabled: true } as any);
  register.mockResolvedValue({ registered: true });
});

describe("pushGateStep", () => {
  it("asks a phone that was never asked, and sends a phone that said no to Settings", () => {
    expect(pushGateStep("undetermined", true)).toBe("ask");
    expect(pushGateStep("blocked", true)).toBe("settings");
  });

  it("shows nothing once allowed, on web, or when push is switched off in our settings", () => {
    expect(pushGateStep("granted", true)).toBe("none");
    expect(pushGateStep("unsupported", true)).toBe("none");
    expect(pushGateStep("undetermined", false)).toBe("none");
    expect(pushGateStep("blocked", false)).toBe("none");
  });
});

describe("checkPushOnOpen", () => {
  it("asks again on every open while the phone hasn't allowed notifications", async () => {
    permission.mockResolvedValue("undetermined");
    expect(await checkPushOnOpen("session")).toBe("ask");
    expect(await checkPushOnOpen("session")).toBe("ask");
    permission.mockResolvedValue("blocked");
    expect(await checkPushOnOpen("session")).toBe("settings");
    // Opening the app never shows the system popup by itself.
    expect(register).not.toHaveBeenCalled();
  });

  it("quietly re-registers an allowed phone on every open", async () => {
    permission.mockResolvedValue("granted");
    expect(await checkPushOnOpen("session")).toBe("none");
    expect(register).toHaveBeenCalledWith("session", { neverAsk: true });
  });

  it("still settles when re-registering fails", async () => {
    permission.mockResolvedValue("granted");
    register.mockRejectedValue(new Error("offline"));
    jest.spyOn(console, "warn").mockImplementation(() => {});
    expect(await checkPushOnOpen("session")).toBe("none");
  });

  it("does nothing on web", async () => {
    Platform.OS = "web";
    expect(await checkPushOnOpen("session")).toBe("none");
    expect(permission).not.toHaveBeenCalled();
  });
});

describe("askForPushFromGate", () => {
  it("shows the system popup and reports whether the phone is now registered", async () => {
    expect(await askForPushFromGate("session")).toBe(true);
    expect(register).toHaveBeenCalledWith("session", { source: "app_open" });
    register.mockResolvedValue({ registered: false });
    expect(await askForPushFromGate("session")).toBe(false);
  });
});
