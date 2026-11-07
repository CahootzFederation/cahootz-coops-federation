let warnedAboutLocalTriggerKey = false;

/** True when there is no usable Trigger key, so Sage work runs in the API process instead. */
export function useLocalFallback(): boolean {
  const triggerKey = process.env.TRIGGER_SECRET_KEY?.trim();
  const wrongLocalKey = Boolean(triggerKey && process.env.NODE_ENV !== "production" && !triggerKey.startsWith("tr_dev_"));
  if (wrongLocalKey && !warnedAboutLocalTriggerKey) {
    console.warn("Sage jobs are running in the API because the local Trigger key is not a development key. Set a tr_dev_ key to use trigger dev.");
    warnedAboutLocalTriggerKey = true;
  }
  return !triggerKey || wrongLocalKey;
}

/** Dispatch trend detection for a closed circle window. */
export async function enqueueSageTrendDetect(windowId: string): Promise<void> {
  if (useLocalFallback()) {
    const { processTrendWindow } = await import("./sage-trend-agent.js");
    await processTrendWindow(windowId);
    return;
  }
  const { tasks } = await import("@trigger.dev/sdk");
  await tasks.trigger("sage-trend-detect", { windowId }, {
    idempotencyKey: `sage-trend-detect:${windowId}`,
    idempotencyKeyTTL: "24h",
  });
}

/** Dispatch execution of an approved Sage action's tool. Re-verified from scratch inside the task before it runs anything. */
export async function enqueueSageActionExecute(actionId: string, revision: number): Promise<void> {
  if (useLocalFallback()) {
    const { executeSageAction } = await import("./commons-action-tools.js");
    await executeSageAction(actionId);
    return;
  }
  const { tasks } = await import("@trigger.dev/sdk");
  await tasks.trigger("sage-action-execute", { actionId }, {
    idempotencyKey: `sage-action-execute:${actionId}:${revision}`,
    idempotencyKeyTTL: "24h",
  });
}

/** Re-evaluate Commons hypotheses immediately after the charter/config version changes. */
export async function enqueueCommunityMemoryReconsideration(coopId: string, configVersion: number): Promise<void> {
  if (useLocalFallback()) {
    const { consolidateCommonsMemory } = await import("./sage-community-memory.js");
    await consolidateCommonsMemory(coopId);
    return;
  }
  const { tasks } = await import("@trigger.dev/sdk");
  await tasks.trigger("sage-community-memory-consolidate", { coopId }, {
    idempotencyKey: `sage-community-memory-config:${coopId}:${configVersion}`,
    idempotencyKeyTTL: "24h",
  });
}
