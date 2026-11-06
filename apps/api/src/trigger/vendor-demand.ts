import { logger, schedules } from "@trigger.dev/sdk";
import { db } from "../../../../packages/db/index.js";
import { runVendorDemandSweep } from "../../../../packages/trpc/src/services/vendor-outreach/demand.js";

// Weekly, after the 04:30 community memory consolidation: records how many
// members answered last week's deal questions, then posts at most one new
// deal-interest question per Commons. Rules: packages/trpc/src/services/vendor-outreach.
// The question is claimed by a unique CommonsAction key, so a rerun posts nothing new.
export const vendorDemandWeekly = schedules.task({
  id: "vendor-demand-weekly",
  cron: "0 5 * * 1",
  maxDuration: 600,
  run: async () => {
    const summary = await runVendorDemandSweep({}, db);
    logger.info("Vendor demand sweep completed", { commons: summary.commons, failed: summary.failed });
    return summary;
  },
});
