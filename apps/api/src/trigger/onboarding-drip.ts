import { logger, schedules } from "@trigger.dev/sdk";
import { runActivationSweep } from "../../../../packages/trpc/src/services/sage-activation.js";

// Hourly sweep for Sage's new-member activation journey (welcome, connect, contribute), which replaced
// the day 1/3/7 drip. The task id is unchanged so the existing schedule keeps running. Steps, copy and
// outcome checks: packages/trpc/src/services/sage-activation.ts. Each message is idempotent by its
// Sage system key, and each sent step is recorded in OnboardingDripSend.
export const onboardingDripSweep = schedules.task({
  id: "onboarding-drip-sweep",
  cron: "15 * * * *",
  maxDuration: 600,
  run: async () => {
    const summary = await runActivationSweep();
    logger.info("Sage activation sweep completed", { ...summary });
    return summary;
  },
});
