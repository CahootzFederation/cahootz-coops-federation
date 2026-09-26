import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { PostHog } from "posthog-react-native";

import * as analytics from "../analytics";

const mockClient = {
  capture: jest.fn(),
  identify: jest.fn(),
  register: jest.fn(async () => {}),
  reset: jest.fn(),
  screen: jest.fn(async () => {}),
};

jest.mock("posthog-react-native", () => ({
  PostHog: jest.fn(() => mockClient),
}));
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));

function allSentPayloads() {
  return JSON.stringify([
    mockClient.capture.mock.calls,
    mockClient.identify.mock.calls,
    mockClient.register.mock.calls,
    mockClient.screen.mock.calls,
  ]);
}

beforeEach(() => {
  jest.clearAllMocks();
  analytics.__resetAnalyticsForTests();
});

describe("analytics without a key", () => {
  it("never loads the SDK, stores nothing, and every call is a no-op", async () => {
    // Jest runs without EXPO_PUBLIC_POSTHOG_KEY, like dev, CI and E2E.
    analytics.initAnalytics();
    analytics.identify("user-1", { coopId: "cahootz" });
    analytics.track("app_opened", { source: "cold_start", is_first_open: true, signed_in: false });
    analytics.track("signed_in");
    analytics.screen("/profile-onboarding");
    analytics.reset();

    expect(analytics.isAnalyticsEnabled()).toBe(false);
    expect(await analytics.consumeFirstOpen()).toBe(false);
    expect(PostHog).not.toHaveBeenCalled();
    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(allSentPayloads()).toBe("[[],[],[],[]]");
  });

  it("treats a blank key as unset", () => {
    analytics.initAnalytics({ apiKey: "   " });
    analytics.track("signed_in");
    expect(PostHog).not.toHaveBeenCalled();
  });
});

describe("analytics with a key", () => {
  const init = () => analytics.initAnalytics({ apiKey: "phc_test" });

  it("initializes once with privacy-preserving options", () => {
    init();
    init();
    expect(analytics.isAnalyticsEnabled()).toBe(true);

    expect(PostHog).toHaveBeenCalledTimes(1);
    expect(PostHog).toHaveBeenCalledWith(
      "phc_test",
      expect.objectContaining({
        host: "https://us.i.posthog.com",
        captureAppLifecycleEvents: false,
        personProfiles: "identified_only",
        disableGeoip: true,
        enableSessionReplay: false,
      }),
    );
  });

  it("uses a configured host", () => {
    analytics.initAnalytics({ apiKey: "phc_test", host: "https://ph.example.test" });
    expect(PostHog).toHaveBeenCalledWith("phc_test", expect.objectContaining({ host: "https://ph.example.test" }));
  });

  it("identifies by internal id with only the coop id attached, once per user", () => {
    init();
    analytics.identify("user-1", { coopId: "cahootz" });
    analytics.identify("user-1", { coopId: "cahootz" });

    expect(mockClient.identify).toHaveBeenCalledTimes(1);
    expect(mockClient.identify).toHaveBeenCalledWith("user-1", { coop_id: "cahootz" });
    expect(mockClient.register).toHaveBeenCalledWith({ coop_id: "cahootz" });

    analytics.reset();
    expect(mockClient.reset).toHaveBeenCalledTimes(1);
    analytics.identify("user-1", { coopId: "cahootz" });
    expect(mockClient.identify).toHaveBeenCalledTimes(2);
  });

  it("never sends PII even if a caller smuggles it into an event", () => {
    init();
    analytics.track("notification_opened", {
      channel: "push",
      notification_type: "MENTION",
      // Not part of the typed event; simulates a careless future caller.
      ...({
        email: "person@example.com",
        userEmail: "person@example.com",
        phone: "+1 555 123 4567",
        wallet_address: "0x1234567890abcdef1234567890abcdef12345678",
        name: "Real Name",
        handle: "releaseclick1",
        message: "hello there",
        body: "post content",
        comment: "reach me at person@example.com",
        contact: "(555) 123-4567",
        recipient: "0x1234567890ABCDEF1234567890abcdef12345678",
        user: { email: "person@example.com" },
      } as object),
    } as analytics.AnalyticsEvents["notification_opened"]);

    expect(mockClient.capture).toHaveBeenCalledWith("notification_opened", {
      channel: "push",
      notification_type: "MENTION",
    });
    const sent = allSentPayloads();
    for (const pii of ["person@example.com", "555", "0x1234", "Real Name", "releaseclick1", "hello there", "post content"]) {
      expect(sent).not.toContain(pii);
    }
  });

  it("records screens by route pattern and skips repeats", () => {
    init();
    analytics.screen(analytics.routeNameFromSegments(["(tabs)", "people", "[handle]"]));
    analytics.screen("/people/[handle]");
    expect(mockClient.screen).toHaveBeenCalledTimes(1);
    expect(mockClient.screen).toHaveBeenCalledWith("/people/[handle]");
  });

  it("reports first open only once per install", async () => {
    init();
    jest.mocked(AsyncStorage.getItem).mockResolvedValueOnce(null).mockResolvedValueOnce("2026-09-26T00:00:00.000Z");
    expect(await analytics.consumeFirstOpen()).toBe(true);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith("cahootz.analytics.firstOpenedAt", expect.any(String));
    expect(await analytics.consumeFirstOpen()).toBe(false);
  });
});

describe("helpers", () => {
  it("keeps safe primitives and drops PII-looking keys, values, and objects", () => {
    expect(
      analytics.sanitizeProperties({
        step: "profile",
        signed_in: true,
        days_since_signup: 3,
        coop_id: "cahootz",
        signup_date: "2026-09-26",
        notification_type: "POST_COMMENT",
        firstName: "Real",
        email_address: "a@b.co",
        note: "call 555-123-4567",
        nested: { a: 1 },
        list: [1],
        missing: undefined,
      }),
    ).toEqual({
      step: "profile",
      signed_in: true,
      days_since_signup: 3,
      coop_id: "cahootz",
      signup_date: "2026-09-26",
      notification_type: "POST_COMMENT",
    });
    expect(analytics.sanitizeProperties({ contact: "555-123-4567" })).toEqual({});
  });

  it("derives route names without route groups", () => {
    expect(analytics.routeNameFromSegments([])).toBe("/");
    expect(analytics.routeNameFromSegments(["(authenticated)", "sage", "[id]"])).toBe("/sage/[id]");
    expect(analytics.routeNameFromSegments(["[coopId]", "posts"])).toBe("/[coopId]/posts");
  });

  it("computes whole days since signup", () => {
    const now = Date.parse("2026-09-26T12:00:00Z");
    expect(analytics.daysSince("2026-09-19T13:00:00Z", now)).toBe(6);
    expect(analytics.daysSince(new Date(now), now)).toBe(0);
    expect(analytics.daysSince(null, now)).toBeUndefined();
    expect(analytics.daysSince("not a date", now)).toBeUndefined();
  });
});
