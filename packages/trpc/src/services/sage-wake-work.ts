/**
 * Work each wake cycle does for a Commons after its due tasks: following up on waiting suggestions
 * (closing ones that no longer apply or went unanswered), expiring routed alerts, keeping memory
 * current, asking a likely helper about needs nobody answered, and the steward's review. Each step is isolated so one failure doesn't stop the others.
 */
import { expireSageAlerts } from "./sage-responsibility.js";
import { maintainSageMemory } from "./sage-memory.js";
import { runStewardReview } from "./sage-steward.js";
import { followUpOnSuggestions } from "./sage-suggestion-follow-up.js";
import { summarizeProposalsNearingVote } from "./sage-pre-vote.js";
import { askHelpersForUnansweredNeeds } from "./sage-unanswered-needs.js";

type Step = { name: string; run: (coopId: string, now: Date) => Promise<unknown> };

const steps: Step[] = [
  { name: "follow up on suggestions", run: followUpOnSuggestions },
  { name: "expire alerts", run: expireSageAlerts },
  { name: "maintain memory", run: maintainSageMemory },
  // Deterministic and capped per Commons per day; each ask counts toward the helper's weekly outreach limit.
  { name: "unanswered needs", run: askHelpersForUnansweredNeeds },
  // One balanced summary per proposal whose vote closes within 48 hours; one model call each, within the monthly limit.
  { name: "pre-vote summaries", run: summarizeProposalsNearingVote },
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
