import { db } from "@repo/db";

import { useLocalFallback } from "./sage-dispatch.js";
import { runSageWakeCycle } from "./sage-tasks.js";
import { wakeCycleWork } from "./sage-wake-work.js";

/** One wake run for every active Commons. Used by the Trigger.dev schedule and the local interval. */
export async function runAllSageWakeCycles(reason: "SCHEDULED" | "MANUAL" = "SCHEDULED") {
  const configs = await db.coopConfig.findMany({
    where: { isActive: true, isDemo: false }, select: { coopId: true }, distinct: ["coopId"],
  });
  const results: Array<{ coopId: string; processed?: number; skipped?: boolean; error?: string }> = [];
  for (const { coopId } of configs) {
    try {
      const result = await runSageWakeCycle(coopId, reason, new Date(), (id) => wakeCycleWork(id));
      results.push({ coopId, ...(result.skipped ? { skipped: true } : { processed: result.processed }) });
    } catch (error) {
      results.push({ coopId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}

let localTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Without a usable Trigger key (local development and CI), the API runs the wake loop itself on an
 * interval, so follow-ups still happen. With Trigger configured, the scheduled task does it instead.
 */
export function startLocalSageWakeLoop(intervalMs = Number(process.env.SAGE_WAKE_INTERVAL_MS) || 60_000) {
  if (localTimer || !useLocalFallback()) return false;
  localTimer = setInterval(() => {
    void runAllSageWakeCycles("SCHEDULED").catch((error) => console.error("Sage wake loop failed", error));
  }, intervalMs);
  localTimer.unref?.();
  return true;
}

export function stopLocalSageWakeLoop() {
  if (localTimer) clearInterval(localTimer);
  localTimer = null;
}
