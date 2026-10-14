import { describe, expect, it, vi } from "vitest";

vi.mock("@repo/db", () => ({ db: {} }));

import { flagIssue } from "../services/agent-operations.js";

describe("agent operational health", () => {
  it("keeps reviewed agents on when their flag row has not been created yet", () => {
    expect(flagIssue({ agentId: "sage-weekly-outreach", flag: undefined, missingDefault: true })).toBeNull();
  });

  it("reports an explicit operator pause instead of silently skipping the agent", () => {
    expect(flagIssue({
      agentId: "sage-weekly-outreach",
      flag: { enabled: false },
      missingDefault: true,
    })).toEqual({
      agentId: "sage-weekly-outreach",
      state: "OFF",
      reason: "Feature flag is disabled. An operator must explicitly turn it back on.",
    });
  });

  it("distinguishes a deliberate safety gate from an unexplained shutdown", () => {
    expect(flagIssue({
      agentId: "sage-private-safety-response",
      flag: { enabled: false },
      missingDefault: false,
      gatedReason: "Feature flag is disabled pending policy and legal review.",
    })).toEqual({
      agentId: "sage-private-safety-response",
      state: "GATED",
      reason: "Feature flag is disabled pending policy and legal review.",
    });
  });
});
