/**
 * Work each wake cycle does for a Commons after its due tasks: expiring routed alerts, keeping memory
 * current, and the steward's review. Each step is isolated so one failure doesn't stop the others.
 */
import { expireSageAlerts } from "./sage-responsibility.js";

type Step = { name: string; run: (coopId: string, now: Date) => Promise<unknown> };

const steps: Step[] = [
  { name: "expire alerts", run: expireSageAlerts },
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
