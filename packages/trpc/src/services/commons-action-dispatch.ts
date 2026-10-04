export type CommonsActionSourceType = "commons_post" | "commons_comment";

let warnedAboutLocalTriggerKey = false;

/** Dispatch after the content write commits. The durable scan claim prevents repeat analysis. */
export async function enqueueCommonsActionContent(sourceType: CommonsActionSourceType, sourceId: string): Promise<void> {
  const triggerKey = process.env.TRIGGER_SECRET_KEY?.trim();
  const wrongLocalKey = Boolean(triggerKey && process.env.NODE_ENV !== "production" && !triggerKey.startsWith("tr_dev_"));
  if (wrongLocalKey && !warnedAboutLocalTriggerKey) {
    console.warn("Commons action scans are running in the API because the local Trigger key is not a development key. Set a tr_dev_ key to use trigger dev.");
    warnedAboutLocalTriggerKey = true;
  }
  if (!triggerKey || wrongLocalKey) {
    // Local API development can run without Trigger.dev, so the scan runs on the API backend - in the
    // background, like the Trigger job it stands in for, so creating a post or comment never waits on
    // a model call. The durable scan claim and the daily recovery scan cover a crash mid-scan.
    void import("./commons-action-agent.js")
      .then(({ processCommonsActionContent }) => processCommonsActionContent(sourceType, sourceId))
      .catch((error) => console.error("Commons action scan failed", { sourceType, sourceId, error }));
    return;
  }
  const { tasks } = await import("@trigger.dev/sdk");
  await tasks.trigger("commons-action-content", { sourceType, sourceId }, {
    idempotencyKey: `commons-action-content:${sourceType}:${sourceId}`,
    idempotencyKeyTTL: "24h",
  });
}
