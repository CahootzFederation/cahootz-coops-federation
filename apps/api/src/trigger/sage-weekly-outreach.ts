import { logger, schedules } from "@trigger.dev/sdk";

import {
  recordWeeklyOutreachOperationalStatus,
  runWeeklySageOutreach,
} from "../../../../packages/trpc/src/services/sage-weekly-outreach.js";
import {
  sendAgentOperationalAlert,
  sendSageOutreachDailyReport,
} from "../../../../packages/trpc/src/services/slack-notification-service.js";

// One stable weekday per member. The service's system key makes retries and the
// 48-hour recovery window safe; this schedule only decides when to look.
export const sageWeeklyOutreachSweep = schedules.task({
  id: "sage-weekly-outreach-sweep",
  cron: "0 18 * * *",
  maxDuration: 1800,
  run: async () => {
    const checkedAt = new Date();
    let summary: Awaited<ReturnType<typeof runWeeklySageOutreach>>;
    try {
      summary = await runWeeklySageOutreach();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await recordWeeklyOutreachOperationalStatus({
        checkedAt,
        status: "error",
        message: reason,
      }).catch(() => undefined);
      await sendAgentOperationalAlert({
        checkedAt,
        source: "Trigger.dev outreach sweep",
        issues: [
          {
            agentId: "sage-weekly-outreach",
            state: "FAILED",
            reason: `The daily outreach sweep crashed: ${reason}`,
          },
        ],
      });
      throw error;
    }
    const slackDelivered = await sendSageOutreachDailyReport({
      ...summary,
      checkedAt,
    });
    const runFailed =
      summary.failed > 0 ||
      summary.modelFallbacks > 0 ||
      !slackDelivered;
    await recordWeeklyOutreachOperationalStatus({
      checkedAt,
      status: runFailed ? "error" : "success",
      ...(runFailed
        ? {
            message: `failed=${summary.failed}; modelFallbacks=${summary.modelFallbacks}; slackDelivered=${slackDelivered}`,
          }
        : {}),
    });
    if (!slackDelivered) {
      throw new Error(
        "Sage outreach ran, but its required daily Slack report was not delivered.",
      );
    }
    logger.info("Sage weekly outreach sweep completed", {
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
