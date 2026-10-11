import { describe, expect, it, vi } from "vitest";

vi.mock("@repo/db", () => ({ db: {} }));

import { assignedOutreachAt, isoWeekKey, outreachIsDue, stableOutreachWeekday } from "../services/sage-weekly-outreach.js";

describe("Sage weekly outreach scheduling", () => {
  it("assigns a stable weekday without stored member state", () => {
    const day = stableOutreachWeekday("member-1", "v1");
    expect(day).toBeGreaterThanOrEqual(0);
    expect(day).toBeLessThan(7);
    expect(stableOutreachWeekday("member-1", "v1")).toBe(day);
  });

  it("creates ISO week keys across year boundaries", () => {
    expect(isoWeekKey(new Date("2027-01-01T12:00:00Z"))).toBe("2026-W53");
    expect(isoWeekKey(new Date("2027-01-04T12:00:00Z"))).toBe("2027-W01");
  });

  it("is due after the assigned time and supports a bounded recovery window", () => {
    const week = new Date("2026-10-12T00:00:00Z");
    const scheduled = assignedOutreachAt("member-1", week, "v1");
    expect(outreachIsDue({ userId: "member-1", now: new Date(scheduled.getTime() + 60_000), enabledAt: new Date("2026-01-01"), scheduleVersion: "v1" })).toBe(true);
    expect(outreachIsDue({ userId: "member-1", now: new Date(scheduled.getTime() + 49 * 3_600_000), enabledAt: new Date("2026-01-01"), scheduleVersion: "v1" })).toBe(false);
  });

  it("does not backfill an assignment from before the feature was enabled", () => {
    const week = new Date("2026-10-12T00:00:00Z");
    const scheduled = assignedOutreachAt("member-2", week, "v1");
    expect(outreachIsDue({
      userId: "member-2",
      now: new Date(scheduled.getTime() + 60_000),
      enabledAt: new Date(scheduled.getTime() + 1),
      scheduleVersion: "v1",
    })).toBe(false);
  });
});
