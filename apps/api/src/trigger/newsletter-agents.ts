import { logger, schedules, task } from "@trigger.dev/sdk";

import { db } from "../../../../packages/db/index.js";
import { runNewsletterAgentForCoop } from "../../../../packages/trpc/src/routers/public-coop-info.js";

type NewsletterAgentId = "article-writer" | "event-writer";
type AgentRunStatus = "success" | "empty" | "error";

interface NewsletterAgentSchedule {
  agentId: NewsletterAgentId;
  enabled: boolean;
  intervalHours: number;
  lastRunAt?: string;
  lastRunStatus?: AgentRunStatus;
  lastRunMessage?: string;
  lastCreatedCount?: number;
  updatedAt?: string;
}

interface PreviewOverrides {
  newsletterAgentSchedules?: unknown;
  [key: string]: unknown;
}

const AGENT_IDS: NewsletterAgentId[] = ["article-writer", "event-writer"];
const SYSTEM_UPDATED_BY = "trigger.dev/newsletter-agent-sweep";

const defaultSchedules: Record<NewsletterAgentId, NewsletterAgentSchedule> = {
  "article-writer": {
    agentId: "article-writer",
    enabled: true,
    intervalHours: 168,
  },
  "event-writer": {
    agentId: "event-writer",
    enabled: true,
    intervalHours: 168,
  },
};

function normalizePreviewOverrides(value: unknown): PreviewOverrides {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as PreviewOverrides)
    : {};
}

function normalizeSchedule(
  agentId: NewsletterAgentId,
  value: unknown,
): NewsletterAgentSchedule {
  const fallback = defaultSchedules[agentId];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ...fallback };
  }

  const record = value as Record<string, unknown>;
  const intervalHours =
    typeof record.intervalHours === "number" &&
    Number.isFinite(record.intervalHours)
      ? Math.min(Math.max(Math.round(record.intervalHours), 1), 24 * 60)
      : fallback.intervalHours;
  const lastRunStatus = ["success", "empty", "error"].includes(
    String(record.lastRunStatus),
  )
    ? (record.lastRunStatus as AgentRunStatus)
    : undefined;

  return {
    agentId,
    enabled:
      typeof record.enabled === "boolean" ? record.enabled : fallback.enabled,
    intervalHours,
    lastRunAt:
      typeof record.lastRunAt === "string" ? record.lastRunAt : undefined,
    lastRunStatus,
    lastRunMessage:
      typeof record.lastRunMessage === "string"
        ? record.lastRunMessage
        : undefined,
    lastCreatedCount:
      typeof record.lastCreatedCount === "number" &&
      Number.isFinite(record.lastCreatedCount)
        ? Math.max(Math.round(record.lastCreatedCount), 0)
        : undefined,
    updatedAt:
      typeof record.updatedAt === "string" ? record.updatedAt : undefined,
  };
}

function normalizeSchedules(
  value: unknown,
): Record<NewsletterAgentId, NewsletterAgentSchedule> {
  const record =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  return {
    "article-writer": normalizeSchedule(
      "article-writer",
      record["article-writer"],
    ),
    "event-writer": normalizeSchedule("event-writer", record["event-writer"]),
  };
}

function isDue(schedule: NewsletterAgentSchedule, now = Date.now()) {
  if (!schedule.enabled) return false;
  if (!schedule.lastRunAt) return true;

  const anchorDate = new Date(schedule.lastRunAt || schedule.updatedAt || 0);
  if (Number.isNaN(anchorDate.getTime())) return true;

  return now - anchorDate.getTime() >= schedule.intervalHours * 60 * 60 * 1000;
}

async function markAgentRunError(params: {
  coopId: string;
  agentId: NewsletterAgentId;
  message: string;
}) {
  const publicInfo = await db.publicCoopInfo.findUnique({
    where: { coopId: params.coopId },
    select: { previewOverrides: true },
  });
  if (!publicInfo) return;

  const overrides = normalizePreviewOverrides(publicInfo.previewOverrides);
  const schedules = normalizeSchedules(overrides.newsletterAgentSchedules);
  const previous = schedules[params.agentId];
  const now = new Date().toISOString();

  await db.publicCoopInfo.update({
    where: { coopId: params.coopId },
    data: {
      previewOverrides: {
        ...overrides,
        newsletterAgentSchedules: {
          ...schedules,
          [params.agentId]: {
            ...previous,
            lastRunAt: now,
            lastRunStatus: "error",
            lastRunMessage: params.message,
            lastCreatedCount: 0,
            updatedAt: now,
          },
        },
      } as any,
      updatedBy: SYSTEM_UPDATED_BY,
    },
  });
}

