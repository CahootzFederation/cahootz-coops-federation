import { randomUUID } from "node:crypto";

import { db } from "@repo/db";

import type { AgentOperationalIssue } from "./slack-notification-service.js";
import { getSageAutonomyUsage } from "./sage-autonomy.js";

const DATABASE_ID_KEY = "platform.database-id";
const WAKE_STALE_MS = 45 * 60 * 1000;
const RUNNING_STALE_MS = 20 * 60 * 1000;

/**
 * True only for the real production API. Railway copies production settings into
 * every PR and dev environment, each with its own database, so NODE_ENV alone would
 * let those copies post "missing sweep" and shutdown alerts to the shared channel.
 */
export function isPrimaryProductionDeployment(
  vars: Record<string, string | undefined> = process.env,
): boolean {
  if (vars.NODE_ENV !== "production") return false;
  const railwayEnvironment = vars.RAILWAY_ENVIRONMENT_NAME?.trim();
  return !railwayEnvironment || railwayEnvironment === "production";
}

/**
 * Short ID stored inside the database itself. Trigger.dev reaches Railway through a
 * public host while the API uses postgres.railway.internal, so hostnames can't tell
 * us whether both read the same database. Matching IDs in Slack can.
 */
export async function getDatabaseId(): Promise<string | undefined> {
  try {
    const row = await db.platformConfig.upsert({
      where: { key: DATABASE_ID_KEY },
      create: { key: DATABASE_ID_KEY, value: randomUUID().slice(0, 8) },
      update: {},
      select: { value: true },
    });
    return row.value;
  } catch {
    return undefined;
  }
}

export interface AgentOperationalSnapshot {
  checkedAt: Date;
  issues: AgentOperationalIssue[];
  healthy: boolean;
  databaseId?: string;
}

/**
 * Deterministic operational inventory for every configurable production agent.
 * The hourly Trigger task sends every issue on every run until it clears.
 */
export async function getAgentOperationalSnapshot(
  now = new Date(),
): Promise<AgentOperationalSnapshot> {
  const issues: AgentOperationalIssue[] = [];
  const [configs, settings, databaseId] = await Promise.all([
    db.coopConfig.findMany({
      where: { isActive: true, isDemo: false },
      select: { coopId: true },
      distinct: ["coopId"],
    }),
    db.commonsAgentSetting.findMany({
      select: { coopId: true, autoReply: true },
    }),
    getDatabaseId(),
  ]);

  // The weekly-outreach sweep is deliberately left out of this watchdog. Its own daily Slack
  // receipt still reports each run; the hourly "never started" alert was turned off on 2026-10-23.
  if (!process.env.OPENAI_API_KEY) {
    issues.push({
      agentId: "model-backed-agents",
      state: "BROKEN",
      reason: "OPENAI_API_KEY is missing; model calls cannot run.",
    });
  }
  if (!process.env.SLACK_WEBHOOK_URL) {
    issues.push({
      agentId: "agent-alerting",
      state: "BROKEN",
      reason:
        "SLACK_WEBHOOK_URL is missing; persistent alerts cannot be delivered.",
    });
  }
  if (
    process.env.NODE_ENV === "production" &&
    !process.env.TRIGGER_SECRET_KEY
  ) {
    issues.push({
      agentId: "scheduled-agents",
      state: "BROKEN",
      reason:
        "TRIGGER_SECRET_KEY is missing; production schedules other than the local Sage wake fallback cannot be dispatched.",
    });
  }

  const coopIds = configs.map((config) => config.coopId);
  const activeCoopIds = new Set(coopIds);
  const [wakeCycles, usages] = await Promise.all([
    coopIds.length
      ? db.sageWakeCycle.findMany({
          where: { coopId: { in: coopIds } },
          orderBy: { startedAt: "desc" },
          select: { coopId: true, status: true, startedAt: true, error: true },
        })
      : [],
    Promise.all(
      coopIds.map(async (coopId) => ({
        coopId,
        usage: await getSageAutonomyUsage(coopId),
      })),
    ),
  ]);
  const settingByCoop = new Map(
    settings.map((setting) => [setting.coopId, setting]),
  );
  const latestWakeByCoop = new Map<string, (typeof wakeCycles)[number]>();
  for (const cycle of wakeCycles)
    if (!latestWakeByCoop.has(cycle.coopId))
      latestWakeByCoop.set(cycle.coopId, cycle);

  for (const coopId of coopIds) {
    const setting = settingByCoop.get(coopId);
    if (setting?.autoReply === false) {
      issues.push({
        agentId: "sage-auto-reply",
        coopId,
        state: "OFF",
        reason: "The Commons auto-reply setting is disabled.",
      });
    }
    const usage = usages.find((item) => item.coopId === coopId)?.usage;
    if (usage?.paused) {
      issues.push({
        agentId: "sage-autonomy",
        coopId,
        state: "PAUSED",
        reason: `${usage.pausedReason === "USD_LIMIT" ? "Monthly dollar" : "Monthly call"} limit reached; resets at ${usage.resetsAt}.`,
      });
    }

    const cycle = latestWakeByCoop.get(coopId);
    if (!cycle) {
      issues.push({
        agentId: "sage-wake",
        coopId,
        state: "FAILED",
        reason: "No wake cycle has ever been recorded.",
      });
    } else if (cycle.status === "FAILED") {
      issues.push({
        agentId: "sage-wake",
        coopId,
        state: "FAILED",
        reason:
          cycle.error?.slice(0, 500) || "The most recent wake cycle failed.",
      });
    } else if (
      cycle.status === "RUNNING" &&
      now.getTime() - cycle.startedAt.getTime() > RUNNING_STALE_MS
    ) {
      issues.push({
        agentId: "sage-wake",
        coopId,
        state: "FAILED",
        reason:
          "The most recent wake cycle is stuck in RUNNING for more than 20 minutes.",
      });
    } else if (now.getTime() - cycle.startedAt.getTime() > WAKE_STALE_MS) {
      issues.push({
        agentId: "sage-wake",
        coopId,
        state: "FAILED",
        reason: "No wake cycle has started in the last 45 minutes.",
      });
    }
  }

  return { checkedAt: now, issues, healthy: issues.length === 0, databaseId };
}
