import { logger, schedules, task } from "@trigger.dev/sdk";
import { db } from "../../../../packages/db/index.js";
import { processCommonsActionContent, scanCommons } from "../../../../packages/trpc/src/services/commons-action-agent.js";

export const commonsActionContent = task({
  id: "commons-action-content",
  maxDuration: 300,
  run: async (payload: { sourceType: "commons_post" | "commons_comment"; sourceId: string }) => {
    return processCommonsActionContent(payload.sourceType, payload.sourceId);
  },
});

// Recover missed event deliveries and continue historical backfill once a day.
export const commonsActionRecovery = schedules.task({
  id: "commons-action-recovery",
  cron: "15 3 * * *",
  maxDuration: 3600,
  run: async () => {
    const configs = await db.coopConfig.findMany({
      where: { isActive: true, isDemo: false },
      select: { coopId: true }, distinct: ["coopId"],
    });
    for (const config of configs) {
      try {
        const result = await scanCommons(config.coopId);
        logger.info("Commons action scan completed", { coopId: config.coopId, ...result });
      } catch (error) {
        logger.error("Commons action scan failed", { coopId: config.coopId, error: String(error) });
      }
    }
  },
});
