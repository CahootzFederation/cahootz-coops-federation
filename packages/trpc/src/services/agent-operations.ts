import { db } from "@repo/db";

import type { AgentOperationalIssue } from "./slack-notification-service.js";
import { getSageAutonomyUsage } from "./sage-autonomy.js";

const WEEKLY_OUTREACH_FLAG = "sage_weekly_outreach";
const COMMUNITY_MEMORY_FLAG = "sage_community_memory";
const PRIVATE_SAFETY_FLAG = "sage_private_safety_response";
const WAKE_STALE_MS = 45 * 60 * 1000;
const RUNNING_STALE_MS = 20 * 60 * 1000;
const DAILY_SWEEP_STALE_MS = 26 * 60 * 60 * 1000;

interface NewsletterSchedule {
  enabled: boolean;
  intervalHours: number;
  lastRunAt?: string;
  lastRunStatus?: string;
  lastRunMessage?: string;
}

function newsletterSchedule(
  value: unknown,
  agentId: "article-writer" | "event-writer",
): NewsletterSchedule {
  const root =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const schedules =
    typeof root.newsletterAgentSchedules === "object" &&
    root.newsletterAgentSchedules !== null &&
    !Array.isArray(root.newsletterAgentSchedules)
      ? (root.newsletterAgentSchedules as Record<string, unknown>)
      : {};
  const raw =
    typeof schedules[agentId] === "object" &&
    schedules[agentId] !== null &&
    !Array.isArray(schedules[agentId])
      ? (schedules[agentId] as Record<string, unknown>)
      : {};
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
    intervalHours:
      typeof raw.intervalHours === "number" &&
      Number.isFinite(raw.intervalHours)
        ? Math.min(Math.max(Math.round(raw.intervalHours), 1), 24 * 60)
        : 168,
    lastRunAt: typeof raw.lastRunAt === "string" ? raw.lastRunAt : undefined,
    lastRunStatus:
      typeof raw.lastRunStatus === "string" ? raw.lastRunStatus : undefined,
    lastRunMessage:
      typeof raw.lastRunMessage === "string" ? raw.lastRunMessage : undefined,
  };
}

export function flagIssue(input: {
  agentId: string;
  flag: { enabled: boolean } | undefined;
  missingDefault: boolean;
  gatedReason?: string;
}): AgentOperationalIssue | null {
  const enabled = input.flag?.enabled ?? input.missingDefault;
  if (enabled) return null;
  return {
    agentId: input.agentId,
    state: input.gatedReason ? "GATED" : "OFF",
    reason:
      input.gatedReason ??
      "Feature flag is disabled. An operator must explicitly turn it back on.",
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
export async function getAgentOperationalSnapshot(
  now = new Date(),
): Promise<AgentOperationalSnapshot> {
  const issues: AgentOperationalIssue[] = [];
  const [flags, configs, settings, publicInfos] = await Promise.all([
    db.featureFlag.findMany({
      where: {
        key: {
          in: [
            WEEKLY_OUTREACH_FLAG,
            COMMUNITY_MEMORY_FLAG,
            PRIVATE_SAFETY_FLAG,
          ],
        },
      },
      select: { key: true, enabled: true, metadata: true, updatedAt: true },
    }),
    db.coopConfig.findMany({
      where: { isActive: true, isDemo: false },
      select: { coopId: true },
      distinct: ["coopId"],
    }),
    db.commonsAgentSetting.findMany({
      select: { coopId: true, autoReply: true },
    }),
    db.publicCoopInfo.findMany({
      select: { coopId: true, previewOverrides: true },
    }),
  ]);

  const flagByKey = new Map(flags.map((flag) => [flag.key, flag]));
  const flagIssues = [
    flagIssue({
      agentId: "sage-weekly-outreach",
      flag: flagByKey.get(WEEKLY_OUTREACH_FLAG),
      missingDefault: true,
    }),
    flagIssue({
      agentId: "sage-community-memory",
      flag: flagByKey.get(COMMUNITY_MEMORY_FLAG),
      missingDefault: false,
      gatedReason: "Feature flag is disabled pending privacy review.",
    }),
    flagIssue({
      agentId: "sage-private-safety-response",
      flag: flagByKey.get(PRIVATE_SAFETY_FLAG),
      missingDefault: false,
      gatedReason: "Feature flag is disabled pending policy and legal review.",
    }),
  ].filter((issue): issue is AgentOperationalIssue => issue !== null);
  issues.push(...flagIssues);

  const outreachFlag = flagByKey.get(WEEKLY_OUTREACH_FLAG);
  if (outreachFlag?.enabled) {
    const metadata =
      typeof outreachFlag.metadata === "object" &&
      outreachFlag.metadata !== null &&
      !Array.isArray(outreachFlag.metadata)
        ? (outreachFlag.metadata as Record<string, unknown>)
        : {};
    const lastRunAt =
      typeof metadata.lastRunAt === "string"
        ? new Date(metadata.lastRunAt)
        : null;
    const enabledAt =
      typeof metadata.enabledAt === "string"
        ? new Date(metadata.enabledAt)
        : outreachFlag.updatedAt;
    if (metadata.lastRunStatus === "error") {
      issues.push({
        agentId: "sage-weekly-outreach",
        state: "FAILED",
        reason:
          typeof metadata.lastRunMessage === "string"
            ? metadata.lastRunMessage.slice(0, 500)
            : "The most recent daily outreach sweep failed.",
      });
    } else if (
      lastRunAt &&
      !Number.isNaN(lastRunAt.getTime()) &&
      now.getTime() - lastRunAt.getTime() > DAILY_SWEEP_STALE_MS
    ) {
      issues.push({
        agentId: "sage-weekly-outreach",
        state: "FAILED",
        reason: "No successful daily outreach sweep has completed in 26 hours.",
      });
    } else if (
      !lastRunAt &&
      !Number.isNaN(enabledAt.getTime()) &&
      now.getTime() - enabledAt.getTime() > DAILY_SWEEP_STALE_MS
    ) {
      issues.push({
        agentId: "sage-weekly-outreach",
        state: "FAILED",
        reason:
          "Weekly outreach has been enabled for more than 26 hours without a completed daily sweep.",
      });
    }
  }

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

  for (const publicInfo of publicInfos) {
    if (!activeCoopIds.has(publicInfo.coopId)) continue;
    for (const agentId of ["article-writer", "event-writer"] as const) {
      const schedule = newsletterSchedule(publicInfo.previewOverrides, agentId);
      if (!schedule.enabled) {
        issues.push({
          agentId: `newsletter-${agentId}`,
          coopId: publicInfo.coopId,
          state: "OFF",
          reason: "The saved agent schedule is disabled.",
        });
        continue;
      }
      if (schedule.lastRunStatus === "error") {
        issues.push({
          agentId: `newsletter-${agentId}`,
          coopId: publicInfo.coopId,
          state: "FAILED",
          reason:
            schedule.lastRunMessage?.slice(0, 500) ||
            "The most recent run failed.",
        });
        continue;
      }
      if (schedule.lastRunAt) {
        const lastRunAt = new Date(schedule.lastRunAt);
        const staleAfter = (schedule.intervalHours + 2) * 60 * 60 * 1000;
        if (
          !Number.isNaN(lastRunAt.getTime()) &&
          now.getTime() - lastRunAt.getTime() > staleAfter
        ) {
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
