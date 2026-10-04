import { db } from "@repo/db";

// Model work Sage starts on its own (not at a member's request). Only these features count toward
// the autonomy limit, and only these features pause when it is reached. Member-requested Sage
// conversations, proposal reviews, and everything else keep working.
export const AUTONOMOUS_SAGE_FEATURES = ["commons-action-agent", "sage-trend-detect", "sage-ride-match-detect", "sage-steward"] as const;

// Defaults match the CommonsAgentSetting column defaults; a Commons with no setting row uses them.
export const DEFAULT_SAGE_AUTONOMY_MONTHLY_USD = 5;
export const DEFAULT_SAGE_AUTONOMY_MONTHLY_CALLS = 2000;

type AutonomyReader = Pick<typeof db, "aICostEvent" | "commonsAgentSetting">;

/** A Commons' limits, set by a platform admin on its agent settings. */
export async function sageAutonomyLimits(coopId: string, client: AutonomyReader = db) {
  const setting = await client.commonsAgentSetting.findUnique({
    where: { coopId },
    select: { autonomyMonthlyUsdLimit: true, autonomyMonthlyCallLimit: true },
  });
  return {
    usdLimit: setting ? Number(setting.autonomyMonthlyUsdLimit) : DEFAULT_SAGE_AUTONOMY_MONTHLY_USD,
    callLimit: setting?.autonomyMonthlyCallLimit ?? DEFAULT_SAGE_AUTONOMY_MONTHLY_CALLS,
  };
}

export interface SageAutonomyUsage {
  usd: number;
  calls: number;
  usdLimit: number;
  callLimit: number;
  paused: boolean;
  pausedReason: "USD_LIMIT" | "CALL_LIMIT" | null;
  resetsAt: string;
}

/** This UTC month's autonomous Sage usage for one Commons. Calls on unpriced models count toward the
 * call limit even though they add nothing to the dollar total, so an unknown price can't bypass the cap. */
export async function getSageAutonomyUsage(coopId: string, client: AutonomyReader = db, now = new Date()): Promise<SageAutonomyUsage> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const [totals, { usdLimit, callLimit }] = await Promise.all([
    client.aICostEvent.aggregate({
      where: { coopId, feature: { in: [...AUTONOMOUS_SAGE_FEATURES] }, createdAt: { gte: monthStart } },
      _sum: { costUsd: true },
      _count: { _all: true },
    }),
    sageAutonomyLimits(coopId, client),
  ]);
  const usd = Number(totals._sum.costUsd ?? 0);
  const calls = totals._count._all;
  const pausedReason = usd >= usdLimit ? "USD_LIMIT" : calls >= callLimit ? "CALL_LIMIT" : null;
  return { usd, calls, usdLimit, callLimit, paused: pausedReason !== null, pausedReason, resetsAt: nextMonthStart.toISOString() };
}

/** Checked before every autonomous model call. A failed usage lookup pauses rather than spends. */
export async function sageAutonomyAllowed(coopId: string): Promise<boolean> {
  try {
    const usage = await getSageAutonomyUsage(coopId);
    if (usage.paused) console.warn(`Sage autonomy paused for ${coopId}: ${usage.pausedReason}`);
    return !usage.paused;
  } catch (error) {
    console.error("Could not read Sage autonomy usage; skipping autonomous work", error);
    return false;
  }
}
