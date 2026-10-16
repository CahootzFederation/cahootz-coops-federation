import { afterEach, describe, expect, it, vi } from "vitest";

import { ACTIVITY_TOUCH_INTERVAL_MS, shouldTouchActivity, touchMemberActivity } from "../lib/member-activity.js";
import { isDeliverableEmail, memberAppLinkUrl } from "../services/onboarding-drip-config.js";

// The day 1/3/7 drip was replaced by Sage's activation journey (sage-activation.test.ts). These are the
// shared helpers it left behind.

describe("member activity throttle", () => {
  const now = new Date("2026-09-26T12:00:00Z");

  it("writes at most once per 15 minutes", () => {
    expect(shouldTouchActivity(null, now)).toBe(true);
    expect(shouldTouchActivity(new Date(now.getTime() - 5 * 60 * 1000), now)).toBe(false);
    expect(shouldTouchActivity(new Date(now.getTime() - ACTIVITY_TOUCH_INTERVAL_MS), now)).toBe(true);
  });

  it("skips the write when fresh and never throws when the write fails", async () => {
    const db = { user: { updateMany: vi.fn().mockRejectedValue(new Error("db down")) } };
    await touchMemberActivity(db, { id: "u1", lastActiveAt: new Date(now.getTime() - 60_000) }, now);
    expect(db.user.updateMany).not.toHaveBeenCalled();
    await expect(touchMemberActivity(db, { id: "u1", lastActiveAt: null }, now)).resolves.toBeUndefined();
    expect(db.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "u1" }), data: { lastActiveAt: now } }),
    );
  });
});

describe("email helpers", () => {
  afterEach(() => {
    delete process.env.MEMBER_APP_LINK_URL;
    delete process.env.APP_URL;
  });

  it("defaults the app link to the App Store listing and ignores APP_URL", () => {
    process.env.APP_URL = "http://localhost:3000";
    expect(memberAppLinkUrl()).toBe("https://apps.apple.com/us/app/cahootz-commons/id6772781102");
  });

  it("uses MEMBER_APP_LINK_URL when set", () => {
    process.env.MEMBER_APP_LINK_URL = "https://apps.apple.com/app/id123";
    expect(memberAppLinkUrl()).toBe("https://apps.apple.com/app/id123");
  });

  it("never emails bots or seeded test addresses", () => {
    expect(isDeliverableEmail("ada@example.com")).toBe(true);
    expect(isDeliverableEmail("sage@bot.cahootz.internal")).toBe(false);
    expect(isDeliverableEmail("releaseclick1@test.cahootz.local")).toBe(false);
    expect(isDeliverableEmail(null)).toBe(false);
  });
});
