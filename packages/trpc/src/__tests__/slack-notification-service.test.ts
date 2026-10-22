import { afterEach, describe, expect, it, vi } from "vitest";

import {
  sendAgentOperationalAlert,
  sendSageOutreachDailyReport,
} from "../services/slack-notification-service.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("agent Slack operations alerts", () => {
  it("sends a loud persistent alert and neutralizes untrusted Slack mentions", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.test/agent-health");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendAgentOperationalAlert({
        checkedAt: new Date("2026-10-13T18:00:00Z"),
        issues: [
          {
            agentId: "sage-wake",
            state: "FAILED",
            reason: "@channel model failed",
            coopId: "cahootz",
          },
        ],
      }),
    ).resolves.toBe(true);

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string) as {
      text: string;
    };
    expect(body.text).toContain("<!channel>");
    expect(body.text).toContain("AGENT SYSTEM NEEDS ATTENTION");
    expect(body.text).toContain("@channel-disabled model failed");
  });

  it("names the monitor and the database it read, without credentials", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.test/agent-health");
    vi.stubEnv("DATABASE_URL", "postgresql://admin:s3cret@db.example.com:5432/cahootz?sslmode=require");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await sendAgentOperationalAlert({
      checkedAt: new Date("2026-10-17T01:49:53Z"),
      source: "API backup monitor",
      databaseId: "a1b2c3d4",
      issues: [{ agentId: "sage-weekly-outreach", state: "FAILED", reason: "missing" }],
    });

    const raw = fetchMock.mock.calls[0]![1].body as string;
    const fields = (JSON.parse(raw) as { attachments: Array<{ fields: Array<{ title: string; value: string }> }> })
      .attachments[0]!.fields;
    expect(fields).toContainEqual(expect.objectContaining({ title: "Sent by", value: "API backup monitor" }));
    expect(fields).toContainEqual(expect.objectContaining({ title: "Database", value: "db.example.com/cahootz · ID a1b2c3d4" }));
    expect(raw).not.toContain("s3cret");
    expect(raw).not.toContain("admin");
  });

  it("reports each outreach recipient and escalates model fallbacks", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.test/outreach");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendSageOutreachDailyReport({
        modelConfigured: true,
        considered: 8,
        due: 1,
        sent: 1,
        recent: 0,
        duplicate: 0,
        limited: 0,
        failed: 0,
        modelFallbacks: 1,
        deliveries: [
          { label: "@member", status: "SENT", reason: "MODEL_FAILED" },
        ],
      }),
    ).resolves.toBe(true);

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string) as {
      text: string;
    };
    expect(body.text).toContain("SAGE OUTREACH IS NOT FULLY OPERATIONAL");
    expect(body.text).toContain("@member");
    expect(body.text).toContain("MODEL_FAILED");
  });

  it("shows which database the outreach sweep wrote to", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.test/outreach");
    vi.stubEnv("DATABASE_URL", "postgresql://u:p@shuttle.proxy.rlwy.net:41234/railway");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await sendSageOutreachDailyReport({
      modelConfigured: true,
      considered: 3,
      due: 0,
      sent: 0,
      recent: 0,
      duplicate: 0,
      limited: 0,
      failed: 0,
      modelFallbacks: 0,
      deliveries: [],
      databaseId: "a1b2c3d4",
    });

    const fields = (JSON.parse(fetchMock.mock.calls[0]![1].body as string) as {
      attachments: Array<{ fields: Array<{ title: string; value: string }> }>;
    }).attachments[0]!.fields;
    expect(fields).toContainEqual(expect.objectContaining({
      title: "Database",
      value: "shuttle.proxy.rlwy.net/railway · ID a1b2c3d4",
    }));
  });

  it("fails visibly when Slack is not configured", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", "");
    await expect(
      sendAgentOperationalAlert({
        checkedAt: new Date("2026-10-13T18:00:00Z"),
        issues: [{ agentId: "sage", state: "OFF", reason: "disabled" }],
      }),
    ).resolves.toBe(false);
  });
});