async function runAgent(params: {
  coopId: string;
  agentId: NewsletterAgentId;
}) {
  try {
    const result = await runNewsletterAgentForCoop({
      db,
      coopId: params.coopId,
      agentId: params.agentId,
      updatedBy: SYSTEM_UPDATED_BY,
    });

    logger.info("Newsletter agent completed", {
      coopId: params.coopId,
      agentId: params.agentId,
      createdCount: result.createdCount,
      message: result.message,
    });

    return result;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Newsletter agent run failed.";
    logger.error("Newsletter agent failed", {
      coopId: params.coopId,
      agentId: params.agentId,
      error: message,
    });
    await markAgentRunError({
      coopId: params.coopId,
      agentId: params.agentId,
      message,
    });
    throw error;
  }
}

export const runNewsletterAgent = task({
  id: "run-newsletter-agent",
  maxDuration: 1800,
  run: async (payload: { coopId: string; agentId?: NewsletterAgentId }) => {
    if (!payload.coopId?.trim()) {
      throw new Error("coopId is required.");
    }

    const agentId = payload.agentId ?? "article-writer";
    if (!AGENT_IDS.includes(agentId)) {
      throw new Error("agentId must be article-writer or event-writer.");
    }

    return runAgent({
      coopId: payload.coopId.trim(),
      agentId,
    });
  },
});

export const newsletterAgentSweep = schedules.task({
  id: "newsletter-agent-sweep",
  cron: "0 * * * *",
  maxDuration: 3600,
  run: async () => {
    const coopConfigs = await db.coopConfig.findMany({
      where: {
        isActive: true,
        isDemo: false,
      },
      select: {
        coopId: true,
      },
      distinct: ["coopId"],
      orderBy: [{ displayOrder: "asc" }, { updatedAt: "desc" }],
      take: 100,
    });
    const coopIds = coopConfigs.map((config) => config.coopId);
    const publicInfos = await db.publicCoopInfo.findMany({
      where: { coopId: { in: coopIds } },
      select: {
        coopId: true,
        previewOverrides: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });

    if (coopIds.length > 0 && publicInfos.length === 0) {
      logger.warn(
        "Newsletter agent sweep found no matching public newsletter pages",
        {
          checkedCoopCount: coopIds.length,
          coopIds,
        },
      );
    }

    const outcomes: Array<{
      coopId: string;
      agentId: NewsletterAgentId;
      createdCount?: number;
      status: "success" | "empty" | "error";
      message: string;
    }> = [];
    const now = Date.now();

    for (const publicInfo of publicInfos) {
      const overrides = normalizePreviewOverrides(publicInfo.previewOverrides);
      const schedules = normalizeSchedules(overrides.newsletterAgentSchedules);

      for (const agentId of AGENT_IDS) {
        if (!isDue(schedules[agentId], now)) {
          logger.info("Newsletter agent skipped because it is not due", {
            coopId: publicInfo.coopId,
            agentId,
            enabled: schedules[agentId].enabled,
            intervalHours: schedules[agentId].intervalHours,
            lastRunAt: schedules[agentId].lastRunAt,
            updatedAt: schedules[agentId].updatedAt,
          });
          continue;
        }

        try {
          const result = await runAgent({
            coopId: publicInfo.coopId,
            agentId,
          });
          outcomes.push({
            coopId: publicInfo.coopId,
            agentId,
            createdCount: result.createdCount,
            status: result.createdCount > 0 ? "success" : "empty",
            message: result.message,
          });
        } catch (error) {
          outcomes.push({
            coopId: publicInfo.coopId,
            agentId,
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "Newsletter agent run failed.",
          });
        }
      }
    }

    logger.info("Newsletter agent sweep completed", {
      checkedCoopCount: coopIds.length,
      newsletterCoopCount: publicInfos.length,
      runCount: outcomes.length,
      outcomes,
    });

    return {
      checkedCoopCount: coopIds.length,
      newsletterCoopCount: publicInfos.length,
      runCount: outcomes.length,
      outcomes,
    };
  },
});
