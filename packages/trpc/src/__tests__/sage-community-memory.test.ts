import { describe, expect, it, vi } from "vitest";

vi.mock("@repo/db", () => ({ db: {} }));

import { buildCommunityCandidate, discouragedHypothesisIds, impactOutcome } from "../services/sage-community-memory.js";

const config = {
  id: "config-2",
  version: 2,
  charterText: "Members work together for equitable access.",
  missionGoals: [{ key: "access", label: "Transportation access", description: "Help members participate" }],
};

function signal(member: number, date: string, stance: "SUPPORT" | "CONTRADICT" = "SUPPORT") {
  return {
    id: `observation-${member}-${date}-${stance}`,
    memberId: `member-${member}`,
    themeKey: "transportation_access",
    wellbeingCategory: "transportation",
    stance,
    sourceDate: date,
    sourceFingerprint: `fingerprint-${member}-${date}`,
  };
}

describe("Commons observation candidate policy", () => {
  it("starts a qualified independent pattern as an internal candidate", () => {
    const candidate = buildCommunityCandidate({
      coopId: "harbor",
      activeMemberCount: 20,
      config,
      signals: [signal(1, "2026-10-01"), signal(2, "2026-10-01"), signal(3, "2026-10-02"), signal(4, "2026-10-02"), signal(5, "2026-10-03")],
    });
    expect(candidate?.status).toBe("CANDIDATE");
    expect(candidate?.details.requiredMemberCount).toBe(5);
    expect(candidate?.details.distinctMemberCount).toBe(5);
    expect(candidate?.details.evaluatedConfigId).toBe("config-2");
    expect(candidate?.details.evaluatedConfigVersion).toBe(2);
    expect(candidate?.details.confidence).toBe(candidate?.confidence);
    expect(candidate?.details.missionGoalKeys).toEqual(["access"]);
    expect(candidate?.details.coordination.correlatedBurst).toBe(false);
  });

  it("counts a person once even when they repeat the claim", () => {
    const candidate = buildCommunityCandidate({
      coopId: "harbor", activeMemberCount: 20, config,
      signals: [signal(1, "2026-10-01"), signal(1, "2026-10-02"), signal(1, "2026-10-03"), signal(2, "2026-10-03")],
    });
    expect(candidate?.status).toBe("UNSUPPORTED");
    expect(candidate?.details.supportCount).toBe(2);
  });

  it("flags a concentrated burst so it cannot automatically promote", () => {
    const candidate = buildCommunityCandidate({
      coopId: "harbor", activeMemberCount: 20, config,
      signals: [1, 2, 3, 4, 5].map((member) => signal(member, "2026-10-01")),
    });
    expect(candidate?.status).toBe("CANDIDATE");
    expect(candidate?.details.coordination.correlatedBurst).toBe(true);
  });

  it("distinguishes contradiction from insufficient support", () => {
    const dismissed = buildCommunityCandidate({
      coopId: "harbor", activeMemberCount: 20, config,
      signals: [1, 2, 3, 4, 5].map((member) => signal(member, `2026-10-0${member}`, "CONTRADICT")),
    });
    expect(dismissed?.status).toBe("DISMISSED");

    const tooSmall = buildCommunityCandidate({
      coopId: "small", activeMemberCount: 9, config,
      signals: [1, 2, 3, 4, 5].map((member) => signal(member, `2026-10-0${member}`)),
    });
    expect(tooSmall?.status).toBe("UNSUPPORTED");
  });

  it("labels usefulness from linked action outcomes without claiming causation", () => {
    expect(impactOutcome([])).toBe("NO_ACTION");
    expect(impactOutcome([{ status: "PUBLISHED", feedback: null }])).toBe("INCONCLUSIVE");
    expect(impactOutcome([{ status: "PUBLISHED", feedback: { rating: "GOOD" } }])).toBe("HELPFUL");
    expect(impactOutcome([{ status: "PENDING", feedback: { rating: "GOOD" } }])).toBe("INCONCLUSIVE");
    expect(impactOutcome([{ status: "FAILED", feedback: null }])).toBe("NOT_HELPFUL");
  });

  it("counts the steward's alerts about a hypothesis: handled helps, ignored doesn't, open is undecided", () => {
    expect(impactOutcome([], [{ status: "ACKNOWLEDGED" }])).toBe("HELPFUL");
    expect(impactOutcome([], [{ status: "EXPIRED" }])).toBe("NOT_HELPFUL");
    expect(impactOutcome([], [{ status: "SENT" }])).toBe("INCONCLUSIVE");
    expect(impactOutcome([], [{ status: "REROUTED" }, { status: "ACKNOWLEDGED" }])).toBe("HELPFUL");
    expect(impactOutcome([{ status: "DISMISSED", feedback: null }], [{ status: "ACKNOWLEDGED" }])).toBe("HELPFUL");
  });

  it("hides a hypothesis only after two reviews where what Sage did didn't help, never for no action", () => {
    const review = (id: string, outcome: string) => ({ sourceObservationId: id, outcome });
    const hidden = discouragedHypothesisIds([
      review("ignored", "NO_ACTION"), review("ignored", "NO_ACTION"),
      review("failed", "NOT_HELPFUL"), review("failed", "NOT_HELPFUL"),
      review("mixed", "NOT_HELPFUL"), review("mixed", "NO_ACTION"),
      review("helped", "HELPFUL"), null, { outcome: "NOT_HELPFUL" },
    ]);
    expect([...hidden]).toEqual(["failed"]);
  });
});
