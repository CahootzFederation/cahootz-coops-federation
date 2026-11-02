import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAgentOperationalSnapshot, isPrimaryProductionDeployment } from "../services/agent-operations.js";

const mocks = vi.hoisted(() => ({
  platformConfigFindUnique: vi.fn(),
  platformConfigUpsert: vi.fn(),
  coopConfigFindMany: vi.fn(),
  commonsAgentSettingFindMany: vi.fn(),
  publicCoopInfoFindMany: vi.fn(),
  sageWakeCycleFindMany: vi.fn(),
  getSageAutonomyUsage: vi.fn(),
}));

vi.mock("@repo/db", () => ({
  db: {
    platformConfig: {
      findUnique: mocks.platformConfigFindUnique,
      upsert: mocks.platformConfigUpsert,
    },
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
  mocks.platformConfigUpsert.mockResolvedValue({ value: "a1b2c3d4" });
  mocks.platformConfigFindUnique.mockResolvedValue({
    value: JSON.stringify({
      lastRunAt: "2026-10-13T17:00:00Z",
      lastRunStatus: "success",
      lastRunMessage: null,
    }),
  });
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
  it("passes when configured agents, budgets, and wake cycles are healthy", async () => {
    const snapshot = await getAgentOperationalSnapshot(
      new Date("2026-10-13T18:00:00Z"),
    );

    expect(snapshot).toMatchObject({ healthy: true, issues: [] });
  });

  it("reports pauses, failed cycles, and disabled newsletter agents together", async () => {
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

  it("leaves the weekly-outreach sweep out of the hourly watchdog", async () => {
    mocks.platformConfigFindUnique.mockResolvedValue(null);

    const snapshot = await getAgentOperationalSnapshot(
      new Date("2026-10-13T18:00:00Z"),
    );

    expect(snapshot.issues).not.toContainEqual(
      expect.objectContaining({ agentId: "sage-weekly-outreach" }),
    );
  });

  it("reports the ID stored in the database it read, creating one only if missing", async () => {
    const snapshot = await getAgentOperationalSnapshot(
      new Date("2026-10-13T18:00:00Z"),
    );

    expect(snapshot.databaseId).toBe("a1b2c3d4");
    expect(mocks.platformConfigUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "platform.database-id" },
        update: {},
      }),
    );
  });

  it("still checks health when the database ID can't be saved", async () => {
    mocks.platformConfigUpsert.mockRejectedValue(new Error("read-only"));

    const snapshot = await getAgentOperationalSnapshot(
      new Date("2026-10-13T18:00:00Z"),
    );

    expect(snapshot.databaseId).toBeUndefined();
    expect(snapshot.healthy).toBe(true);
  });
});

describe("primary production deployment", () => {
  it("runs only in Railway's production environment, not PR or dev copies", () => {
    expect(isPrimaryProductionDeployment({ NODE_ENV: "production", RAILWAY_ENVIRONMENT_NAME: "production" })).toBe(true);
    expect(isPrimaryProductionDeployment({ NODE_ENV: "production", RAILWAY_ENVIRONMENT_NAME: "cahootz-coops-federation-pr-260" })).toBe(false);
    expect(isPrimaryProductionDeployment({ NODE_ENV: "production", RAILWAY_ENVIRONMENT_NAME: "dev" })).toBe(false);
  });

  it("keeps working outside Railway and stays off in development", () => {
    expect(isPrimaryProductionDeployment({ NODE_ENV: "production" })).toBe(true);
    expect(isPrimaryProductionDeployment({ NODE_ENV: "development" })).toBe(false);
    expect(isPrimaryProductionDeployment({ NODE_ENV: "development", RAILWAY_ENVIRONMENT_NAME: "production" })).toBe(false);
  });
});
