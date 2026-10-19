import { logger, schedules } from "@trigger.dev/sdk";

import { getAgentOperationalSnapshot } from "../../../../packages/trpc/src/services/agent-operations.js";
import { sendAgentOperationalAlert } from "../../../../packages/trpc/src/services/slack-notification-service.js";

// Independent of any one product agent: while an agent is off, gated, paused,
// stale, or broken, this posts the same loud alert every hour until it clears.
export const agentOperationsWatchdog = schedules.task({
  id: "agent-operations-watchdog",
  cron: "5 * * * *",
  maxDuration: 600,
  run: async () => {
    let snapshot: Awaited<ReturnType<typeof getAgentOperationalSnapshot>>;
    try {
      snapshot = await getAgentOperationalSnapshot();
    } catch (error) {
      const checkedAt = new Date();
      const delivered = await sendAgentOperationalAlert({
        checkedAt,
        source: "Trigger.dev watchdog",
        issues: [
          {
            agentId: "agent-health-inspection",
            state: "BROKEN",
            reason:
              "The watchdog could not read agent health from the database. Check the Trigger.dev run and application logs.",
          },
        ],
      });
      logger.error("Agent operations watchdog could not inspect health", {
        error: String(error),
      });
      if (!delivered)
        throw new Error(
          "Agent health inspection and Slack delivery both failed.",
        );
      throw error;
    }
    if (snapshot.healthy) {
      logger.info("Agent operations watchdog passed", {
        checkedAt: snapshot.checkedAt.toISOString(),
      });
      return { healthy: true, issueCount: 0 };
    }

    const delivered = await sendAgentOperationalAlert({
      checkedAt: snapshot.checkedAt,
      issues: snapshot.issues,
      source: "Trigger.dev watchdog",
    });
    if (!delivered)
      throw new Error(
        `Agent watchdog found ${snapshot.issues.length} issue(s), but Slack delivery failed.`,
      );

    logger.error("Agent operations watchdog found issues", {
      checkedAt: snapshot.checkedAt.toISOString(),
      issues: snapshot.issues,
    });
    return { healthy: false, issueCount: snapshot.issues.length };
  },
});
