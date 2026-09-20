export type CommonsActionSourceType = "commons_post" | "commons_comment";

/** Enqueue after the content write commits. The durable scan claim prevents repeat analysis. */
export async function enqueueCommonsActionContent(sourceType: CommonsActionSourceType, sourceId: string): Promise<void> {
  const { tasks } = await import("@trigger.dev/sdk");
  await tasks.trigger("commons-action-content", { sourceType, sourceId }, {
    idempotencyKey: `commons-action-content:${sourceType}:${sourceId}`,
    idempotencyKeyTTL: "24h",
  });
}
