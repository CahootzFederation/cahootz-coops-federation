// Trigger.dev tasks that can call an OpenAI model. Without OPENAI_API_KEY these
// quietly fall back to keyword logic or skip their work, so production runs must
// fail loudly instead. Keep this list in sync with apps/api/src/trigger; the test
// in __tests__/trigger-model-key.test.ts checks every id still exists there.
export const MODEL_TASK_IDS: ReadonlySet<string> = new Set([
  "commons-action-content",
  "commons-action-recovery",
  "newsletter-agent-sweep",
  "run-newsletter-agent",
  "sage-action-execute",
  "sage-trend-detect",
  "sage-wake-sweep",
  "sage-weekly-outreach-sweep",
]);

export const MISSING_PRODUCTION_KEY_MESSAGE =
  "OPENAI_API_KEY isn't set in the Trigger.dev production environment. Add it under Environment Variables, then redeploy.";

export type TriggerEnvironmentType = "PRODUCTION" | "STAGING" | "DEVELOPMENT" | "PREVIEW";

export type ModelKeyCheck = "not-a-model-task" | "ok" | "missing-warned";

export class MissingOpenAIKeyError extends Error {
  constructor() {
    super(MISSING_PRODUCTION_KEY_MESSAGE);
    this.name = "MissingOpenAIKeyError";
  }
}

// Only reports whether the key is present. Never logs or returns its value.
export function checkTriggerModelKey(params: {
  taskId: string;
  environmentType: TriggerEnvironmentType;
  apiKey: string | undefined;
  warn: (message: string, details: Record<string, unknown>) => void;
}): ModelKeyCheck {
  if (!MODEL_TASK_IDS.has(params.taskId)) return "not-a-model-task";
  if (params.apiKey?.trim()) return "ok";
  if (params.environmentType === "PRODUCTION") throw new MissingOpenAIKeyError();
  params.warn(
    "OPENAI_API_KEY isn't set here, so this task will use its fallback (keyword logic or skipping model work). Add it under Environment Variables to test with the model.",
    { taskId: params.taskId, environment: params.environmentType },
  );
  return "missing-warned";
}

// The body of the Trigger.dev start hook in apps/api/src/trigger/init.ts. The SDK
// pieces are passed in so this package doesn't depend on @trigger.dev/sdk.
export function createOpenAIKeyStartHook(deps: {
  logger: {
    warn: (message: string, details: Record<string, unknown>) => void;
    error: (message: string, details: Record<string, unknown>) => void;
  };
  abort: (message: string) => Error;
  getApiKey?: () => string | undefined;
}) {
  return async ({ ctx, task }: { ctx: { environment: { type: TriggerEnvironmentType } }; task: string }) => {
    try {
      checkTriggerModelKey({
        taskId: task,
        environmentType: ctx.environment.type,
        apiKey: (deps.getApiKey ?? (() => process.env.OPENAI_API_KEY))(),
        warn: (message, details) => deps.logger.warn(message, details),
      });
    } catch (error) {
      if (error instanceof MissingOpenAIKeyError) {
        deps.logger.error(error.message, { taskId: task });
        throw deps.abort(error.message);
      }
      throw error;
    }
  };
}
