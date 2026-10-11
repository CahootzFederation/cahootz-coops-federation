import { logger, schedules } from "@trigger.dev/sdk";

import { runWeeklySageOutreach } from "../../../../packages/trpc/src/services/sage-weekly-outreach.js";

// One stable weekday per member. The service's system key makes retries and the
// 48-hour recovery window safe; this schedule only decides when to look.
export const sageWeeklyOutreachSweep = schedules.task({
  id: "sage-weekly-outreach-sweep",
  cron: "0 18 * * *",
  maxDuration: 1800,
  run: async () => {
    const summary = await runWeeklySageOutreach();
    logger.info("Sage weekly outreach sweep completed", { ...summary });
    return summary;
  },
});
