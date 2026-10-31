import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { db as defaultDb } from "@repo/db";

import { auditLogEntry } from "../../lib/audit.js";
import { useLocalFallback } from "../sage-dispatch.js";

type Db = typeof defaultDb;

// A run that never finished (the worker died) stops blocking new runs once the
// Trigger task's own time limit has passed.
const RUN_STALE_MS = 30 * 60_000;

function startOfUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Each product-discovery profile with this month's usage and its latest run, for the Product ideas tab. */
export async function listDiscoveryProfilesForAdmin(db: Db, now = new Date()) {
  const profiles = await db.commonsProductProfile.findMany({
    select: {
      id: true,
      key: true,
      name: true,
      coopId: true,
      isEnabled: true,
      monthlyRunLimit: true,
      discoveryRuns: {
        orderBy: { startedAt: "desc" },
        take: 1,
        select: {
          status: true,
          trigger: true,
          startedAt: true,
          finishedAt: true,
          savedProductCount: true,
          savedMatchCount: true,
          error: true,
        },
      },
    },
    orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
    take: 100,
  });
  const counts = await db.productDiscoveryRun.groupBy({
    by: ["profileId", "trigger"],
    where: { status: "SUCCEEDED", startedAt: { gte: startOfUtcMonth(now) } },
    _count: { _all: true },
  });
  // Scheduled and command-line runs use up the monthly limit; an admin's extra searches don't.
  const usedByProfile = new Map<string, number>();
  const extraByProfile = new Map<string, number>();
  for (const row of counts) {
    const totals = row.trigger === "admin" ? extraByProfile : usedByProfile;
    totals.set(row.profileId, (totals.get(row.profileId) ?? 0) + row._count._all);
  }
  return profiles.map(({ id, discoveryRuns, ...profile }) => {
    const latest = discoveryRuns[0] ?? null;
    return {
      ...profile,
      runsThisMonth: usedByProfile.get(id) ?? 0,
      extraRunsThisMonth: extraByProfile.get(id) ?? 0,
      running: Boolean(latest && latest.status === "RUNNING" && now.getTime() - latest.startedAt.getTime() < RUN_STALE_MS),
      latestRun: latest,
    };
  });
}

export const startDiscoveryRunSchema = z.object({ profileKey: z.string().trim().min(1).max(100) });

/**
 * Start an extra product-discovery run for one profile from the admin page and
 * hand it to Trigger.dev. It doesn't count toward the profile's monthly limit
 * or move its schedule; one run at a time per profile keeps it bounded. What it
 * finds is saved as candidates only.
 */
export async function startProductDiscoveryRun(
  db: Db,
  actorId: string,
  raw: z.input<typeof startDiscoveryRunSchema>,
  options: { now?: Date; dispatch?: (profileKey: string, requestId: string) => Promise<void> } = {},
) {
  const { profileKey } = startDiscoveryRunSchema.parse(raw);
  const now = options.now ?? new Date();
  const profile = await db.commonsProductProfile.findUnique({
    where: { key: profileKey },
    select: { id: true, key: true, name: true, isEnabled: true },
  });
  if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "We couldn't find that product profile. Refresh and try again." });
  if (!profile.isEnabled) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Product search is turned off for ${profile.name}, so it can't run.` });
  }
  const running = await db.productDiscoveryRun.findFirst({
    where: { profileId: profile.id, status: "RUNNING", startedAt: { gte: new Date(now.getTime() - RUN_STALE_MS) } },
    select: { id: true },
  });
  if (running) throw new TRPCError({ code: "CONFLICT", message: `A product search for ${profile.name} is already running. Give it a few minutes.` });

  const requestId = `admin:${profile.key}:${randomUUID()}`;
  await (options.dispatch ?? dispatchProductDiscovery)(profile.key, requestId);
  await db.auditLog.create({
    data: auditLogEntry({ actorId, action: "PRODUCT_DISCOVERY_STARTED", resource: "CommonsProductProfile", resourceId: profile.id, metadata: { requestId } }),
  });
  return { ok: true as const, profileName: profile.name };
}

async function dispatchProductDiscovery(profileKey: string, requestId: string) {
  if (useLocalFallback()) {
    // A serverless request can't outlive its response, so production needs Trigger.
    if (process.env.NODE_ENV === "production") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Background jobs aren't set up here (TRIGGER_SECRET_KEY is missing), so the search can't start. Run it from Trigger.dev instead.",
      });
    }
    const { runProductDiscoveryForProfile } = await import("../product-discovery.js");
    void runProductDiscoveryForProfile({ profileKey, trigger: "admin", idempotencyKey: requestId }).catch((error) => {
      console.error("[product discovery] local run failed", error);
    });
    return;
  }
  const { tasks } = await import("@trigger.dev/sdk");
  await tasks.trigger("run-product-discovery", { profileKey, requestId, source: "admin" }, { idempotencyKey: requestId, idempotencyKeyTTL: "1h" });
}
