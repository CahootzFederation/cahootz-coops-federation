import { logger, schedules } from "@trigger.dev/sdk";
import { db } from "../../../../packages/db/index.js";
import { runOutreachSweep } from "../../../../packages/trpc/src/services/vendor-outreach/outreach-sweep.js";

// Hourly vendor outreach for campaigns a platform admin approved: finds and checks
// businesses for newly approved campaigns, then sends first emails and one follow-up
// on weekdays 9-5 Eastern, at most 20 a day across the platform. Every email step is
// claimed by a unique OutreachMessage row first, so a rerun never emails anyone twice.
// Until the outreach sender and mailing address are set up, emails are saved as DRY_RUN.
export const vendorOutreachHourly = schedules.task({
  id: "vendor-outreach-hourly",
  cron: "5 * * * *",
  maxDuration: 900,
  run: async () => {
    const summary = await runOutreachSweep(db);
    logger.info("Vendor outreach sweep completed", { ...summary });
    return summary;
  },
});
