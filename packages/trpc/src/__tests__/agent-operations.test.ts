import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  flagIssue,
  getAgentOperationalSnapshot,
} from "../services/agent-operations.js";

const mocks = vi.hoisted(() => ({
  featureFlagFindMany: vi.fn(),
  coopConfigFindMany: vi.fn(),
  commonsAgentSettingFindMany: vi.fn(),
  publicCoopInfoFindMany: vi.fn(),
  sageWakeCycleFindMany: vi.fn(),
  getSageAutonomyUsage: vi.fn(),
}));

vi.mock("@repo/db", () => ({
  db: {
    featureFlag: { findMany: mocks.featureFlagFindMany },
    coopConfig: { findMany: mocks.coopConfigFindMany },
    commonsAgentSetting: { findMany: mocks.commonsAgentSettingFindMany },
    publicCoopInfo: { findMany: mocks.publicCoopInfoFindMany },
    sageWakeCycle: { findMany: mocks.sageWakeCycleFindMany },
  },
}));
vi.mock("../services/sage-autonomy.js", () => ({
  getSageAutonomyUsage: mocks.getSageAutonomyUsage,
}));

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("OPENAI_API_KEY", "sk-test");
  vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.test/agent-health");
  vi.stubEnv("TRIGGER_SECRET_KEY", "tr_prod_test");
  mocks.featureFlagFindMany.mockResolvedValue([
    {
      key: "sage_weekly_outreach",
      enabled: true,
      metadata: { lastRunAt: "2026-10-13T17:00:00Z", lastRunStatus: "success" },
      updatedAt: new Date("2026-10-12T18:00:00Z"),
    },
    {
      key: "sage_community_memory",
      enabled: true,
      metadata: null,
      updatedAt: new Date(),
    },
    {
      key: "sage_private_safety_response",
      enabled: true,
      metadata: null,
      updatedAt: new Date(),
    },
  ]);
  mocks.coopConfigFindMany.mockResolvedValue([{ coopId: "cahootz" }]);
  mocks.commonsAgentSettingFindMany.mockResolvedValue([
    { coopId: "cahootz", autoReply: true },
  ]);
  mocks.publicCoopInfoFindMany.mockResolvedValue([]);
  mocks.sageWakeCycleFindMany.mockResolvedValue([
    {
      coopId: "cahootz",
      status: "DONE",
      startedAt: new Date("2026-10-13T17:50:00Z"),
      error: null,
    },
  ]);
  mocks.getSageAutonomyUsage.mockResolvedValue({
    usd: 0,
    calls: 0,
    usdLimit: 5,
    callLimit: 2_000,
    paused: false,
    pausedReason: null,
    resetsAt: "2026-11-01T00:00:00.000Z",
  });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("agent operational health", () => {
  it("keeps reviewed agents on when their flag row has not been created yet", () => {
    expect(
      flagIssue({
        agentId: "sage-weekly-outreach",
        flag: undefined,
        missingDefault: true,
      }),
    ).toBeNull();
  });

  it("reports an explicit operator pause instead of silently skipping the agent", () => {
    expect(
      flagIssue({
        agentId: "sage-weekly-outreach",
        flag: { enabled: false },
        missingDefault: true,
      }),
    ).toEqual({
      agentId: "sage-weekly-outreach",
      state: "OFF",
      reason:
        "Feature flag is disabled. An operator must explicitly turn it back on.",
    });
  });

  it("distinguishes a deliberate safety gate from an unexplained shutdown", () => {
    expect(
      flagIssue({
        agentId: "sage-private-safety-response",
        flag: { enabled: false },
        missingDefault: false,
        gatedReason:
          "Feature flag is disabled pending policy and legal review.",
      }),
    ).toEqual({
      agentId: "sage-private-safety-response",
      state: "GATED",
      reason: "Feature flag is disabled pending policy and legal review.",
    });
  });

  it("passes when configured agents, budgets, and wake cycles are healthy", async () => {
    const snapshot = await getAgentOperationalSnapshot(
      new Date("2026-10-13T18:00:00Z"),
    );

    expect(snapshot).toMatchObject({ healthy: true, issues: [] });
  });

  it("reports feature gates, pauses, failed cycles, and disabled newsletter agents together", async () => {
    mocks.featureFlagFindMany.mockResolvedValue([
      {
        key: "sage_weekly_outreach",
        enabled: false,
        metadata: null,
        updatedAt: new Date(),
      },
      {
        key: "sage_community_memory",
        enabled: false,
        metadata: null,
        updatedAt: new Date(),
      },
      {
        key: "sage_private_safety_response",
        enabled: false,
        metadata: null,
        updatedAt: new Date(),
      },
    ]);
    mocks.commonsAgentSettingFindMany.mockResolvedValue([
      { coopId: "cahootz", autoReply: false },
    ]);
    mocks.getSageAutonomyUsage.mockResolvedValue({
      paused: true,
      pausedReason: "CALL_LIMIT",
      resetsAt: "2026-11-01T00:00:00.000Z",
    });
    mocks.sageWakeCycleFindMany.mockResolvedValue([
      {
        coopId: "cahootz",
        status: "FAILED",
        startedAt: new Date("2026-10-13T17:50:00Z"),
        error: "model rejected the request",
      },
    ]);
    mocks.publicCoopInfoFindMany.mockResolvedValue([
      {
        coopId: "cahootz",
        previewOverrides: {
          newsletterAgentSchedules: {
            "article-writer": { enabled: false, intervalHours: 168 },
          },
        },
      },
    ]);

    const snapshot = await getAgentOperationalSnapshot(
      new Date("2026-10-13T18:00:00Z"),
    );

    expect(snapshot.healthy).toBe(false);
    expect(snapshot.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agentId: "sage-weekly-outreach",
          state: "OFF",
        }),
        expect.objectContaining({
          agentId: "sage-community-memory",
          state: "GATED",
        }),
        expect.objectContaining({
          agentId: "sage-private-safety-response",
          state: "GATED",
        }),
        expect.objectContaining({
          agentId: "sage-auto-reply",
          state: "OFF",
          coopId: "cahootz",
        }),
        expect.objectContaining({
          agentId: "sage-autonomy",
          state: "PAUSED",
          coopId: "cahootz",
        }),
        expect.objectContaining({
          agentId: "sage-wake",
          state: "FAILED",
          coopId: "cahootz",
        }),
        expect.objectContaining({
          agentId: "newsletter-article-writer",
          state: "OFF",
          coopId: "cahootz",
        }),
      ]),
    );
  });

  it("keeps a failed model-backed outreach run unhealthy until a clean daily run", async () => {
    mocks.featureFlagFindMany.mockResolvedValue([
      {
        key: "sage_weekly_outreach",
        enabled: true,
        metadata: {
          lastRunAt: "2026-10-13T17:59:00Z",
          lastRunStatus: "error",
          lastRunMessage: "modelFallbacks=1",
        },
        updatedAt: new Date("2026-10-12T18:00:00Z"),
      },
      {
        key: "sage_community_memory",
        enabled: true,
        metadata: null,
        updatedAt: new Date(),
      },
      {
        key: "sage_private_safety_response",
        enabled: true,
        metadata: null,
        updatedAt: new Date(),
      },
    ]);

    const snapshot = await getAgentOperationalSnapshot(
      new Date("2026-10-13T18:00:00Z"),
    );

    expect(snapshot.issues).toContainEqual({
      agentId: "sage-weekly-outreach",
      state: "FAILED",
      reason: "modelFallbacks=1",
    });
  });
});
