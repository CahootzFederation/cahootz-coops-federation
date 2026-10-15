import { describe, expect, it, vi } from "vitest";

vi.mock("@repo/db", () => ({ db: {} }));

import { buildCommunityCandidate, discouragedHypothesisIds, impactOutcome, MemberSignalDetailsZ } from "../services/sage-community-memory.js";

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

  it("judges Sage's question to the Commons by how many members answered it publicly", () => {
    expect(impactOutcome([], [{ removed: false, responders: 2 }])).toBe("HELPFUL");
    expect(impactOutcome([], [{ removed: false, responders: 1 }])).toBe("INCONCLUSIVE");
    expect(impactOutcome([], [{ removed: false, responders: 0 }])).toBe("NOT_HELPFUL");
    expect(impactOutcome([], [{ removed: true, responders: 0 }])).toBe("NOT_HELPFUL");
    expect(impactOutcome([{ status: "DISMISSED", feedback: null }], [{ removed: false, responders: 3 }])).toBe("HELPFUL");
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

describe("which saved member needs count toward Commons patterns", () => {
  const autoSaved = {
    themeKey: "transportation_access", wellbeingCategory: "transportation", stance: "SUPPORT", summaryKind: "model",
    aggregationBasis: "automatic", aggregationEligible: true, relevantCoopIds: ["harbor"], sourceDate: "2026-10-14",
    sourceFingerprint: "abc", sensitive: false, urgent: false,
  };

  it("counts a need saved automatically, without a consent step", () => {
    expect(MemberSignalDetailsZ.safeParse(autoSaved).success).toBe(true);
  });

  it("still leaves out needs tied to no single Commons, sensitive ones, and older remember-only notes", () => {
    expect(MemberSignalDetailsZ.safeParse({ ...autoSaved, relevantCoopIds: [], aggregationEligible: false }).success).toBe(false);
    expect(MemberSignalDetailsZ.safeParse({ ...autoSaved, sensitive: true }).success).toBe(false);
    expect(MemberSignalDetailsZ.safeParse({ ...autoSaved, aggregationConsent: false, aggregationEligible: false }).success).toBe(false);
  });
});
