import { describe, expect, it } from "vitest";

import {
  circleNotificationLevelSchema,
  defaultCircleNotificationLevel,
  parseCircleNotificationLevel,
} from "../notification.js";

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
