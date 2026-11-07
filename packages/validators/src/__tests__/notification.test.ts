import { describe, expect, it } from "vitest";

import {
  circleNotificationLevelSchema,
  defaultCircleNotificationLevel,
  notificationCategory,
  parseCircleNotificationLevel,
} from "../notification.js";

describe("notification categories", () => {
  it("routes General rhythm posts through Community and other Sage activity through Sage", () => {
    expect(notificationCategory("SAGE_RHYTHM")).toBe("community");
    expect(notificationCategory("SAGE_PRE_VOTE")).toBe("sage");
    expect(notificationCategory("SAGE_COMMENT")).toBe("sage");
  });
});

describe("circle notification levels", () => {
  it("defaults new and missing circle preferences to Highlights", () => {
    expect(defaultCircleNotificationLevel).toBe("HIGHLIGHTS");
    expect(parseCircleNotificationLevel(undefined)).toBe("HIGHLIGHTS");
    expect(parseCircleNotificationLevel("not-a-level")).toBe("HIGHLIGHTS");
  });

  it("accepts Highlights as a saved circle preference", () => {
    expect(circleNotificationLevelSchema.parse("HIGHLIGHTS")).toBe(
      "HIGHLIGHTS",
    );
  });
});
