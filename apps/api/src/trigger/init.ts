import { AbortTaskRunError, logger, tasks } from "@trigger.dev/sdk";
import { createOpenAIKeyStartHook } from "../../../../packages/trpc/src/services/trigger-model-key.js";

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
