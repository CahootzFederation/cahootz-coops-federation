import { AbortTaskRunError, logger, tasks } from "@trigger.dev/sdk";
import { createOpenAIKeyStartHook } from "../../../../packages/trpc/src/services/trigger-model-key.js";
import { captureServerExceptionNow } from "../../../../packages/trpc/src/lib/error-tracking.js";

// Trigger.dev loads init.ts before every task. When a run fails for good (no
// retries left), send the error to PostHog error tracking. We record which
// task and run failed, never the payload, which can hold member content.
tasks.onFailure(async ({ ctx, task, error }) => {
  await captureServerExceptionNow(error, {
    properties: {
      source: "trigger",
      trigger_task: task,
      trigger_run_id: ctx.run.id,
      trigger_attempt: ctx.attempt.number,
      trigger_environment: ctx.environment.type,
    },
  });
});


// Trigger loads init.ts before every task. Model-calling tasks fail in production
// when OPENAI_API_KEY is missing, so the run shows red instead of quietly falling back.
// Abort skips retries: three identical failures wouldn't tell anyone more.
tasks.onStartAttempt(
  "openai-key-check",
  createOpenAIKeyStartHook({
    logger,
    abort: (message) => new AbortTaskRunError(message),
  }),
);
