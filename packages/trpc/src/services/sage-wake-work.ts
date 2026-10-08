/**
 * Work each wake cycle does for a Commons after its due tasks: following up on waiting suggestions
 * (closing ones that no longer apply or went unanswered), expiring routed alerts, keeping memory
 * current, and the steward's review. Each step is isolated so one failure doesn't stop the others.
 */
import { expireSageAlerts } from "./sage-responsibility.js";
import { maintainSageMemory } from "./sage-memory.js";
import { purgePersonMentions } from "./sage-person-mentions.js";
import { runStewardReview } from "./sage-steward.js";
import { followUpOnSuggestions } from "./sage-suggestion-follow-up.js";

type Step = { name: string; run: (coopId: string, now: Date) => Promise<unknown> };

const steps: Step[] = [
  { name: "follow up on suggestions", run: followUpOnSuggestions },
  { name: "expire alerts", run: expireSageAlerts },
  { name: "maintain memory", run: maintainSageMemory },
  { name: "purge person mentions", run: purgePersonMentions },
  // At most once a day per Commons (the steward checks its own last run), and only within the monthly limit.
  { name: "steward review", run: (coopId, now) => runStewardReview(coopId, now) },
];

export async function wakeCycleWork(coopId: string, now = new Date()): Promise<void> {
  for (const step of steps) {
    try {
      await step.run(coopId, now);
    } catch (error) {
      console.error(`Sage wake step "${step.name}" failed`, { coopId, error });
    }
  }
}
