import { AbortTaskRunError, logger, tasks } from "@trigger.dev/sdk";
import {
  MissingOpenAIKeyError,
  checkTriggerModelKey,
} from "../../../../packages/trpc/src/services/trigger-model-key.js";

// Trigger loads init.ts before every task. Model-calling tasks fail in production
// when OPENAI_API_KEY is missing, so the run shows red instead of quietly falling back.
// Abort skips retries: three identical failures wouldn't tell anyone more.
tasks.onStartAttempt("openai-key-check", async ({ ctx, task }) => {
  try {
    checkTriggerModelKey({
      taskId: task,
      environmentType: ctx.environment.type,
      apiKey: process.env.OPENAI_API_KEY,
      warn: (message, details) => logger.warn(message, details),
    });
  } catch (error) {
    if (error instanceof MissingOpenAIKeyError) {
      logger.error(error.message, { taskId: task });
      throw new AbortTaskRunError(error.message);
    }
    throw error;
  }
});
