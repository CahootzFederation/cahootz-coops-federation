import { logger, schedules } from "@trigger.dev/sdk";

import { getAgentOperationalSnapshot } from "../../../../packages/trpc/src/services/agent-operations.js";
import { sendAgentOperationalAlert } from "../../../../packages/trpc/src/services/slack-notification-service.js";
import { env } from "../env.js";

// Independent of any one product agent: while an agent is off, gated, paused,
// stale, or broken, this posts the same loud alert every hour until it clears.
export const agentOperationsWatchdog = schedules.task({
  id: "agent-operations-watchdog",
  cron: "5 * * * *",
  maxDuration: 600,
  run: async () => {
    const snapshot = await getAgentOperationalSnapshot();
    if (snapshot.healthy) {
      logger.info("Agent operations watchdog passed", { checkedAt: snapshot.checkedAt.toISOString() });
      return { healthy: true, issueCount: 0 };
    }

    const delivered = await sendAgentOperationalAlert({
      checkedAt: snapshot.checkedAt,
      issues: snapshot.issues,
      environment: env.NODE_ENV,
    });
    if (!delivered) throw new Error(`Agent watchdog found ${snapshot.issues.length} issue(s), but Slack delivery failed.`);

    logger.error("Agent operations watchdog found issues", {
      checkedAt: snapshot.checkedAt.toISOString(),
      issues: snapshot.issues,
    });
    return { healthy: false, issueCount: snapshot.issues.length };
  },
});
