/**
 * Work each wake cycle does for a Commons after its due tasks: following up on waiting suggestions
 * (closing ones that no longer apply or went unanswered), expiring routed alerts, keeping memory
 * current, asking a likely helper about needs nobody answered, the weekly community rhythm posts, the
 * twice-weekly proposal writer, and the steward's review. Each step is isolated so one failure doesn't stop the others.
 */
import { expireSageAlerts } from "./sage-responsibility.js";
import { runCommunityRhythm } from "./sage-community-rhythm.js";
import { maintainSageMemory } from "./sage-memory.js";
import { runStewardReview } from "./sage-steward.js";
import { followUpOnSuggestions } from "./sage-suggestion-follow-up.js";
import { summarizeProposalsNearingVote } from "./sage-pre-vote.js";
import { runProposalWriterIfDue } from "./sage-proposal-writer.js";
import { askHelpersForUnansweredNeeds } from "./sage-unanswered-needs.js";

type Step = { name: string; run: (coopId: string, now: Date) => Promise<unknown> };

const steps: Step[] = [
  { name: "follow up on suggestions", run: followUpOnSuggestions },
  { name: "expire alerts", run: expireSageAlerts },
  { name: "maintain memory", run: maintainSageMemory },
  // Deterministic and capped per Commons per day; each ask counts toward the helper's weekly outreach limit.
  { name: "unanswered needs", run: askHelpersForUnansweredNeeds },
  // Templated rhythm posts (Monday priorities, midweek open requests, Friday appreciation, monthly review):
  // no model call, one post per category per period, skipped in Commons with too few active members.
  { name: "community rhythm", run: (coopId, now) => runCommunityRhythm(coopId, now) },
  // One balanced summary per proposal whose vote closes within 48 hours; one model call each, within the monthly limit.
  { name: "pre-vote summaries", run: summarizeProposalsNearingVote },
  // Twice a week per Commons (Mon–Wed and Thu–Sun, claimed once each): measure the charter goals, note any
  // falling behind, and share at most one proposal idea, or record why not. Also queues changes members
  // voted through for a steward. At most one model call, within the monthly limit.
  { name: "proposal writer", run: runProposalWriterIfDue },
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
