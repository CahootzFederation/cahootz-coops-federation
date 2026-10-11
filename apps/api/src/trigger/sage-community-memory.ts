import { logger, schedules, task, tasks } from "@trigger.dev/sdk";
import { db } from "../../../../packages/db/index.js";

import { COMMUNITY_MEMORY_FLAG, consolidateCommonsMemory } from "../../../../packages/trpc/src/services/sage-community-memory.js";

export const sageCommunityMemoryConsolidate = task({
  id: "sage-community-memory-consolidate",
  maxDuration: 300,
  run: async (payload: { coopId: string }) => consolidateCommonsMemory(payload.coopId),
});

// Reconciles privacy-qualified member signals into Sage-internal Commons
// hypotheses. Each Commons is isolated inside the service so one failure does
// not prevent the remaining Commons from being evaluated.
export const sageCommunityMemorySweep = schedules.task({
  id: "sage-community-memory-sweep",
  cron: "30 4 * * *",
  maxDuration: 1800,
  run: async () => {
    const enabled = (await db.featureFlag.findUnique({ where: { key: COMMUNITY_MEMORY_FLAG }, select: { enabled: true } }))?.enabled ?? false;
    if (!enabled) return { enabled: false, commons: 0 };
    const configs = await db.coopConfig.findMany({
      where: { isActive: true, isDemo: false }, select: { coopId: true }, distinct: ["coopId"],
    });
    for (const { coopId } of configs) {
      await tasks.trigger("sage-community-memory-consolidate", { coopId }, {
        idempotencyKey: `sage-community-memory-daily:${coopId}:${new Date().toISOString().slice(0, 10)}`,
        idempotencyKeyTTL: "24h",
      });
    }
    const summary = { enabled: true, commons: configs.length };
    logger.info("Sage community memory sweep completed", { ...summary });
    return summary;
  },
});
