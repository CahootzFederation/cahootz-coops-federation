import { logger, schedules } from "@trigger.dev/sdk";

import { runWeeklySageOutreach } from "../../../../packages/trpc/src/services/sage-weekly-outreach.js";
import { sendSageOutreachDailyReport } from "../../../../packages/trpc/src/services/slack-notification-service.js";

// One stable weekday per member. The service's system key makes retries and the
// 48-hour recovery window safe; this schedule only decides when to look.
export const sageWeeklyOutreachSweep = schedules.task({
  id: "sage-weekly-outreach-sweep",
  cron: "0 18 * * *",
  maxDuration: 1800,
  run: async () => {
    const summary = await runWeeklySageOutreach();
    const slackDelivered = await sendSageOutreachDailyReport({ ...summary, checkedAt: new Date() });
    if (!slackDelivered) {
      throw new Error("Sage outreach ran, but its required daily Slack report was not delivered.");
    }
    logger.info("Sage weekly outreach sweep completed", {
      enabled: summary.enabled,
      considered: summary.considered,
      due: summary.due,
      sent: summary.sent,
      recent: summary.recent,
      duplicate: summary.duplicate,
      failed: summary.failed,
      modelFallbacks: summary.modelFallbacks,
      slackDelivered,
    });
    return summary;
  },
});
