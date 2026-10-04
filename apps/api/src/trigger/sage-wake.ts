import { logger, schedules } from "@trigger.dev/sdk";
import { runAllSageWakeCycles } from "../../../../packages/trpc/src/services/sage-wake.js";

// Sage's wake-and-wait loop: checks due follow-ups, sends at most one reminder, closes what's done,
// and runs each Commons' cycle work. The API runs the same loop on an interval when Trigger isn't set up.
export const sageWakeSweep = schedules.task({
  id: "sage-wake-sweep",
  cron: "*/15 * * * *",
  maxDuration: 900,
  run: async () => {
    const results = await runAllSageWakeCycles("SCHEDULED");
    logger.info("Sage wake sweep completed", { results });
    return { commons: results.length };
  },
});
