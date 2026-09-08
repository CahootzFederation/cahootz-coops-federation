import { db } from "@repo/db";

export interface RecordAIEvaluationParams {
  agentKey: string;
  agentName: string;
  model?: string;
  entityType?: string;
  entityId?: string;
  input?: unknown;
  output?: unknown;
  status?: "SUCCESS" | "ERROR";
  error?: string;
  durationMs?: number;
}

/**
 * Generic log of every AI agent evaluation across the app. Any current or
 * future agent can write to this table without a schema migration - it's
 * the single place to see "every AI evaluation the app has run."
 */
export async function recordAIEvaluation(params: RecordAIEvaluationParams) {
  return db.aIEvaluation.create({
    data: {
      agentKey: params.agentKey,
      agentName: params.agentName,
      model: params.model,
      entityType: params.entityType,
      entityId: params.entityId,
      input: params.input as any,
      output: params.output as any,
      status: params.status ?? "SUCCESS",
      error: params.error,
      durationMs: params.durationMs,
    },
  });
}

export interface WithAIEvaluationLoggingMeta {
  agentKey: string;
  agentName: string;
  model?: string;
  entityType?: string;
  entityId?: string;
  input?: unknown;
}

/**
 * Runs `fn`, then records the result (or error) as an AIEvaluation row.
 * Logging failures never mask the underlying agent error.
 */
export async function withAIEvaluationLogging<T>(
  meta: WithAIEvaluationLoggingMeta,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  try {
    const output = await fn();
    await recordAIEvaluation({ ...meta, output, durationMs: Date.now() - start }).catch((err) =>
      console.error(`Failed to log AIEvaluation for agent "${meta.agentKey}":`, err),
    );
    return output;
  } catch (err) {
    await recordAIEvaluation({
      ...meta,
      status: "ERROR",
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    }).catch((logErr) => console.error(`Failed to log AIEvaluation error for agent "${meta.agentKey}":`, logErr));
    throw err;
  }
}
