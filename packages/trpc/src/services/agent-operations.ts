import { db } from "@repo/db";

import { getSageAutonomyUsage } from "./sage-autonomy.js";
import type { AgentOperationalIssue } from "./slack-notification-service.js";

const WAKE_STALE_MS = 45 * 60 * 1000;
const RUNNING_STALE_MS = 20 * 60 * 1000;

interface NewsletterSchedule {
  enabled: boolean;
  intervalHours: number;
  lastRunAt?: string;
  lastRunStatus?: string;
  lastRunMessage?: string;
}

function newsletterSchedule(value: unknown, agentId: "article-writer" | "event-writer"): NewsletterSchedule {
  const root = typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const schedules = typeof root.newsletterAgentSchedules === "object" && root.newsletterAgentSchedules !== null && !Array.isArray(root.newsletterAgentSchedules)
    ? root.newsletterAgentSchedules as Record<string, unknown>
    : {};
  const raw = typeof schedules[agentId] === "object" && schedules[agentId] !== null && !Array.isArray(schedules[agentId])
    ? schedules[agentId] as Record<string, unknown>
    : {};
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
    intervalHours: typeof raw.intervalHours === "number" && Number.isFinite(raw.intervalHours)
      ? Math.min(Math.max(Math.round(raw.intervalHours), 1), 24 * 60)
      : 168,
    lastRunAt: typeof raw.lastRunAt === "string" ? raw.lastRunAt : undefined,
    lastRunStatus: typeof raw.lastRunStatus === "string" ? raw.lastRunStatus : undefined,
    lastRunMessage: typeof raw.lastRunMessage === "string" ? raw.lastRunMessage : undefined,
  };
}

export interface AgentOperationalSnapshot {
  checkedAt: Date;
  issues: AgentOperationalIssue[];
  healthy: boolean;
}

/**
 * Deterministic operational inventory for every configurable production agent.
 * The hourly Trigger task sends every issue on every run until it clears.
 */
export async function getAgentOperationalSnapshot(now = new Date()): Promise<AgentOperationalSnapshot> {
  const issues: AgentOperationalIssue[] = [];
  const [configs, settings, publicInfos] = await Promise.all([
    db.coopConfig.findMany({
      where: { isActive: true, isDemo: false },
      select: { coopId: true },
      distinct: ["coopId"],
    }),
    db.commonsAgentSetting.findMany({ select: { coopId: true, autoReply: true } }),
    db.publicCoopInfo.findMany({ select: { coopId: true, previewOverrides: true } }),
  ]);

  if (!process.env.OPENAI_API_KEY) {
    issues.push({ agentId: "model-backed-agents", state: "BROKEN", reason: "OPENAI_API_KEY is missing; model calls cannot run." });
  }
  if (!process.env.SLACK_WEBHOOK_URL) {
    issues.push({ agentId: "agent-alerting", state: "BROKEN", reason: "SLACK_WEBHOOK_URL is missing; persistent alerts cannot be delivered." });
  }
  if (process.env.NODE_ENV === "production" && !process.env.TRIGGER_SECRET_KEY) {
    issues.push({ agentId: "scheduled-agents", state: "BROKEN", reason: "TRIGGER_SECRET_KEY is missing; production schedules other than the local Sage wake fallback cannot be dispatched." });
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
    Promise.all(coopIds.map(async (coopId) => ({ coopId, usage: await getSageAutonomyUsage(coopId) }))),
  ]);
  const settingByCoop = new Map(settings.map((setting) => [setting.coopId, setting]));
  const latestWakeByCoop = new Map<string, (typeof wakeCycles)[number]>();
  for (const cycle of wakeCycles) if (!latestWakeByCoop.has(cycle.coopId)) latestWakeByCoop.set(cycle.coopId, cycle);

  for (const coopId of coopIds) {
    const setting = settingByCoop.get(coopId);
    if (setting?.autoReply === false) {
      issues.push({ agentId: "sage-auto-reply", coopId, state: "OFF", reason: "The Commons auto-reply setting is disabled." });
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
      issues.push({ agentId: "sage-wake", coopId, state: "FAILED", reason: "No wake cycle has ever been recorded." });
    } else if (cycle.status === "FAILED") {
      issues.push({ agentId: "sage-wake", coopId, state: "FAILED", reason: cycle.error?.slice(0, 500) || "The most recent wake cycle failed." });
    } else if (cycle.status === "RUNNING" && now.getTime() - cycle.startedAt.getTime() > RUNNING_STALE_MS) {
      issues.push({ agentId: "sage-wake", coopId, state: "FAILED", reason: "The most recent wake cycle is stuck in RUNNING for more than 20 minutes." });
    } else if (now.getTime() - cycle.startedAt.getTime() > WAKE_STALE_MS) {
      issues.push({ agentId: "sage-wake", coopId, state: "FAILED", reason: "No wake cycle has started in the last 45 minutes." });
    }
  }

  for (const publicInfo of publicInfos) {
    if (!activeCoopIds.has(publicInfo.coopId)) continue;
    for (const agentId of ["article-writer", "event-writer"] as const) {
      const schedule = newsletterSchedule(publicInfo.previewOverrides, agentId);
      if (!schedule.enabled) {
        issues.push({ agentId: `newsletter-${agentId}`, coopId: publicInfo.coopId, state: "OFF", reason: "The saved agent schedule is disabled." });
        continue;
      }
      if (schedule.lastRunStatus === "error") {
        issues.push({
          agentId: `newsletter-${agentId}`,
          coopId: publicInfo.coopId,
          state: "FAILED",
          reason: schedule.lastRunMessage?.slice(0, 500) || "The most recent run failed.",
        });
        continue;
      }
      if (schedule.lastRunAt) {
        const lastRunAt = new Date(schedule.lastRunAt);
        const staleAfter = (schedule.intervalHours + 2) * 60 * 60 * 1000;
        if (!Number.isNaN(lastRunAt.getTime()) && now.getTime() - lastRunAt.getTime() > staleAfter) {
          issues.push({
            agentId: `newsletter-${agentId}`,
            coopId: publicInfo.coopId,
            state: "FAILED",
            reason: `No completed run within the configured ${schedule.intervalHours}-hour interval plus a 2-hour grace period.`,
          });
        }
      }
    }
  }

  return { checkedAt: now, issues, healthy: issues.length === 0 };
}
