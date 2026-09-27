import { logger, schedules } from "@trigger.dev/sdk";
import { db } from "../../../../packages/db/index.js";
import {
  INTRO_ADMIN_ESCALATION_AFTER_MS,
  INTRO_GUIDE_ESCALATION_AFTER_MS,
  escalateUnansweredIntros,
} from "../../../../packages/trpc/src/services/welcome-intros.js";

// Finds welcome lounge intros nobody has answered and nudges the lounge
// guide (after ~2h), then the platform admins, who can assign guides (after ~12h). Each stage fires
// at most once per intro - the state lives on WelcomeIntro, so overlapping
// or retried runs are safe.
export const welcomeIntroEscalationSweep = schedules.task({
  id: "welcome-intro-escalation-sweep",
  cron: "*/15 * * * *",
  maxDuration: 300,
  run: async () => {
    const result = await escalateUnansweredIntros(db);
    logger.info("Welcome intro escalation sweep completed", {
      ...result,
      guideAfterMinutes: INTRO_GUIDE_ESCALATION_AFTER_MS / 60000,
      adminAfterMinutes: INTRO_ADMIN_ESCALATION_AFTER_MS / 60000,
    });
  },
});
