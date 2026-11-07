import { logger, schedules } from "@trigger.dev/sdk";

import { db } from "../../../../packages/db/index.js";
import { checkPushReceipts } from "../../../../packages/trpc/src/services/push-receipt-service.js";

// Expo only tells us whether Apple/Google delivered a push ~15 minutes after we send it.
// This reads those receipts, turns off dead devices, and posts any failed pushes to Slack.
export const pushReceiptCheck = schedules.task({
  id: "push-receipt-check",
  cron: "*/15 * * * *",
  maxDuration: 300,
  run: async () => {
    const result = await checkPushReceipts(db);
    logger.info("Push receipt check completed", result);
    if (result.newFailures && !result.alerted)
      throw new Error("Found failed pushes but couldn't post the Slack alert. Check SLACK_WEBHOOK_URL.");
    return result;
  },
});
