import { logger, schedules } from "@trigger.dev/sdk";

import { getDatabaseId } from "../../../../packages/trpc/src/services/agent-operations.js";
import { runSageDevIssueSuggestion } from "../../../../packages/trpc/src/services/sage-dev-issues.js";
import { sendAgentOperationalAlert } from "../../../../packages/trpc/src/services/slack-notification-service.js";

// Looks every day; the service drafts at most one issue per week (or month,
// per the admin setting), so the first run of each period does the work.
export const sageDevIssueSweep = schedules.task({
  id: "sage-dev-issue-sweep",
  cron: "0 15 * * *",
  maxDuration: 300,
  run: async () => {
    const checkedAt = new Date();
    try {
      const result = await runSageDevIssueSuggestion({ now: checkedAt });
      logger.info("Sage issue idea sweep finished", result);
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await sendAgentOperationalAlert({
        checkedAt,
        source: "Trigger.dev issue idea sweep",
        databaseId: await getDatabaseId(),
        issues: [{ agentId: "sage-dev-issue", state: "FAILED", reason: `Sage couldn't draft this period's issue idea: ${reason}` }],
      });
      throw error;
    }
  },
});
