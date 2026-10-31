import { randomUUID } from "node:crypto";
import { logger, schedules, task } from "@trigger.dev/sdk";

import { db } from "../../../../packages/db/index.js";
import { runProductDiscoveryForProfile } from "../../../../packages/trpc/src/services/product-discovery.js";

function isDue(
  profile: { lastDiscoveredAt: Date | null; discoveryIntervalHours: number },
  now: Date,
) {
  if (!profile.lastDiscoveredAt) return true;
  const intervalMs = profile.discoveryIntervalHours * 60 * 60 * 1_000;
  return now.getTime() - profile.lastDiscoveredAt.getTime() >= intervalMs;
}

export const runProductDiscovery = task({
  id: "run-product-discovery",
  maxDuration: 1_800,
  // source "admin": a platform admin's extra search, outside the monthly limit.
  run: async (payload: { profileKey: string; requestId?: string; source?: "admin"; hint?: string }) => {
    const profileKey = payload.profileKey?.trim();
    if (!profileKey) throw new Error("profileKey is required.");

    const result = await runProductDiscoveryForProfile({
      profileKey,
      trigger: payload.source === "admin" ? "admin" : "manual",
      hint: payload.hint,
      idempotencyKey:
        payload.requestId?.trim() || `manual:${profileKey}:${randomUUID()}`,
    });
    logger.info("Product discovery run completed", { profileKey, ...result });
    return result;
  },
});

// The sweep runs daily but each profile owns its cadence and monthly call cap.
// That lets a new Commons opt into weekly discovery without multiplying model
// calls every time the platform adds another scheduled task.
export const productDiscoverySweep = schedules.task({
  id: "product-discovery-sweep",
  cron: "20 13 * * *",
  maxDuration: 3_600,
  run: async () => {
    const now = new Date();
    const profiles = await db.commonsProductProfile.findMany({
      where: { isEnabled: true },
      select: {
        key: true,
        name: true,
        lastDiscoveredAt: true,
        discoveryIntervalHours: true,
      },
      orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
      take: 100,
    });
    const outcomes: Array<{
      profileKey: string;
      status: string;
      runId?: string;
      message?: string;
    }> = [];

    for (const profile of profiles) {
      if (!isDue(profile, now)) {
        outcomes.push({ profileKey: profile.key, status: "not_due" });
        continue;
      }

      try {
        const result = await runProductDiscoveryForProfile({
          profileKey: profile.key,
          trigger: "scheduled",
          idempotencyKey: `scheduled:${profile.key}:${now.toISOString().slice(0, 10)}`,
          now,
        });
        outcomes.push({
          profileKey: profile.key,
          status: result.status,
          runId: result.runId,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Product discovery failed.";
        logger.error("Product discovery profile failed", {
          profileKey: profile.key,
          profileName: profile.name,
          error: message,
        });
        outcomes.push({
          profileKey: profile.key,
          status: "failed",
          message,
        });
      }
    }

    logger.info("Product discovery sweep completed", {
      profileCount: profiles.length,
      dueCount: outcomes.filter(({ status }) => status !== "not_due").length,
      outcomes,
    });
    return { profileCount: profiles.length, outcomes };
  },
});
