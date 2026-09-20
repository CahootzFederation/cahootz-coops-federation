import { db } from "@repo/db";
import { AsyncLocalStorage } from "node:async_hooks";
import { withProposalAIUsage } from "@repo/validators";

const commonsContext = new AsyncLocalStorage<string>();
export function withAICommonsContext<T>(coopId: string, fn: () => Promise<T>): Promise<T> {
  return commonsContext.run(coopId, fn);
}

// USD per million tokens, captured when the call is made. Unknown models stay
// unknown rather than making the dashboard misleadingly report $0.
const PRICE_VERSION = "openai-2026-09-19";
const PRICES: Record<string, { input: number; cached: number; output: number }> = {
  "gpt-5-nano": { input: 0.05, cached: 0.005, output: 0.40 },
  "gpt-5.2": { input: 1.75, cached: 0.175, output: 14 },
  "gpt-5.6-luna": { input: 0.20, cached: 0.02, output: 1.20 },
  "text-embedding-3-small": { input: 0.02, cached: 0.02, output: 0 },
};

export interface CostUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
}

export function estimateAICost(model: string, usage: CostUsage): number | null {
  const price = PRICES[model];
  if (!price || usage.inputTokens === undefined || usage.outputTokens === undefined) return null;
  const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
  return ((usage.inputTokens - cached) * price.input + cached * price.cached + usage.outputTokens * price.output) / 1_000_000;
}

export function usageFromAgentResult(result: {
  state?: { usage?: { inputTokens?: number; outputTokens?: number; inputTokensDetails?: Array<Record<string, number>> } };
}): CostUsage {
  const usage = result.state?.usage;
  if (!usage) return {};
  const cachedInputTokens = usage.inputTokensDetails?.reduce(
    (sum, details) => sum + (details.cached_tokens ?? details.cachedTokens ?? 0), 0,
  ) ?? 0;
  return { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cachedInputTokens };
}

export async function recordAICost(params: {
  coopId?: string | null;
  feature: string;
  model: string;
  status: "SUCCESS" | "ERROR";
  requestId?: string;
  usage?: CostUsage;
}) {
  const cost = estimateAICost(params.model, params.usage ?? {});
  return db.aICostEvent.create({
    data: {
      coopId: params.coopId ?? commonsContext.getStore() ?? null,
      feature: params.feature,
      model: params.model,
      status: params.status,
      requestId: params.requestId,
      inputTokens: params.usage?.inputTokens,
      cachedInputTokens: params.usage?.cachedInputTokens,
      outputTokens: params.usage?.outputTokens,
      costUsd: cost,
      pricingVersion: cost === null ? null : PRICE_VERSION,
    },
  });
}

export async function recordAgentResultCost(params: {
  coopId?: string | null;
  feature: string;
  model: string;
  result: Parameters<typeof usageFromAgentResult>[0];
}) {
  await recordAICost({
    coopId: params.coopId,
    feature: params.feature,
    model: params.model,
    status: "SUCCESS",
    usage: usageFromAgentResult(params.result),
  });
}

export function withCostedProposalRun<T>(coopId: string | null, feature: string, operation: () => Promise<T>): Promise<T> {
  return withProposalAIUsage(async (result, model) => {
    await recordAgentResultCost({ coopId, feature, model, result }).catch(console.error);
  }, operation);
}
