import { logger, schedules } from "@trigger.dev/sdk";
import { db } from "../../../../packages/db/index.js";
import { runOnboardingDrip } from "../../../../packages/trpc/src/services/onboarding-drip.js";

// Hourly new-member re-engagement drip (day 1 / 3 / 7). Selection rules,
// thresholds and copy: packages/trpc/src/services/onboarding-drip*.ts.
// Each step is claimed in OnboardingDripSend before delivery, so an
// overlapping or retried run can't send it twice.
export const onboardingDripSweep = schedules.task({
  id: "onboarding-drip-sweep",
  cron: "15 * * * *",
  maxDuration: 600,
  run: async () => {
    const summary = await runOnboardingDrip(db);
    logger.info("Onboarding drip sweep completed", { ...summary });
    return summary;
  },
});
