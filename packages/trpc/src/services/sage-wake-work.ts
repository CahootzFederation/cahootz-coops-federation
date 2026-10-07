/**
 * Work each wake cycle does for a Commons after its due tasks: expiring routed alerts, starting and
 * closing proposal outcome checks, keeping memory current, and the steward's review. Each step is isolated so one failure doesn't stop the others.
 */
import { scheduleProposalOutcomeChecks } from "./proposal-outcomes.js";
import { expireSageAlerts } from "./sage-responsibility.js";
import { maintainSageMemory } from "./sage-memory.js";
import { runStewardReview } from "./sage-steward.js";

type Step = { name: string; run: (coopId: string, now: Date) => Promise<unknown> };

const steps: Step[] = [
  { name: "expire alerts", run: expireSageAlerts },
  // No model calls: dates, data and notifications only.
  { name: "proposal outcomes", run: scheduleProposalOutcomeChecks },
  { name: "maintain memory", run: maintainSageMemory },
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
