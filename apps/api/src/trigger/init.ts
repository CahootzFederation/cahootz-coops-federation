import { tasks } from "@trigger.dev/sdk";

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
