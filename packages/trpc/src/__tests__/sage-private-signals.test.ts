import { describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  groupComment: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
  auditLog: { create: vi.fn().mockResolvedValue({}) },
  featureFlag: { findUnique: vi.fn() },
}));
vi.mock("@repo/db", () => ({ db }));

import { classifyPrivateSignal, handlePrivateCheckinSignal, memoryConsentQuestion, privateSafetyReply } from "../services/sage-private-signals.js";

describe("private check-in signal gate", () => {
  it("keeps sensitive and urgent disclosures out of aggregation", () => {
    const urgent = classifyPrivateSignal("I am thinking about suicide and need a ride");
    expect(urgent.urgent).toBe(true);
    expect(memoryConsentQuestion(urgent)).toBeNull();

    const sensitive = classifyPrivateSignal("My medical diagnosis makes transportation hard");
    expect(sensitive.sensitiveCategory).toBe("medical");
    expect(memoryConsentQuestion(sensitive)).toBeNull();
  });

  it("separates remembering from anonymous aggregation permission", () => {
    const privateOnly = classifyPrivateSignal("Please remember that I need a ride on Tuesdays");
    expect(privateOnly.rememberConsent).toBe(true);
    expect(privateOnly.aggregationConsent).toBe(false);

    const aggregate = classifyPrivateSignal("You can use this anonymously as a community pattern: I need a ride");
    expect(aggregate.rememberConsent).toBe(true);
    expect(aggregate.aggregationConsent).toBe(true);
  });

  it("recognizes resolution as contradictory evidence, not missing evidence", () => {
    const result = classifyPrivateSignal("Please remember this: transportation is no longer an issue");
    expect(result.themeKey).toBe("transportation_access");
    expect(result.stance).toBe("CONTRADICT");
  });
});

describe("urgent disclosure in a check-in reply", () => {
  it("always sends the fixed safety reply, with no feature flag", async () => {
    db.groupComment.findFirst.mockResolvedValue({ id: "checkin", content: "How was your week?", createdAt: new Date() });
    const result = await handlePrivateCheckinSignal({
      groupId: "g", coopId: "c", userId: "u", messageId: "m", content: "Honestly I've been thinking about suicide", createdAt: new Date(),
    });
    expect(result.safetyReply).toBe(privateSafetyReply());
    expect(db.featureFlag.findUnique).not.toHaveBeenCalled();
    expect(db.auditLog.create.mock.calls.map(([arg]) => arg.data.action)).toContain("SAGE_PRIVATE_SAFETY_RESPONSE_OFFERED");
  });
});
